---
name: orbstack
description: Use OrbStack on Matt's Mac for Docker/Compose, Linux machines, isolated sandboxes, Kubernetes, networking/domains, file access, SSH, and troubleshooting. Trigger when working with OrbStack-specific commands (`orb`, `orbctl`, `mac`), `.orb.local` domains, OrbStack Docker context/socket behavior, OrbStack machines, isolated machines for untrusted code, or Kubernetes under OrbStack.
---

# OrbStack

Use this skill when OrbStack is part of the environment, not for generic Docker/Kubernetes advice. Prefer the installed CLI as the source of truth, then fall back to the docs notes in `references/docs-notes.md`.

## First checks

Start by checking the live machine, because Matt keeps OrbStack current and docs can lag the installed CLI:

```sh
orb version
orb status
orb list
docker context ls
```

For command details, use `orb help` and `orb <command> --help` instead of guessing flags. Treat the current machine list as runtime state, not skill content.

## Common workflows

For Docker/Compose, use normal `docker` and `docker compose`; OrbStack supplies the engine and usually selects the `orbstack` context automatically. Use `orb logs docker` for engine logs and `orb config docker` for daemon config. Do not expose Docker TCP sockets casually; that is effectively remote root on the Mac.

For Linux commands, run `orb <cmd>` in the default machine or `orb -m <machine> -u <user> <cmd>` for a specific target. Use `orb push` and `orb pull` for explicit file transfer, or paths under `/mnt/mac` and `~/OrbStack/<machine>` for integrated file sharing.

For untrusted code or autonomous agents, prefer an isolated machine:

```sh
orb create --isolated --isolate-network --mount ~/project:/work ubuntu sandbox
```

Only add `--forward-ssh-agent` or broad mounts when the task actually needs them. Isolated machines reduce file/host exposure but are not malware sandboxes.

For local service access, remember OrbStack domains before inventing port-forwarding glue: containers use `<container>.orb.local`, Compose services use `<service>.<project>.orb.local`, machines use `<machine>.orb.local`, and Kubernetes uses `*.k8s.orb.local`. If automatic web-port detection chooses wrong, set `dev.orbstack.http-port`.

For Kubernetes, use OrbStack's built-in cluster unless the task explicitly needs multi-node behavior. Locally built Docker images are already visible to Pods; avoid `:latest` or set `imagePullPolicy: IfNotPresent`.

## Reference

Read `references/docs-notes.md` when you need exact OrbStack behavior for networking, domains, isolated machines, file sharing, SSH, engine config, or Kubernetes.
