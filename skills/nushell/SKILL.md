---
name: nushell
description: "Write and edit Nushell (.nu) scripts as a replacement for non-trivial bash scripts. Use when the task involves writing a shell script with logic, data manipulation, structured output, or anything beyond a few simple command invocations. Nushell is the preferred scripting language for complex automation; bash is fine for trivial one-liners and shellHooks. Triggers on: .nu files, requests to 'write a script', or when a bash script is getting complex. Also applies when adding nushell to a nix devshell."
---

# Nushell Scripting

Nushell (nu) replaces non-trivial bash scripts. Use bash for trivial glue (`shellHook`, one-liners); use nu when a script needs logic, data processing, or grows past ~10 lines.

**Current version: 0.111.0** (pre-1.0; breaking changes happen between releases — verify syntax against the book if something seems off).

## Nix DevShell Integration

Add `nushell` to `packages` in `flake.nix`. The `shellHook` stays bash (it always does); call `.nu` scripts from `just` recipes or directly with `nu`:

```nix
packages = with pkgs; [ just nushell git ];
```

```justfile
build *args:
    nu scripts/build.nu {{args}}
```

**Note:** If you `exec nu` in `shellHook`, bash `trap` EXIT handlers won't fire (bash process is replaced). Prefer calling scripts explicitly.

## Script Entry Point

```nu
#!/usr/bin/env nu

def main [
    target: string               # required positional
    --release (-r)               # boolean flag
    --output (-o): path = "."    # flag with default
] {
    if $release { print $"Building ($target) in release mode" }
    # ...
}

# Subcommands:
def "main build" [] { ... }
def "main test" [] { ... }
def main [] { print "usage: script.nu build|test" }
```

Run: `nu script.nu build --release`

## Tooling Caveats

With `nu 0.111.0` and `nufmt 0.1.0`, formatter/parser tooling can emit spurious
`compile_block_with_id called with parse errors` messages for valid module-based
scripts.

Observed cases:
- Calling an imported module command inside a command body can trigger parser
  noise in `nufmt`, even when `use ./module.nu [...]` itself formats cleanly.
- `where {|x| ... }` predicate closures can also trigger parser noise.

Guidance:
- Treat `nu-check` plus a real runtime smoke test as the correctness gate.
- Do not switch to deprecated `filter` just to quiet `nufmt`.
- If a formatter-friendly filter is needed, prefer an `each { if ... { ... } } |
  compact` pattern over `where {|...|}`.

## Critical Bash→Nu Differences

| Bash | Nu | Note |
|------|-----|------|
| `echo "hi" > file` | `"hi" \| save file` | `>` is comparison in nu |
| `$?` | `$env.LAST_EXIT_CODE` | after external cmd |
| `export FOO=bar` | `$env.FOO = "bar"` | block-scoped by default |
| `FOO=bar cmd` | `FOO=bar ^cmd` | |
| `2>&1` | `o+e>\|` or `o+e> file` | |
| `echo val` (return) | just write `val` | implicit return; use `print` for output |
| `set -e` | on by default (0.111+) | pipefail enabled |

**`>` is comparison, not redirection.** File output uses `save`.

## Key Patterns

### Variables

```nu
let x = "immutable"
mut count = 0
$count += 1
const MAX = 100    # parse-time constant (required for source/use)
```

Closures **cannot** capture `mut` variables — use `for` loops instead of `each` when mutating:

```nu
mut total = 0
for n in [1 2 3] { $total += $n }   # OK
[1 2 3] | each { $total += $in }    # ERROR
```

### String Interpolation

```nu
$"Hello, ($name)!"
$"Items: ($list | length)"   # any expression in parens
```

### Error Handling

```nu
try {
    let data = open missing.json
} catch { |err|
    print $"Failed: ($err.msg)"
}

# External commands — most reliable pattern:
let result = (^some-cmd | complete)
if $result.exit_code != 0 {
    error make { msg: $"Failed: ($result.stderr)" }
}
```

### Running External Commands

