# pi-profile

`pi-profile` gives Pi launch-time profiles without changing Pi itself. A profile
is a normal `PI_CODING_AGENT_DIR` materialized as an overlay over the base agent
dir.

```text
~/.pi/agent          # base/default Pi config
~/.pi/agent-work     # work profile overlay
~/.pi/agent-personal # personal profile overlay
```

Pi still reads and writes ordinary files. `pi-profile` only prepares the profile
dir before launch.

## Overlay model

Profiles keep a few top-level files local:

```text
auth.json
settings.json
modes.json
```

Every other top-level entry from the base dir is symlinked into the profile dir.
That means extensions, skills, sessions, packages, models, memory, and other
shared state stay shared by default.

If you replace a managed symlink with a real file or directory, that path becomes
a profile-local override. `sync` will not overwrite it.

## Commands

```sh
pi-profile init <name>              # create ~/.pi/agent-<name>
pi-profile list                     # list profiles, marking the default with *
pi-profile status <name>            # show local files, shared links, overrides
pi-profile sync <name>              # add/repair shared links
pi-profile path <name|default>      # print the profile dir
pi-profile default [name]           # show or set the default profile
pi-profile run <name|default> -- ... # sync, then launch Pi
```

Typical use:

```sh
pi-profile init work
pi-profile init personal
pi-profile default work
pi-profile run default -- -c
```

With the global wrapper installed, `pi` can simply delegate to:

```sh
pi-profile run default -- "$@"
```

So switching daily context is just:

```sh
pi-profile default work
pi-profile default personal
```

## Environment

```text
PI_PROFILE_BASE_DIR  Override the base dir, default ~/.pi/agent
PI_PROFILE_PI_BIN    Override the Pi executable, default <base>/node_modules/.bin/pi
```

`run` launches the base Pi binary directly by default instead of resolving `pi`
from `PATH`. That avoids recursion when the global `pi` wrapper itself delegates
to `pi-profile run default`.

## Safety model

`pi-profile` never writes to the base dir. It only creates, repairs, or removes
managed symlinks inside profile dirs. Real files in a profile dir are treated as
profile-owned and are not overwritten by sync.

The default profile is stored outside the base dir at:

```text
~/.pi/pi-profile.json
```

That keeps `~/.pi/agent` usable as a plain, unprofiled Pi config.
