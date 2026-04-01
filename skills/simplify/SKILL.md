---
name: simplify
description: "Review code for opportunities to simplify without degrading functionality. Use when the user says 'simplify', 'clean this up', 'refactor for clarity', or asks to find simplification opportunities. Works at any scope: recently changed code, a specific file/function, a module, or an entire codebase. Optimized for Go and Zig."
---

# Simplify

Analyze code and apply simplifications that improve clarity and reduce complexity without changing behavior. Never degrade functionality.

## Determine scope

Ask only if ambiguous. Otherwise infer from context:

- **Recent changes**: `git diff HEAD` or `git diff main` — simplify what was just written
- **File/function**: user points at a specific target
- **Module/directory**: scan all files in the module, prioritize highest-impact opportunities
- **Codebase sweep**: walk the project tree, skip vendored/generated code, produce a ranked list of simplification opportunities before making changes

For module+ scope, **report opportunities first** — don't start editing until the user confirms which ones to pursue.

## What to simplify

### Structural

- Flatten unnecessary nesting (early returns, guard clauses)
- Remove dead code, unused parameters, unreachable branches
- Collapse single-use abstractions back into their call site
- Merge near-duplicate functions into one with a parameter
- Replace complex conditional chains with table-driven logic or switch/match
- Remove wrapper types/interfaces that add indirection without value

### Clarity

- Rename unclear variables and functions to express intent
- Replace magic numbers/strings with named constants
- Simplify boolean expressions (`!(!x && !y)` → `x || y`)
- Convert imperative accumulation to idiomatic patterns (e.g., Go `append` in range loop)
- Make control flow linear where possible — avoid bouncing between helpers for sequential logic

### Go-specific

- Prefer early return over deep nesting (`if err != nil { return err }` at the top)
- Remove unnecessary `else` after `return`/`continue`/`break`
- Use `errors.Is`/`errors.As` over string matching
- Simplify interface — if only one implementation exists, consider removing the interface
- Use `slices`, `maps` stdlib packages over hand-rolled loops where they fit
- Prefer `fmt.Errorf("...: %w", err)` wrapping over custom error types unless matching is needed
- Remove unnecessary goroutine+channel patterns when synchronous code suffices
- Use struct embedding to reduce boilerplate delegation

### Zig-specific

For Zig code, also load the `zig` skill for 0.15 API correctness.

- Use `return switch`/`return if` — expression-oriented returns
- Prefer `.empty` initialization for ArrayList/HashMap
- Consolidate error handling: `try` + centralized `catch` over scattered handling
- Remove unnecessary `@as` casts — let type inference work
- Prefer `const` over `var` wherever possible
- Use `comptime` to eliminate runtime branches when inputs are known at compile time
- Avoid over-abstraction — three similar lines > a premature generic
- Inline single-use helper functions that obscure the flow

## Process

1. **Read first** — understand the code's purpose and existing patterns before changing anything
2. **Assess test coverage** — before simplifying any code, check that it has adequate test coverage. If coverage is thin or missing, **write tests first** to lock in current behavior before refactoring. Do not simplify code that lacks tests — it's too easy to silently break things. Flag under-tested code to the user and propose tests before proceeding.
3. **Identify opportunities** — list what can be simplified and the expected impact
4. **For module+ scope** — present the ranked list and wait for confirmation
5. **Apply changes** — one logical simplification per edit, preserving behavior
6. **Verify** — run existing tests plus any new ones. For Go: `go test ./...`; for Zig: `zig build test`
7. **Summarize** — 1-3 sentences on what changed and why it's simpler

## Guardrails

- **No tests, no refactor** — if code lacks test coverage, add tests before simplifying. This is non-negotiable.
- Never change behavior, public API signatures, or test assertions
- If unsure whether a change preserves behavior, don't make it — flag it instead
- Don't chase style nits — focus on meaningful complexity reduction
- Don't add code (new helpers, new abstractions) to "simplify" — the goal is less, not more
- Respect existing project conventions — read nearby files to match patterns