```nu
^git status                            # ^ forces external (skips nu builtins)
let branch = (^git rev-parse --abbrev-ref HEAD | str trim)
let result = (^risky-cmd | complete)   # captures stdout, stderr, exit_code
```

### File I/O

```nu
open config.toml          # auto-parsed by extension → record
open data.json            # → table or record
open data.csv             # → table
"content" | save file.txt
$data | save output.json  # auto-serialized by extension
$data | save --force output.json
"line\n" | save --append log.txt
```

### Environment

```nu
$env.PATH = ($env.PATH | prepend "/my/bin")
$env.FOO?                              # null if not set (safe access)
with-env { FOO: "bar" } { ^cmd }       # scoped to block only
```

Use `def --env` when a command needs to mutate the caller's environment.

## Standard Library

Always use **slash form** imports — they load only the named submodule. Space form (`use std log`) loads the entire stdlib first and is much slower.

```nu
use std/log       # log debug, log info, log warning, log error, log critical
use std/assert    # assert, assert equal, assert error, assert length, ...
use std/iter      # iter find, iter scan, iter filter-map, iter zip-with, ...
use std/formats * # from ndjson, to ndjson, from jsonl, to jsonl, ...
```

### Logging

All log output goes to **stderr** (intentional — keeps stdout clean for pipelines).

```nu
use std/log
log debug "detailed trace"   # hidden by default — see NU_LOG_LEVEL below
log info "normal operation"
log warning "something off"
log error "something failed"
log critical "unrecoverable"
```

`NU_LOG_LEVEL` defaults to `20` (INFO), so `log debug` is silently suppressed unless you set:

```nu
$env.NU_LOG_LEVEL = 10   # show DEBUG and above
```

**Gotcha — `use std/log` inside modules:** The log module exports env vars via an `export-env` block that doesn't always propagate correctly at module scope. Place `use std/log` **inside each function** that uses it, not at the top of the module file.

```nu
# GOOD
export def my-cmd [] {
    use std/log
    log info "hello"
}

# BAD — may error: "Cannot find column 'NU_LOG_FORMAT'"
use std/log
export def my-cmd [] { log info "hello" }
```

### Assertions

```nu
use std/assert
assert (1 == 1)
assert equal $a $b "values must match"
assert not equal $a $b
assert length $list 3
assert error { risky-operation }   # closure must throw
```

### Iter extras

```nu
use std/iter
$list | iter find {|e| $e > 5 }                         # first match or null
$list | iter scan 0 {|acc, x| $acc + $x}                # running totals
$list | iter filter-map {|e| $e ** 2 }                  # map + drop errors/nulls
[1 2 3] | iter zip-with [4 5 6] {|a, b| $a + $b}        # => [5 7 9]
```

## Parallelism

`par-each` is the only built-in parallel primitive. It's backed by Rayon and uses all CPUs by default.

```nu
# Basic — results arrive in arbitrary order
$list | par-each {|e| heavy-work $e }

# Preserve input order (buffers and reorders)
$list | par-each --keep-order {|e| heavy-work $e }

# Limit thread count
$list | par-each --threads 4 {|e| heavy-work $e }
```

**No ordering guarantees by default.** Sort after if order matters:

```nu
$list | par-each {|e| process $e } | sort-by name
```

**Cannot capture `mut` variables** — same closure rule as `each`. Collect results and aggregate after:

```nu
# WRONG
mut total = 0
$list | par-each {|e| $total += $e }   # parse error

# RIGHT — return values, aggregate after
let total = ($list | par-each {|e| compute $e } | math sum)
```

**Very large lists** — use `chunks` to bound concurrency and memory:

```nu
$large_list | chunks 100 | par-each {|chunk|
    $chunk | each {|item| process $item }
} | flatten
```

**Env var mutations inside `par-each` closures don't propagate out** — each closure gets its own env copy. This is consistent with nushell's normal env scoping.

## Full Syntax Reference

For comprehensive syntax (types, control flow, tables, modules, etc.) see [references/syntax.md](references/syntax.md).

For formatting, linting, and CI tooling see [references/tooling.md](references/tooling.md).
