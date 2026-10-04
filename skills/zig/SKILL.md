---
name: zig
description: "Write correct, idiomatic Zig 0.16 code. Use when writing new Zig code, editing existing Zig files, debugging Zig compilation errors, reviewing Zig code, or working with build.zig files. Triggers on any task involving .zig files. Critical: LLM training data contains outdated Zig patterns (0.11-0.15) that will produce broken code — this skill provides the current 0.16 patterns."
---

# Zig 0.16

LLM training data covers Zig 0.11-0.15 at best. Zig 0.16 has massive breaking changes. ALWAYS consult [references/zig-0.16-changes.md](references/zig-0.16-changes.md) before writing Zig code.

Rule zero: verify APIs against the pinned toolchain, not memory.

```bash
zigdoc std.Io.File          # API discovery, toolchain-aware
zig env                     # .std_dir = actual std source for THIS zig
ziglint src/                # style + correctness lint
```

`zig env` prints `.std_dir` — grep that tree when a signature matters. It is the source of truth, and it is cheap.

## "Removed" usually means "moved" — grep before you hand-roll

0.16 relocated huge API surfaces without renaming the capability. When the
release notes say a type or function was removed, ask where it went before
writing your own:

- `std.posix.ucontext_t` removed → signal-frame parsing lives in `std.debug.cpu_context.fromPosixSignalContext` (gives `getPc`/`getFp` per arch).
- `std.net` DNS "gone" → `std.Io.net.HostName.lookup` / `HostName.connect` is the resolver; `Io.Threaded` implements it. `IpAddress.parse` being literal-only is about parsing, not resolution.
- `std.time.Timer`/`Instant`/`*Timestamp` removed → `std.Io.Timestamp` (below).

All three were relearned the hard way by hand-rolling something std already had. A vtable grep (`grep -n 'netLookup\|pub fn' std/Io.zig`) takes ten seconds.

## Juicy Main — `main` takes `std.process.Init`

```zig
pub fn main(init: std.process.Init) !void {
    const gpa = init.gpa;                          // general purpose allocator, threadsafe
    const io = init.io;                            // default Io implementation
    const arena: std.mem.Allocator = init.arena.allocator();  // process-lifetime, threadsafe
    const args = try init.minimal.args.toSlice(init.arena.allocator());
    // init.environ_map: *Environ.Map — env vars are NOT global anymore
}
```

- argv and environ exist **only** through this parameter. Global argv/env access is gone.
- `std.process.Init.Minimal` is the smaller variant (argv + environ only, no gpa/io).
- Use `std.testing.io` in tests, like `std.testing.allocator`. `std.testing.environ` for env.

## I/O as an interface — everything takes `Io`

`std.fs.File` → `std.Io.File`. `std.fs.Dir` → `std.Io.Dir`. `std.fs.cwd()` → `std.Io.Dir.cwd()`. `file.close()` → `file.close(io)`.

```zig
// stdout, buffered:
var buf: [4096]u8 = undefined;
var writer: std.Io.File.Writer = .init(.stdout(), io, &buf);
defer writer.interface.flush() catch {};
try writer.interface.print("hello {s}\n", .{"world"});

// one-shot:
try std.Io.File.stdout().writeStreamingAll(io, "Hello, world!\n");

// reading:
var file_reader = file.reader(io, &.{});          // &.{} = empty buffer, unbuffered
const contents = try file_reader.interface.allocRemaining(allocator, .limited(max));

// FixedBufferStream is gone:
var writer: std.Io.Writer = .fixed(buffer);
var reader: std.Io.Reader = .fixed(data);
```

- No `Io` at hand: `var threaded: std.Io.Threaded = .init_single_threaded; const io = threaded.io();` — a workaround, not a pattern; thread `Io` through instead.
- `Io.Threaded` is complete (the default `init.io`). `Io.Evented`/`Io.Uring`/`Io.Kqueue` are WIP.
- Style: alias `const Io = std.Io;` per file, and use the method form (`io.random(&buf)`, `io.sleep(...)`, `futex.futexWake(io)`), never `Io.random(io, ...)`.

## Clock and randomness in 0.16

`std.time` is unit constants plus `std.time.epoch` — **no clock functions at all**. A `std.time.microTimestamp()` call compiles only when lazy analysis never reaches it (see the landmine section).

- Time reads: `std.Io.Timestamp.now(io, .awake)` (monotonic) or `.now(io, .real)` (wall). `Io.Timestamp` is a plain value type: `.{ .nanoseconds = n }` constructs one with no io, and `durationTo`/`addDuration`/`toSeconds`/`toMilliseconds` are pure value math. Many projects wrap a `timex` module around the raw clock syscall instead of threading io just for time — that is a legitimate pattern.
- Randomness: `io.random(&buf)` for bytes (`io.randomSecure` for secrets). For a `std.Random` interface, seed a `std.Random.DefaultPrng` once per thread from `io.random` and keep it — preferred over `std.Random.IoSource`, whose returned `Random` borrows the IoSource struct: return it from a helper and the borrow dangles. `std.Random.DefaultCsprng` (ChaCha) when the stream should stay unpredictable.
- Tests: `var prng: Random.DefaultPrng = .init(testing.random_seed);` inline at the test site, then `prng.random()`. No helper that vends a `Random` — it needs a fn-local static to keep the borrow alive, which is machinery for a two-line problem.

## The lazy-analysis landmine

Zig analyzes lazily. A `switch` on a comptime-known build option never analyzes dead arms, so a call to a removed API can sit in a pruned arm and survive every green build — until someone builds the other flag combination. Same for code paths only reachable under a different `-D` option.

