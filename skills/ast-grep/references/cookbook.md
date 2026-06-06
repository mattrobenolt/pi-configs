# ast-grep Cookbook

Load this when writing a non-trivial ast-grep search or replacement.

## One-shot search and rewrite

Find matching call sites:

```sh
ast-grep -p 'oldName($$$ARGS)' -l ts src
```

Rewrite them interactively:

```sh
ast-grep -p 'oldName($$$ARGS)' --rewrite 'newName($$$ARGS)' -l ts src --interactive
```

Use `--json=compact` or `--json=stream` when you need machine-readable match output for counting or auditing, not for rewriting.

## API call migration

```sh
ast-grep -p '$CLIENT.query($SQL, $$$ARGS)' \
  --rewrite '$CLIENT.sql($SQL, $$$ARGS)' \
  -l ts src --interactive
```

The receiver metavariable keeps the existing object expression intact.

## Boolean/control-flow shape

Search for redundant async wrappers:

```sh
ast-grep -p 'async function $F($$$ARGS) { return await $EXPR }' -l ts src
```

This is a good discovery pattern. Be careful rewriting it automatically if surrounding `try`/`catch` changes behavior.

## Imports

Imports are syntax-sensitive and easy to botch with regex. Use ast-grep to find the shape, then consider whether import merging/sorting needs the language formatter or a dedicated tool.

```sh
ast-grep -p 'import { $NAME } from "$MOD"' -l ts src
```

For broad import rewrites, inspect output first. Import lists often need multi-node matching and formatter cleanup.

## YAML with all/any/not

```yaml
id: no-debugger-except-tests
language: TypeScript
rule:
  all:
    - pattern: debugger
    - not:
        inside:
          pattern: describe($$$ARGS)
          stopBy: end
message: debugger outside tests
```

## YAML with inside/has

```yaml
id: throw-in-timeout
language: TypeScript
rule:
  pattern: throw $ERR
  inside:
    pattern: setTimeout($$$ARGS)
    stopBy: end
```

`inside` constrains the matched node by ancestors. `has` constrains it by descendants. Add `stopBy: end` when the related node may be nested more deeply than the default neighbor search.

## Constraints

Constraints apply to single metavariables, not `$$$ARGS`.

```yaml
id: string-console-log
language: TypeScript
rule:
  pattern: console.log($ARG)
constraints:
  ARG:
    kind: string
fix: logger.info($ARG)
```

## Fixes

A string `fix` replaces the matched AST node:

```yaml
id: prefer-nullish
language: TypeScript
rule:
  pattern: $A || $B
fix: $A ?? $B
```

Do not apply semantic fixes like this blindly; `||` and `??` are not equivalent for `0`, `''`, or `false`. This example is a syntax demo, not a free migration pass.

For deleting list items or object pairs, a plain empty fix may leave commas. Use `expandStart`/`expandEnd` only after testing on a sample file.

## Testing patterns safely

Create a tiny scratch file with positive and negative examples, then run ast-grep against it before touching the repo:

```sh
cat >/tmp/sg-sample.ts <<'EOF'
oldName(a)
oldName(a, b)
notOldName(a)
EOF
ast-grep -p 'oldName($$$ARGS)' -l ts /tmp/sg-sample.ts
```

For repo changes, prefer this loop:

```sh
ast-grep -p 'PATTERN' -l ts src
ast-grep -p 'PATTERN' --rewrite 'REWRITE' -l ts src --interactive
pnpm fmt
pnpm check
```

Adjust the final commands to the project. Do not run `pnpm` just because this file says so.
