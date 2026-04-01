# Nushell Syntax Reference

## Table of Contents
- [Types](#types)
- [Control Flow](#control-flow)
- [Custom Commands (Functions)](#custom-commands)
- [Pipelines and `$in`](#pipelines)
- [Working with Tables and Records](#tables-and-records)
- [List Operations](#list-operations)
- [String Operations](#string-operations)
- [Modules](#modules)

---

## Types

```nu
let i: int      = 42
let f: float    = 3.14
let s: string   = "hello"
let b: bool     = true
let d: duration = 5sec        # 1ms, 2s, 3min, 4hr, 5day, 6wk
let sz: filesize = 10mb       # 1b, 2kb, 3mb, 4gb
let dt: datetime = 2024-01-01
let p: path     = /usr/bin
let list: list<int> = [1 2 3]
let rec: record<name: string, age: int> = {name: "Alice", age: 30}
let nothing = null
```

Nushell is strongly typed. Type mismatches are caught at parse time where possible.

---

## Control Flow

### if/else

```nu
# Expression — returns a value
let label = if $x > 0 { "positive" } else if $x == 0 { "zero" } else { "negative" }

# Statement form (no assignment)
if $flag { do-thing }
```

### match

```nu
match $status {
    "ok" => "success",
    "err" => "failure",
    $other if ($other | str starts-with "warn") => "warning",
    _ => "unknown"
}

# Match on records (destructure)
match $rec {
    { name: "Alice", age: $a } => $"Alice is ($a)",
    { name: $n } => $"Someone named ($n)",
    _ => "no match"
}
```

### Loops

```nu
# for — over lists, tables, ranges
for item in [1 2 3] { print $item }
for file in (ls *.nu) { print $file.name }
for i in 0..9 { print $i }        # range, exclusive end
for i in 0..=9 { print $i }       # range, inclusive end

# while
mut i = 0
while $i < 10 { $i += 1 }

# loop with break/continue
loop {
    let line = (input)
    if $line == "quit" { break }
    print $line
}
```

### Functional Iteration

Prefer these over loops for transformations:

```nu
[1 2 3] | each { |x| $x * 2 }                      # => [2 4 6]
[1 2 3] | where { |x| $x > 1 }                     # => [2 3]
[1 2 3] | reduce --fold 0 { |x, acc| $acc + $x }   # => 6
[1 2 3] | any { |x| $x > 2 }                        # => true
[1 2 3] | all { |x| $x > 0 }                        # => true
```

---

## Custom Commands

### Basic

```nu
def greet [name: string] {
    $"Hello, ($name)!"
}

# Optional with default
def greet [name: string = "world"] { $"Hello, ($name)!" }
```

### Flags

```nu
def build [
    target: string
    --release (-r)          # boolean, false if absent
    --jobs (-j): int = 4    # flag with value and default
] {
    if $release { ... }
    print $"jobs: ($jobs)"
}
```

### Rest Parameters

```nu
def sum [...nums: int]: nothing -> int {
    $nums | math sum
}
sum 1 2 3  # => 6
```

### Pipeline Input via `$in`

```nu
def double []: int -> int { $in * 2 }
3 | double   # => 6

# Multiple input types
def stringify []: [int -> string, float -> string] {
    $in | into string
}
```

### Environment-Modifying Commands

```nu
def --env add-to-path [dir: string] {
    $env.PATH = ($env.PATH | prepend $dir)
}
```

Without `--env`, environment changes are scoped to the command's block and discarded.

---

## Pipelines

```nu
# $in holds the pipeline value
[1 2 3] | each { $in * 2 }    # $in = each element

# Mid-pipeline let (0.111.0+)
"hello" | let msg | str length   # msg = "hello", result = 5

# Pipelines pass structured data; external commands receive/produce strings
^cat file.txt | lines | where { $in | str starts-with "#" }
```

### Stderr and Redirection

```nu
^cmd o> stdout.log              # redirect stdout
^cmd e> stderr.log              # redirect stderr
^cmd o+e> combined.log          # both to file
^cmd o+e>| less                 # both to pipeline
^cmd e> /dev/null               # discard stderr
```

---

## Tables and Records

```nu
# Create a table (list of records)
let t = [[name age]; [Alice 30] [Bob 25]]
let t = [{name: "Alice", age: 30}, {name: "Bob", age: 25}]

# Access
$t | where age > 25
$t | sort-by name
$t | select name email
$t | reject sensitive_col
$t | group-by department
$t | first 5
$t | last 5

# Records
$rec.name                       # field access
$rec | get name                 # same
$rec | insert age 30            # new field
$rec | update name "Bob"        # update field
$rec | upsert status "ok"       # insert or update
$rec | reject password          # remove field
$rec | select name age          # keep only these fields
$rec | merge {extra: "data"}    # merge two records
```

---

## List Operations

```nu
$list | length
$list | first 2
$list | last 2
$list | append 4           # => [..., 4]
$list | prepend 0          # => [0, ...]
$list | flatten            # flatten nested lists
$list | uniq               # deduplicate
$list | sort
$list | sort-by { |x| $x.name }
$list | reverse
$list | zip [4 5 6]        # => [[1 4] [2 5] [3 6]]
$list | enumerate          # => [{index: 0, item: 1}, ...]
$list | skip 2             # drop first 2
$list | take 3             # keep first 3
$list | chunks 2           # split into chunks of 2
$list | flatten --depth 1
1..10 | into list          # range to list
```

---

## String Operations

```nu
$s | str length
$s | str upcase
$s | str downcase
$s | str trim              # both ends
$s | str trim --left
$s | str trim --right
$s | str contains "ell"
$s | str starts-with "he"
$s | str ends-with "lo"
$s | str replace "hello" "hi"
$s | str replace --all "a" "b"
$s | str index-of "l"
$s | split row ","         # => list<string>
$s | split row --regex "\s+"
["a" "b" "c"] | str join ", "  # => "a, b, c"
$s | into int              # parse as integer
$s | into float
$s | lines                 # split on newlines → list

# Multiline strings
let text = "line1
line2
line3"
```

### String types

```nu
"double quotes"    # backslash escapes work, no interpolation
'single quotes'    # no escapes, no interpolation
`backtick`         # no interpolation, allows spaces (useful for paths)
$"interpolated ($var)"
$'interpolated ($var)'   # single-quote form, no escapes
r#'raw string with 'quotes' inside'#
```

---

## Modules

```nu
# mymodule.nu
export def greet [name: string] { $"Hello, ($name)!" }
export const VERSION = "1.0"

# In another file:
use mymodule.nu *           # import all exports
use mymodule.nu greet       # import specific
use mymodule.nu [greet VERSION]

# Submodule pattern
use mymodule.nu             # imports as "mymodule greet" command
mymodule greet "Alice"

# source vs use:
# source: inlines file at parse time (namespace pollution, good for scripts)
# use: proper module import (namespaced, preferred for reusable code)
const CONFIG = "config.nu"
source $CONFIG   # requires const (parse-time)
```

---

## Miscellaneous

```nu
# Type conversions
42 | into string
"42" | into int
3.14 | into int        # truncates
true | into string

# Null handling
null | default "fallback"
$val | if $in == null { "fallback" } else { $in }

# Timing
timeit { sleep 1sec }  # returns duration

# Math
math sqrt 16
math abs -5
[1 2 3] | math sum
[1 2 3] | math avg
[1 2 3] | math max
[1 2 3] | math min

# Date/time
date now
date now | format date "%Y-%m-%d"
2024-01-01 | date to-timezone UTC
```