Defense: build the option matrix, not just the default. Run BOTH `zig build test` AND `zig build` (a green test build with a broken `run()` is a real observed failure mode), and any non-default build flags the project ships.

## `std.posix` was gutted

The medium layer is gone. Survivors include `read`, `setsockopt`, `mmap`/`munmap`, `kill`/`raise`, `openat`, `sched_getaffinity`, signal-set helpers, `sigaltstack`. Everything else: go **higher** (`std.Io`) or **lower** (`std.posix.system` — `std.os.linux` without libc, `std.c` with libc).

**setsockopt landmine:** `std.posix.setsockopt` maps `EINVAL` to `unreachable` — UB in ReleaseFast. For any option where EINVAL is a legitimate runtime failure, use the raw layer and decode errno yourself. See [references/linux-raw-layer.md](references/linux-raw-layer.md).

## `std.mem` renames — "index of" is now "find"

`indexOf` → `find`, `indexOfScalar` → `findScalar`, `indexOfAny` → `findAny`, `lastIndexOf` → `findLast`, `indexOfPos` → `findPosLinear` family. Emitting `std.mem.indexOf*` is a compile error now.

## Other 0.16 breaks, one line each

- `@Type` removed → `@Int`, `@Struct`, `@Union`, `@Enum`, `@Pointer`, `@Fn`, `@Tuple`, `@EnumLiteral()`.
- `@cImport` deprecated (still compiles, no warning) → `b.addTranslateC` in build.zig + `const c = @import("c")`. Recipe: [Migrating off @cImport](references/zig-0.16-changes.md#migrating-off-cimport).
- Sync primitives moved: `Thread.ResetEvent`→`Io.Event`, `WaitGroup`→`Io.Group`, `Futex`→`Io.Futex`, `Mutex`→`Io.Mutex`, `Condition`→`Io.Condition`, `Semaphore`→`Io.Semaphore`. `std.once` and `Thread.Pool` removed. `ArenaAllocator` is threadsafe/lock-free; `ThreadSafeAllocator` removed.
- `std.crypto.random` gone → `io.random(&buf)` / `io.randomSecure(&buf)`.
- `{D}` format specifier removed → `{f}` with `std.Io.Duration`.
- `std.ArrayList` is unmanaged: init `.empty`, allocator per mutating call. `ArrayListUnmanaged` is a deprecated alias.
- Managed containers removed (`AutoArrayHashMap` → `array_hash_map.Auto`, etc.); `PriorityQueue`/`PriorityDequeue` lost their allocator field.
- Cast builtins are single-argument, return type inferred: `const x: DestType = @ptrCast(ptr);`
- Type reflection tags lowercase: `.int`, `.float`, `.@"struct"`, `.@"enum"`.
- Structs/arrays have no `==`; use `std.meta.eql` / `std.mem.eql`.
- Returning the address of a local is a compile error ("expired local variable").
- Pointers are forbidden in `packed struct`/`packed union`. `extern` enums/packed types need explicit backing ints.
- Runtime vector indexing is forbidden — coerce to array first.
- Error renames: `RenameAcrossMountPoints`/`NotSameFileSystem`→`CrossDevice`, `SharingViolation`→`FileBusy`, `EnvironmentVariableNotFound`→`EnvironmentVariableMissing`.
- Child processes: `std.process.spawn(io, .{ ... })`, `std.process.run(allocator, io, .{...})`.
- `std.meta.intToEnum` → `std.enums.fromInt` (returns `?Enum`, not an error union — `orelse`, not `catch`).
- `std.mem.copyForwards`/`copyBackwards` → the `@memmove` builtin.

Build system: `b.addExecutable(.{ .name, .root_module = b.createModule(.{ .root_source_file = b.path("src/main.zig"), .target, .optimize }) })`; `addStaticLibrary()` → `addLibrary(.{ .linkage = .static })`; path strings → `b.path(...)` LazyPaths.

## Security footgun: narrow-type arithmetic in bounds checks

Zig evaluates `narrow_type + comptime_int` in the narrow type **before** widening for the comparison:

```zig
const len = r.assumeRead(u16);           // attacker-controlled length
if (remaining < len + 5) return error.UnexpectedEof;   // BUG: len + 5 overflows u16
```

panics (Debug/ReleaseSafe) or is UB (ReleaseFast) before the comparison rejects the oversized input. Remote DoS class. `ziglint` does not catch this. Always widen first:

```zig
if (remaining < @as(usize, len) + 5) return error.UnexpectedEof;
```

## Style

- `camelCase` functions, `snake_case` variables/constants, `PascalCase` types.
- Prefer `const foo: Type = .{ .field = value };` over `const foo = Type{...};`.
- File order: `//!` doc, `const Self = @This();`, imports, `const log = std.log.scoped(...)`.
- Allocators explicit; `errdefer` for cleanup on error paths.
- Use `@splat` for uniform array/vector init: `const mask: [4]u8 = @splat(0);`
- Extract type aliases for repeated semantic types (`const RecordLen = u16;`, not bare `u16` in every signature).
- Tests inline with the code they cover.
- Comments explain why, not what.

Full style rules (expression shape, enums-over-bools, buffers, arithmetic placement, sockets idiom): [references/matt-zig-style.md](references/matt-zig-style.md).

## Before writing Zig code

1. `zigdoc <symbol>` for any std API you are not certain of — 0.16 renamed too much to guess.
2. If a capability seems missing, grep `.std_dir` for where it moved before hand-rolling it.
3. Read existing code in the project first; match established patterns.
4. After writing, run `zig build test`, `zig build`, and every non-default build-flag combination the project documents.
