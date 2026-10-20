---
name: security-audit-runner
description: Run a full Cloudflare-method security audit of a repository with the Linux audit runner at ~/code/planetscale/security-audit. Use when asked to security audit, pen-test, or hunt vulnerabilities across a codebase or a pinned revision, to resume or report an interrupted audit, or to check the audit environment. Not for reviewing one diff or answering one security question.
---

# Security audit runner

The runner lives in `~/code/planetscale/security-audit`. Read its `README.md` before the first run in a session.

## Steps

1. Confirm the target. The runner audits a commit snapshot. Get the repository path and a ref from the user, or use `HEAD`.
2. Run the environment check: `cd ~/code/planetscale/security-audit && nix develop -c pnpm exec tsx src/cli.ts doctor`. If it fails, report the failing check. Do not audit.
3. Choose the scope. Pass `--scope` for the trust-boundary code the user cares about. A large repository with no scope spends the budget on reconnaissance.
4. Start the run in a terminal pane, because runs take tens of minutes to hours:
   `nix develop -c pnpm exec tsx src/cli.ts run <repo> --ref <ref> --profile quick --scope <path> --budget 32 --usd 40`
5. If the process stops, resume it. Never start a second run in the same output directory:
   `nix develop -c pnpm exec tsx src/cli.ts resume <out>`
6. Report from `REPORT.md` and `run-metadata.json`. State the terminal status and its reason first.

## Rules

- The default dollar ceiling is $40 per run. Get approval from the user before you raise it or start several runs.
- A `confirmed` record means a cross-family verifier reproduced a result in the sandbox. It does not prove the code under test produced that result. Read the trace and the reproduction before you call it a vulnerability.
- Report `needs_validation` records as open leads, never as vulnerabilities.
- Do not publish findings, open issues, or contact maintainers without the user's approval.
- Targets are limited to code PlanetScale owns or open-source software it runs. The Anthropic routes depend on this Cyber Verification Program scope.
