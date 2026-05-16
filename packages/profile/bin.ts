#!/usr/bin/env node
/**
 * pi-profile — manage Pi coding agent profiles as overlay directories.
 *
 * Usage:
 *   pi-profile list
 *   pi-profile init <name>
 *   pi-profile sync <name>
 *   pi-profile status <name>
 *   pi-profile path <name>
 *   pi-profile run <name|default> [-- <pi args...>]
 *   pi-profile default [name]
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_BASE_DIR,
  getDefaultProfile,
  init,
  list,
  profileDir,
  readMetadata,
  setDefaultProfile,
  status,
  sync,
  validateName,
} from "./profile.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function die(msg: string): never {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(1);
}

function resolveBase(): string {
  // Use the real default, not whatever PI_CODING_AGENT_DIR is set to, because
  // the whole point is to overlay over the base. If someone explicitly wants a
  // different base they can set PI_PROFILE_BASE_DIR.
  return path.resolve(process.env.PI_PROFILE_BASE_DIR ?? DEFAULT_BASE_DIR);
}

function resolveProfileName(name: string): string {
  if (name !== "default") return name;

  const profile = getDefaultProfile(resolveBase());
  if (!profile) {
    die("No default profile configured. Run: pi-profile default <name>");
  }
  return profile;
}

function requireProfileDir(name: string): string {
  name = resolveProfileName(name);
  validateName(name);
  const base = resolveBase();
  const dir = profileDir(name, base);
  if (!fs.existsSync(dir) || !readMetadata(dir)) {
    die(`Profile "${name}" does not exist. Run: pi-profile init ${name}`);
  }
  return dir;
}

function defaultPiBin(): string {
  return path.join(resolveBase(), "node_modules", ".bin", "pi");
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function cmdList(): void {
  const base = resolveBase();
  const profiles = list(base);
  if (profiles.length === 0) {
    console.log("No profiles found.");
    console.log(`Base dir: ${base}`);
    return;
  }
  const defaultProfile = getDefaultProfile(base);
  console.log(`Profiles (base: ${base}):\n`);
  for (const { name, dir } of profiles) {
    const marker = name === defaultProfile ? "*" : " ";
    console.log(`${marker} ${name.padEnd(20)} ${dir}`);
  }
}

function cmdInit(name: string): void {
  const base = resolveBase();
  console.log(`Initializing profile "${name}"...`);
  console.log(`  base: ${base}`);
  const profile = init(name, base);
  console.log(`  dir:  ${profile.dir}`);
  console.log(`\nProfile "${name}" created.`);
  console.log(`\nLocal files (profile-owned):`);
  for (const p of profile.meta.localPaths) {
    const full = path.join(profile.dir, p);
    const exists = fs.existsSync(full);
    console.log(`  ${p}${exists ? "" : " (not yet created by Pi)"}`);
  }
  const linkCount = Object.keys(profile.meta.managedLinks).length;
  console.log(`\nShared links: ${linkCount} entries symlinked from base.`);
  console.log(`\nTo launch Pi with this profile:`);
  console.log(`  PI_CODING_AGENT_DIR="${profile.dir}" pi`);
  console.log(`\nOr:`);
  console.log(`  pi-profile run ${name}`);
}

function cmdSync(name: string): void {
  const dir = requireProfileDir(name);
  const meta = sync(dir);
  const linkCount = Object.keys(meta.managedLinks).length;
  console.log(`Profile "${name}" synced. ${linkCount} managed links.`);
}

function cmdStatus(name: string): void {
  const dir = requireProfileDir(name);
  const s = status(dir);

  console.log(`Profile: ${s.name}`);
  console.log(`Dir:     ${s.dir}`);
  console.log(`Base:    ${s.baseDir}`);
  console.log();

  if (s.local.length > 0) {
    console.log("Local (profile-owned):");
    for (const entry of s.local) {
      const full = path.join(s.dir, entry);
      const exists = fs.existsSync(full);
      console.log(`  ${entry}${exists ? "" : "  [missing]"}`);
    }
    console.log();
  }

  if (s.overrides.length > 0) {
    console.log("Overrides (real files shadowing base):");
    for (const entry of s.overrides) {
      console.log(`  ${entry}`);
    }
    console.log();
  }

  if (s.managed.length > 0) {
    const stale = s.managed.filter((m) => m.stale);
    const good = s.managed.filter((m) => !m.stale);
    if (stale.length > 0) {
      console.log("Stale links (run sync to repair):");
      for (const m of stale) {
        console.log(`  ${m.entry} -> ${m.target}  [stale]`);
      }
      console.log();
    }
    console.log(`Shared links: ${good.length} entries linked from base.`);
  }

  if (s.unknown.length > 0) {
    console.log();
    console.log("Missing links (base entries not present in profile — run sync):");
    for (const entry of s.unknown) {
      console.log(`  ${entry}`);
    }
  }
}

function cmdPath(name: string): void {
  const dir = requireProfileDir(name);
  process.stdout.write(dir + "\n");
}

function cmdDefault(name: string | undefined): void {
  const base = resolveBase();
  if (!name) {
    const current = getDefaultProfile(base);
    if (!current) die("No default profile configured.");
    console.log(current);
    return;
  }

  setDefaultProfile(name, base);
  console.log(`Default profile set to "${name}".`);
}

function cmdRun(name: string, piArgs: string[]): void {
  const dir = requireProfileDir(name);

  // Sync first
  sync(dir);

  // Use the base Pi binary directly by default. If the global `pi` wrapper is
  // implemented as `pi-profile run default`, launching `pi` from here would
  // recurse forever. The env var is still available for tests or custom setups.
  const piExe = process.env.PI_PROFILE_PI_BIN ?? defaultPiBin();

  const result = spawnSync(piExe, piArgs, {
    stdio: "inherit",
    env: {
      ...process.env,
      PI_CODING_AGENT_DIR: dir,
    },
  });

  if (result.error) {
    die(`Failed to launch pi: ${result.error.message}`);
  }

  if (result.signal) {
    process.kill(process.pid, result.signal);
  } else {
    process.exit(result.status ?? 0);
  }
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

function usage(): void {
  console.log(`Usage: pi-profile <command> [args...]

Commands:
  list                  List all profiles
  init <name>           Create a new profile
  sync <name>           Repair/update managed symlinks
  status <name>         Show profile state
  path <name>           Print the profile directory path
  run <name|default> [-- ...]
                        Sync and launch pi with this profile
  default [name]        Show or set the default profile

Environment variables:
  PI_PROFILE_BASE_DIR   Override base dir (default: ~/.pi/agent)
  PI_PROFILE_PI_BIN     Override pi executable (default: <base>/node_modules/.bin/pi)
`);
}

const args = process.argv.slice(2);
const cmd = args[0];

switch (cmd) {
  case "list":
    cmdList();
    break;

  case "init": {
    const name = args[1];
    if (!name) die("Usage: pi-profile init <name>");
    cmdInit(name);
    break;
  }

  case "sync": {
    const name = args[1];
    if (!name) die("Usage: pi-profile sync <name>");
    cmdSync(name);
    break;
  }

  case "status": {
    const name = args[1];
    if (!name) die("Usage: pi-profile status <name>");
    cmdStatus(name);
    break;
  }

  case "path": {
    const name = args[1];
    if (!name) die("Usage: pi-profile path <name>");
    cmdPath(name);
    break;
  }

  case "default":
    cmdDefault(args[1]);
    break;

  case "run": {
    const name = args[1];
    if (!name) die("Usage: pi-profile run <name> [-- <pi args...>]");
    // Strip optional --
    const rest = args.slice(2);
    const piArgs = rest[0] === "--" ? rest.slice(1) : rest;
    cmdRun(name, piArgs);
    break;
  }

  case "help":
  case "--help":
  case "-h":
    usage();
    break;

  default:
    if (cmd) process.stderr.write(`Unknown command: ${cmd}\n\n`);
    usage();
    process.exit(cmd ? 1 : 0);
}
