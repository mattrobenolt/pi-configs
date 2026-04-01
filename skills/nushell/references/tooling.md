# Nushell Formatting, Linting, and CI Tooling

## Formatting — nufmt

There is **no built-in `nu fmt`**. `nufmt` is a separate tool in the nushell org.

```nix
# Add to devshell packages in flake.nix
packages = with pkgs; [ nushell nufmt ];
# If not yet in nixpkgs: nix run github:nushell/nufmt -- file.nu
```

```bash
nufmt file.nu                  # format in place
nufmt --dry-run **/*.nu        # check mode — exits 1 if any file would change (CI)
```

Configure via `nufmt.nuon` in the project root:

```nu
{
    indent: 4,
    line_length: 80,
}
```

**Status:** pre-release, targets ~0.109+, works on 0.111. Not yet production-grade.

## Syntax Validation — nu-check (nushell built-in)

`nu-check` is a built-in nushell command — available inside a `nu` session, not as a standalone CLI tool. Call it via `nu -c` from bash/just:

```bash
# From bash/just (CI-friendly):
nu -c "nu-check script.nu"
nu -c "nu-check --debug script.nu"   # show parse errors
```

```nu
# Inside a nu script:
nu-check script.nu             # returns true/false
nu-check --as-module module.nu # validate as a module
open script.nu | nu-check      # pipe input
```

**Limitation:** does not catch deprecated API usage — returns `true` for scripts using removed syntax.

## Editor Support — nu --lsp (built-in)

`nu --lsp` is built into the binary since v0.87. Editors launch it automatically:

- **VS Code:** official nushell extension
- **Neovim:** `nvim-lspconfig` or `LhKipp/nvim-nu`
- **Helix, Zed, Lapce:** native LSP config

Provides diagnostics, completions, hover, go-to-definition with no extra install.

## Style Conventions

From the official style guide:

- **Line length:** 80 chars; break pipelines across lines when over 80
- **Command names:** `kebab-case`
- **Variables/params:** `snake_case`
- **Environment variables:** `SCREAMING_SNAKE_CASE`
- **Spacing:** single space before/after `|`, after `:` in records, after `,`; no commas needed between list items

## Linting — nu-lint (community, early-stage)

`nu-lint` is a community tool with 150+ rules (idioms, type-safety, naming, performance, etc.) and an LSP server. Early-stage — rule names may change between versions.

```bash
cargo install nu-lint
nu-lint script.nu
```
