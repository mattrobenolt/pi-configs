# Zig 0.15 Migration Reference

Comprehensive reference of breaking changes from Zig 0.13/0.14 → 0.15. Organized by subsystem.

## Table of Contents

1. [I/O Overhaul (std.io → std.Io)](#io-overhaul)
2. [ArrayList Changes](#arraylist)
3. [Build System](#build-system)
4. [Type Reflection](#type-reflection)
5. [Builtin Renames](#builtin-renames)
6. [Standard Library Reorganization](#stdlib-reorg)
7. [Language Features](#language-features)
8. [Allocator API](#allocator-api)
9. [Format Strings](#format-strings)
10. [Containers](#containers)
11. [Signal Handling](#signal-handling)
12. [Common Pitfalls](#common-pitfalls)

---

## I/O Overhaul (std.io → std.Io) {#io-overhaul}

The largest breaking change in 0.15. The entire I/O subsystem was redesigned ("Writergate"). Buffers now live in the interface, not in a separate wrapper.

### stdout/stderr — OLD (pre-0.15):
```zig
const stdout = std.io.getStdOut().writer();
try stdout.print("hello\n", .{});
```

### stdout/stderr — NEW (0.15):
```zig
var stdout_buf: [4096]u8 = undefined;
var stdout_writer = std.fs.File.stdout().writer(&stdout_buf);
const stdout = &stdout_writer.interface;

try stdout.print("hello\n", .{});
try stdout.flush(); // REQUIRED — output stays in buffer without this
```

### Unbuffered writer (empty buffer):
```zig
var w = std.fs.File.stdout().writer(&.{});
const stdout = &w.interface;
try stdout.print("unbuffered\n", .{});
// flush is a no-op with empty buffer
```

### stdin reading — NEW:
```zig
var stdin_buf: [512]u8 = undefined;
var stdin_reader_wrapper = std.fs.File.stdin().reader(&stdin_buf);
const reader: *std.Io.Reader = &stdin_reader_wrapper.interface;
```

### Generic functions accepting writers:
```zig
fn greet(writer: *std.Io.Writer) !void {
    try writer.print("hello {s}\n", .{"world"});
}
```

### Buffered writer — OLD (pre-0.15):
```zig
var buffered_writer = std.io.bufferedWriter(stdout_writer);
try writeData(buffered_writer.writer());
try buffered_writer.flush();
```

### Buffered writer — NEW (0.15):
```zig
var buffer: [1024]u8 = undefined;
var stdout_writer = stdout_file.writer(&buffer);
try writeData(&stdout_writer.interface);
try stdout_writer.interface.flush();
```

### File reading (unchanged):
```zig
const file = try std.fs.cwd().openFile(path, .{});
defer file.close();
return try file.readToEndAlloc(allocator, max_size);
```

### File writing (unchanged):
```zig
const file = try std.fs.cwd().createFile(path, .{});
defer file.close();
try file.writeAll(data);
```

### Key types:
- `std.Io.Writer` — replaces `std.io.Writer`, `std.io.AnyWriter`, `std.io.GenericWriter`
- `std.Io.Reader` — replaces `std.io.Reader`, `std.io.AnyReader`, `std.io.GenericReader`
- `std.io.BufferedReader` / `std.io.BufferedWriter` — REMOVED, buffering is in the interface
- `std.io.SeekableStream` — REMOVED
- `std.io.BitReader` / `std.io.BitWriter` — REMOVED
- `std.io.getStdOut()` / `std.io.getStdErr()` / `std.io.getStdIn()` — REMOVED, use `std.fs.File.stdout()` etc.

### Writer VTable (for custom implementations):
```zig
pub const VTable = struct {
    drain: *const fn (w: *Writer, data: []const []const u8, splat: usize) Error!usize,
    sendFile: *const fn (w: *Writer, file_reader: *File.Reader, limit: Limit) FileError!usize,
    flush: *const fn (w: *Writer) Error!void,
    rebase: *const fn (w: *Writer, preserve: usize, capacity: usize) Error!void,
};
```

---

## ArrayList and HashMap Changes {#arraylist}

Allocator is now passed to every mutating operation. Initialize with `.empty`.

### ArrayList — OLD (pre-0.15):
```zig
var list = std.ArrayList(i32).init(allocator);
defer list.deinit();
try list.append(42);
try list.appendSlice(&[_]i32{1, 2, 3});
```

### ArrayList — NEW (0.15):
```zig
var list: std.ArrayList(u32) = .empty;
defer list.deinit(allocator);
try list.append(allocator, 42);
try list.appendSlice(allocator, &[_]i32{1, 2, 3});
```

### HashMap/StringHashMap (default to unmanaged):
```zig
var map: std.StringHashMapUnmanaged(u32) = .empty;
defer map.deinit(allocator);
try map.put(allocator, "key", 42);
```

### Mutating operations (require allocator):
- `list.append(allocator, item)`
- `list.appendSlice(allocator, slice)`
- `list.insert(allocator, index, item)`
- `list.ensureTotalCapacity(allocator, n)`
- `list.toOwnedSlice(allocator)`
- `list.deinit(allocator)`

### Non-mutating operations (no allocator):
- `list.pop()`, `list.popOrNull()`
- `list.orderedRemove(index)`, `list.swapRemove(index)`
- `list.items` for reading

### Do NOT use `.init()` or `.{}` — use `.empty`:
```zig
// WRONG:
var list = std.ArrayList(u32).init();
var list: std.ArrayList(u32) = .{};
// RIGHT:
var list: std.ArrayList(u32) = .empty;
```

---

## Build System {#build-system}

### Module creation — NEW pattern:
Use `b.createModule()` to build root modules, then pass to executable/library definitions. Replaces direct `root_source_file` assignment.

### Static libraries — OLD:
```zig
const lib = b.addStaticLibrary(.{ ... });
```

### Static libraries — NEW:
```zig
const lib = b.addLibrary(.{ .linkage = .static, ... });
```

`addStaticLibrary()` no longer exists.

### LazyPath changes:
Functions that previously took `[]const u8` paths now take `LazyPath`:
```zig
// OLD:
b.addRemoveDirTree(tmp_path);
// NEW:
b.addRemoveDirTree(.{ .cwd_relative = tmp_path });
```

### WriteFile → UpdateSourceFiles:
```zig
// OLD:
b.addWriteFiles();
// NEW:
b.addUpdateSourceFiles();
```

### Root source file:
```zig
// OLD (0.12-era):
.root_source_file = .{ .path = "src/main.zig" }
// NEW:
.root_source_file = b.path("src/main.zig")
```

### Other build changes (0.14):
- `Compile.installConfigHeader` second argument removed
- `std.Build` (not `std.build`) — capitalized since 0.13+
- `std.Build.Step.Compile` (not `std.build.LibExeObjStep`)

---

## Type Reflection {#type-reflection}

### All std.builtin.Type tags are now lowercase (0.14+):

```zig
// OLD:
.Int, .Float, .Pointer, .Struct, .Enum, .Union, .Opaque
// NEW:
.int, .float, .pointer, .@"struct", .@"enum", .@"union", .@"opaque"
```

Reserved words require `@"keyword"` syntax.

### Pointer size constants:
```zig
.one    // Single pointer (*T)
.many   // Many pointer ([*]T)
.slice  // Slice ([]T)
```

### CallingConvention — lowercase:
```zig
// OLD:
.C
// NEW:
.c
```

---

## Builtin Renames {#builtin-renames}

These were renamed in 0.13 but LLMs still frequently emit the old forms:

| Old (pre-0.13) | New (0.13+) |
|---|---|
| `@intToPtr(T, val)` | `@ptrFromInt(val)` (return type inferred) |
| `@ptrToInt(ptr)` | `@intFromPtr(ptr)` |
| `@intToFloat(T, val)` | `@floatFromInt(val)` (return type inferred) |
| `@floatToInt(T, val)` | `@intFromFloat(val)` (return type inferred) |
| `@intToEnum(T, val)` | `@enumFromInt(val)` (return type inferred) |
| `@enumToInt(e)` | `@intFromEnum(e)` |
| `@ptrCast(T, ptr)` | `@ptrCast(ptr)` (return type inferred) |
| `@bitCast(T, val)` | `@bitCast(val)` (return type inferred) |
| `@truncate(T, val)` | `@truncate(val)` (return type inferred) |
| `@errSetCast(T, err)` | `@errorCast(err)` (return type inferred) |
| `@fieldParentPtr(T, "field", ptr)` | `@fieldParentPtr(ptr, .field_name)` |

All casts now infer return type from context — do NOT pass the destination type.

---

## Standard Library Reorganization {#stdlib-reorg}

| Old | New |
|---|---|
| `std.os` (most functions) | `std.posix` |
| `std.rand` | `std.Random` |
| `std.TailQueue` | `std.DoublyLinkedList` |
| `std.zig.CrossTarget` | `std.Target.Query` |
| `std.fs.MAX_PATH_BYTES` | `std.fs.max_path_bytes` |
| `std.mem.tokenize` | `std.mem.tokenizeScalar` / `std.mem.tokenizeSequence` |
| `std.unicode.utf16leToUtf8` | `std.unicode.utf16LeToUtf8` |
| `async` / `await` | REMOVED from language |

---

## Language Features (New in 0.14/0.15) {#language-features}

### @branchHint (replaces @setCold):
```zig
@branchHint(.cold);      // Unlikely path
@branchHint(.likely);    // Hot path
```

### @export requires pointer:
```zig
@export(&myFunction, .{ .name = "exported_name" });
```

### Labeled switch with continue:
Enables state machine patterns by continuing to labeled switch prongs.

### Decl literals:
Empty struct initialization: `const x: MyType = .{ .field = value };`

---

## Allocator API {#allocator-api}

### Page size is now runtime:
```zig
const page_size = std.heap.pageSize();       // Runtime function
const min_page = std.heap.page_size_min;     // Compile-time constant
const max_page = std.heap.page_size_max;     // Compile-time constant
```

### Alignment type:
VTable functions use `std.mem.Alignment`, not `u8`.

---

## Format Strings {#format-strings}

### New specifiers:
- `{t}` — Tag and error names
- `{d}` — Custom number formatting
- `{b64}` — Standard base64 output
- `{f}` — Required for custom format methods

### Custom formatter signature (0.15):
```zig
pub fn format(self: @This(), writer: *std.Io.Writer) std.Io.Writer.Error!void {
    // ...
}
```
Writer is passed directly. Use `{f}` specifier to invoke.

---

## Containers {#containers}

### DoublyLinkedList (formerly TailQueue):
Nodes are now untyped. Embed `std.DoublyLinkedList.Node` in your data struct and use `@fieldParentPtr()` to recover the containing struct.

### HashMap:
`std.AutoHashMap` works for simple key-value mappings with automatic hashing.

---

## Signal Handling (POSIX) {#signal-handling}

```zig
var g_cancel_flag = std.atomic.Value(bool).init(false);

fn sigintHandler(_: c_int) callconv(.c) void {
    const msg = "\nCancelling...\n";
    _ = posix.write(posix.STDERR_FILENO, msg) catch {};
    g_cancel_flag.store(true, .release);
}

fn setupSignalHandler() void {
    const act = posix.Sigaction{
        .handler = .{ .handler = sigintHandler },
        .mask = std.mem.zeroes(posix.sigset_t),
        .flags = 0,
    };
    posix.sigaction(posix.SIG.INT, &act, null);
}
```

Note: `callconv(.c)` — lowercase `.c`, not `.C`.

---

## Common Pitfalls {#common-pitfalls}

1. Forgetting `stdout.flush()` before program exit
2. Using `.init()` or `.{}` on ArrayList — use `.empty` instead
3. Omitting allocator from ArrayList mutating operations
4. Using uppercase type tags (`.Int` → `.int`, `.Struct` → `.@"struct"`)
5. Calling removed `std.io.getStdOut()` — use `std.fs.File.stdout()`
6. Using old build patterns without `createModule()`
7. Using `addStaticLibrary()` — use `addLibrary(.{ .linkage = .static })`
8. Using old two-argument cast builtins — all casts are now single-argument with inferred return type
9. Using `std.os` — most moved to `std.posix`
10. Using `async`/`await` — removed from the language
11. Using `@setCold` — replaced by `@branchHint(.cold)`
12. Using `.C` calling convention — now `.c` (lowercase)
