# OrbStack docs notes

Sources checked: docs.orbstack.dev quick start, Docker, container networking, domains, Linux machines, machine commands, isolated machines, file sharing, SSH, native files, Kubernetes. Re-check docs when exact syntax matters.

## CLI and state

- `orb version`, `orb status`, `orb list` show installed version, running state, and machines.
- `orb help` and `orb <command> --help` are authoritative for the installed version.
- `orb` with no args opens a shell in the default machine.
- `orb <cmd>` runs a Linux command in the default machine.
- Use `orb -m <machine> -u <user> <cmd>` to target a machine/user.
- Machine management: `orb create`, `orb clone`, `orb export`, `orb import`, `orb start`, `orb stop`, `orb restart`, `orb delete`, `orb logs`, `orb default`, `orb info`.
- `orb push` copies Mac -> Linux; `orb pull` copies Linux -> Mac.
- `orb config set ...` changes settings; `orb config docker` edits Docker daemon config; restart affected services after config changes.

## Docker

- OrbStack provides Docker Engine, Compose, and buildx. Docker context is `orbstack` and is normally selected automatically.
- `/var/run/docker.sock` may be symlinked for compatibility when admin access is available.
- Engine config lives at `~/.orbstack/config/docker.json`; `orb restart docker` restarts Docker.
- Engine logs: `orb logs docker`.
- For best filesystem performance with Docker volumes, use `~/OrbStack/docker`.
- Native file access:
  - containers: `~/OrbStack/docker/containers/<name>`
  - images: `~/OrbStack/docker/images/<tag>`
  - volumes: `~/OrbStack/docker/volumes/<name>`
  - machines: `~/OrbStack/<machine>`
- SSH agent into containers:
  ```sh
  docker run -it --rm \
    -v /run/host-services/ssh-auth.sock:/agent.sock \
    -e SSH_AUTH_SOCK=/agent.sock \
    alpine
  ```
- On Apple Silicon, run/build amd64 images with `--platform linux/amd64`; `DOCKER_DEFAULT_PLATFORM=linux/amd64` makes that default.

## Docker networking and domains

- Containers get automatic domains:
  - single container: `<container>.orb.local`
  - Compose service: `<service>.<project>.orb.local`
- Web services usually do not need port numbers on `.orb.local`; OrbStack probes ports and remembers the result.
- Override detection with label `dev.orbstack.http-port=8080`.
- Add custom `.local` domains with label `dev.orbstack.domains=foo.local,bar.local`; wildcards like `*.foo.local` are supported.
- `https://orb.local` lists running services; HTTPS is automatic for OrbStack domains.
- Containers can reach macOS with `host.docker.internal`; with `--net=host`, localhost works both directions.
- Port forwards (`-p`) are exposed to LAN by default unless disabled via Docker setting `docker.expose_ports_to_lan` / app setting.
- Container domains and direct IP access depend on “Allow access to container domains & IPs” in Network settings.
- Containers follow macOS proxy settings automatically. Override with `orb config set network_proxy ...`; reset with `auto`; disable with `none`.

## Linux machines

- Create a machine: `orb create ubuntu <name>`; older distros use tags like `ubuntu:jammy`.
- Create amd64 machine on Apple Silicon: `orb create --arch amd64 ubuntu <name>`.
- Set resource limits on create: `orb create --memory 4G --cpus 2 --disk 64G ubuntu <name>`.
- Set resource limits later:
  ```sh
  orb config set machine.<name>.memory_mib 4096
  orb config set machine.<name>.cpu 2
  orb config set machine.<name>.disk_bytes 68719476736
  ```
- Mac files are available inside integrated machines at the same paths and under `/mnt/mac`.
- Other machines are mounted at `/mnt/machines/<name>`.
- Linux files are available from Mac at `~/OrbStack/<machine>`.
- `mac <cmd>` runs macOS commands from Linux; `mac link <cmd>` exposes a Mac command as if native. `open`, `osascript`, and `code` are linked by default.
- SSH agent is forwarded automatically to non-isolated machines.
- Forward additional env vars with `ORBENV=VAR1:VAR2 orb <cmd>`.
- Root shell/command: `orb -u root ...`; machines have passwordless sudo by default.
- Boot logs: `orb logs <machine>`.
- Nested KVM virtualization is not supported on Apple Silicon.

## Isolated machines

Use isolated machines for untrusted code, dependency installs, and agent sandboxes. They reduce blast radius but are not malware-grade isolation because machines/containers share OrbStack’s Linux VM/kernel.

- Create: `orb create --isolated ubuntu <name>`.
- No Mac filesystem mount, no direct macOS host networking, no `mac` commands, no SSH agent by default, no USB/serial/sound passthrough.
- Selective mount: `orb create --isolated --mount ~/project:/work ubuntu <name>`.
- Stronger network isolation while keeping internet: `--isolate-network`.
- Enable SSH agent explicitly: `--forward-ssh-agent`.
- Change later, then restart machine:
  ```sh
  orb config set machine.<name>.isolated true
  orb config set machine.<name>.isolate_network true
  orb config set machine.<name>.forward_ssh_agent true
  orb config set machine.<name>.mounts '~/project:/work'
  ```

## SSH into machines

- `ssh orb` connects to the default machine.
- `ssh <machine>@orb`, `ssh <user>@orb`, or `ssh <user>@<machine>@orb` target machine/user.
- For non-OpenSSH clients: host `localhost`, port `32222`, user `default` or encoded target, key `~/.orbstack/ssh/id_ed25519`.
- OrbStack SSH only listens on localhost. Use SSH forwarding or install an SSH server inside the machine for remote access.

## Kubernetes

- OrbStack has a lightweight single-node Kubernetes cluster using the same container engine as Docker.
- Locally built images are immediately available to Pods. Avoid `:latest` or set `imagePullPolicy: IfNotPresent` so Kubernetes does not pull over your local image.
- Manage cluster:
  ```sh
  orb start k8s
  orb stop k8s
  orb restart k8s
  orb delete k8s
  ```
- `kubectl` is included with OrbStack.
- `cluster.local` service domains are reachable from macOS.
- LoadBalancer and Ingress are reachable under `*.k8s.orb.local`; API server is `k8s.orb.local`.
- NodePorts are reachable at `localhost:<nodePort>`; ClusterIP and Pod IPs are directly reachable from macOS.
- NodePort/LoadBalancer ports are localhost-only by default; app setting can expose them to LAN.
- Useful configs:
  ```sh
  orb config set k8s.kubeconfig_use_domain true
  orb config set k8s.tls_san name1,name2
  ```
