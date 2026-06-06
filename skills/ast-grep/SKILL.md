---
name: ast-grep
description: "Use ast-grep for structural code search and safe mechanical refactoring. Trigger when editing code where syntax-aware search or replacement could help: API migrations, call-site updates, import rewrites, constrained renames, repetitive boilerplate changes, auditing patterns across a repo, or before writing ad hoc Python/sed/regex scripts to modify source code. Prefer ast-grep when available over text grep or custom scripts for code-aware rewrites."
---

# ast-grep

Prefer ast-grep for mechanical source-code changes. It is usually safer and faster than writing a one-off Python parser, regex script, or hand-editing dozens of call sites like some kind of raccoon with a keyboard.

Use text grep for plain strings. Use compiler/type tooling for type-driven semantics. Use ast-grep for syntax-shaped search and replacement.

## Workflow

1. Check the tool exists: `command -v ast-grep || command -v sg`. Use `ast-grep` unless only `sg` exists. In a flake project, add it to the devshell instead of installing globally.
2. Search before rewriting. Start narrow and inspect real matches:
   ```sh
   ast-grep -p 'PATTERN' -l ts src
   ```
3. Read representative files before applying a rewrite. Verify the pattern matches the intended AST shape, not just code that looks similar.
4. Prefer interactive rewrites for broad changes:
   ```sh
   ast-grep -p 'old($ARG)' --rewrite 'new($ARG)' -l ts src --interactive
   ```
5. For non-trivial matching, use a temporary YAML rule and `ast-grep scan --rule rule.yml --interactive path` rather than escalating to a custom script.
6. After rewriting, run the formatter and tests/checks for the project.

Use `--update-all` only after reviewing search output and when the match set is small or mechanically obvious. Otherwise interactive mode is the guardrail.

## Pattern basics

Quote patterns with single quotes so the shell does not expand `$META` variables.

Metavariables are uppercase placeholders:

```sh
ast-grep -p '$OBJ.$METHOD($$$ARGS)' -l ts src
```

`$ARG` matches one AST node. `$_` matches one node without caring about reuse. `$$$ARGS` matches zero or more nodes, useful for argument lists, parameters, or statement lists. Reusing the same metavariable requires the same code shape, so `$A == $A` matches `x == x` but not `x == y`.

Specify `-l <language>` when inference is ambiguous, reading from stdin, or the pattern is not in a normal source file. Common values include `ts`, `tsx`, `js`, `jsx`, `rust`, `go`, `python`, `zig`, `c`, and `cpp`.

## Rule YAML for complex cases

Use YAML when a single pattern is too blunt: filtering metavariables, requiring containment, excluding cases, or attaching a reusable fix.

```yaml
id: replace-console-log
language: TypeScript
rule:
  pattern: console.log($$$ARGS)
message: use logger instead of console.log
fix: logger.log($$$ARGS)
```

Run it with:

```sh
ast-grep scan --rule /tmp/replace-console-log.yml --interactive src
```

Reach for relational rules instead of script logic:

```yaml
id: await-inside-promise-all
language: TypeScript
rule:
  pattern: Promise.all($A)
  has:
    pattern: await $_
    stopBy: end
```

Use `constraints` to filter a captured single metavariable:

```yaml
rule:
  pattern: console.log($ARG)
constraints:
  ARG:
    kind: string
```

For more examples, read `references/cookbook.md`.

## Guardrails

Do not use ast-grep blindly. If the transformation depends on type resolution, symbol ownership, import graph semantics, macro expansion, or control/data flow, ast-grep may be only the discovery step.

Do not write a custom refactor script until ast-grep has been tried or rejected for a concrete reason. Good rejection reasons: unsupported language, malformed generated code, required type information, cross-file state that ast-grep cannot express, or a transformation that needs real parsing plus semantic analysis.

Keep refactors reviewable: search first, rewrite second, format/test third, summarize the pattern used and why it was safe.
