/**
 * Core profile management logic.
 *
 * Profiles are materialized overlay directories over a base Pi agent dir.
 * ~/.pi/agent           base/default (untouched by this tool)
 * ~/.pi/agent-<name>    profile overlay dir
 *
 * Locally-owned files (real files, not symlinks):
 *   auth.json, settings.json, modes.json
 *
 * Everything else is a managed symlink pointing into the base dir.
 * If you drop a real file in the profile dir it becomes a profile-local override.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const METADATA_FILE = ".pi-profile.json";
export const CONFIG_FILE = "pi-profile.json";
export const DEFAULT_BASE_DIR = path.join(os.homedir(), ".pi", "agent");

// Files that are always real, profile-local copies (never symlinked to base).
export const DEFAULT_LOCAL_PATHS = ["auth.json", "settings.json", "modes.json"];

// For auth.json on init we create an empty object. For settings/modes we copy
// from base if present, because you probably want current defaults as a
// starting point. After init the profile owns all three.

export interface ProfileMetadata {
  version: 1;
  profile: string;
  baseDir: string;
  localPaths: string[];
  /** Symlinks managed by pi-profile. entry name -> absolute target */
  managedLinks: Record<string, string>;
}

export interface ProfileConfig {
  version: 1;
  defaultProfile?: string;
}

export interface Profile {
  name: string;
  dir: string;
  baseDir: string;
  meta: ProfileMetadata;
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

export function profileDir(name: string, baseDir = DEFAULT_BASE_DIR): string {
  const resolvedBase = path.resolve(baseDir);
  return path.join(path.dirname(resolvedBase), `${path.basename(resolvedBase)}-${name}`);
}

export function metadataPath(dir: string): string {
  return path.join(dir, METADATA_FILE);
}

export function configPath(baseDir = DEFAULT_BASE_DIR): string {
  return path.join(path.dirname(path.resolve(baseDir)), CONFIG_FILE);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const VALID_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export function validateName(name: string): void {
  if (!name || !VALID_NAME.test(name)) {
    throw new Error(
      `Invalid profile name "${name}". Use 1-64 letters, digits, hyphens, or underscores, and don't start with a hyphen.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Metadata IO
// ---------------------------------------------------------------------------

export function readMetadata(dir: string): ProfileMetadata | null {
  const p = metadataPath(dir);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as ProfileMetadata;
  } catch {
    throw new Error(`Failed to parse ${p}. It may be corrupt.`);
  }
}

export function writeMetadata(dir: string, meta: ProfileMetadata): void {
  fs.writeFileSync(metadataPath(dir), JSON.stringify(meta, null, 2) + "\n");
}

export function readConfig(baseDir = DEFAULT_BASE_DIR): ProfileConfig {
  const p = configPath(baseDir);
  if (!fs.existsSync(p)) return { version: 1 };
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as ProfileConfig;
  } catch {
    throw new Error(`Failed to parse ${p}. It may be corrupt.`);
  }
}

export function writeConfig(baseDir: string, config: ProfileConfig): void {
  fs.writeFileSync(configPath(baseDir), JSON.stringify(config, null, 2) + "\n");
}

export function getDefaultProfile(baseDir = DEFAULT_BASE_DIR): string | undefined {
  return readConfig(baseDir).defaultProfile;
}

export function setDefaultProfile(name: string, baseDir = DEFAULT_BASE_DIR): void {
  validateName(name);
  const dir = profileDir(name, baseDir);
  if (!fs.existsSync(dir) || !readMetadata(dir)) {
    throw new Error(`Profile "${name}" does not exist. Run: pi-profile init ${name}`);
  }
  writeConfig(baseDir, { ...readConfig(baseDir), version: 1, defaultProfile: name });
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

export function init(name: string, baseDir = DEFAULT_BASE_DIR): Profile {
  validateName(name);
  baseDir = path.resolve(baseDir);

  if (!fs.existsSync(baseDir)) {
    throw new Error(`Base dir does not exist: ${baseDir}\nRun pi at least once first.`);
  }

  const dir = profileDir(name, baseDir);

  if (fs.existsSync(dir)) {
    const existing = readMetadata(dir);
    if (existing) {
      throw new Error(`Profile "${name}" already exists at ${dir}\nUse "sync" to repair symlinks.`);
    }
    // Directory exists but no metadata — could be a stray dir.
    throw new Error(
      `Directory already exists at ${dir} but is not a pi-profile.\nRemove it manually if you want to use this profile name.`,
    );
  }

  fs.mkdirSync(dir, { recursive: true });

  const meta: ProfileMetadata = {
    version: 1,
    profile: name,
    baseDir,
    localPaths: [...DEFAULT_LOCAL_PATHS],
    managedLinks: {},
  };

  // Create local files
  initLocalFiles(dir, baseDir, meta.localPaths);

  // Symlink all other top-level base entries
  const links = syncLinks(dir, baseDir, meta.localPaths, meta.managedLinks);
  meta.managedLinks = links;

  writeMetadata(dir, meta);

  return { name, dir, baseDir, meta };
}

function initLocalFiles(dir: string, baseDir: string, localPaths: string[]): void {
  for (const entry of localPaths) {
    const dest = path.join(dir, entry);
    if (fs.existsSync(dest)) continue;

    if (entry === "auth.json") {
      // Never copy auth from base — that's the whole point.
      fs.writeFileSync(dest, "{}\n");
    } else {
      const src = path.join(baseDir, entry);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, dest);
      }
      // If base doesn't have it either, leave it absent; Pi will create it.
    }
  }
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

/**
 * Sync managed symlinks for a profile. Creates missing links, repairs stale
 * ones, never touches local files or user overrides.
 */
export function sync(dir: string): ProfileMetadata {
  const meta = readMetadata(dir);
  if (!meta) {
    throw new Error(`Not a pi-profile directory: ${dir}`);
  }

  const links = syncLinks(dir, meta.baseDir, meta.localPaths, meta.managedLinks);
  meta.managedLinks = links;
  writeMetadata(dir, meta);
  return meta;
}

function syncLinks(
  dir: string,
  baseDir: string,
  localPaths: string[],
  previousManagedLinks: Record<string, string>,
): Record<string, string> {
  const localSet = new Set(localPaths.map((p) => path.basename(p)));
  const managedLinks: Record<string, string> = {};

  if (!fs.existsSync(baseDir)) return managedLinks;

  const baseEntries = new Set(fs.readdirSync(baseDir));

  for (const entry of baseEntries) {
    // Skip profile metadata file
    if (entry === METADATA_FILE) continue;
    // Local-only paths are never symlinked
    if (localSet.has(entry)) continue;

    const linkPath = path.join(dir, entry);
    const target = path.join(baseDir, entry);
    const wasManaged = previousManagedLinks[entry] !== undefined;

    let stat: fs.Stats | null = null;
    try {
      stat = fs.lstatSync(linkPath);
    } catch {
      // Doesn't exist — create symlink
      fs.symlinkSync(target, linkPath);
      managedLinks[entry] = target;
      continue;
    }

    if (stat.isSymbolicLink()) {
      const currentTarget = fs.readlinkSync(linkPath);
      if (wasManaged || currentTarget === target) {
        // Repair symlinks we own. Adopt exact base links too; they match the
        // materialized-overlay contract and make manually-created profiles easy
        // to bring under management.
        if (currentTarget !== target) {
          fs.unlinkSync(linkPath);
          fs.symlinkSync(target, linkPath);
        }
        managedLinks[entry] = target;
      }
    }
    // Real file or directory = user override, leave it alone entirely.
  }

  for (const [entry, oldTarget] of Object.entries(previousManagedLinks)) {
    if (baseEntries.has(entry) && !localSet.has(entry)) continue;

    const linkPath = path.join(dir, entry);
    try {
      const stat = fs.lstatSync(linkPath);
      if (stat.isSymbolicLink() && fs.readlinkSync(linkPath) === oldTarget) {
        fs.unlinkSync(linkPath);
      }
    } catch {
      // Already gone, which is fine.
    }
  }

  return managedLinks;
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export interface ProfileStatus {
  name: string;
  dir: string;
  baseDir: string;
  exists: boolean;
  local: string[];
  managed: Array<{ entry: string; target: string; stale: boolean }>;
  overrides: string[];
  unknown: string[];
}

export function status(dir: string): ProfileStatus {
  const meta = readMetadata(dir);
  if (!meta) {
    throw new Error(`Not a pi-profile directory: ${dir}`);
  }

  const localSet = new Set(meta.localPaths.map((p) => path.basename(p)));
  const managedSet = new Set(Object.keys(meta.managedLinks));

  const local: string[] = [];
  const managed: ProfileStatus["managed"] = [];
  const overrides: string[] = [];
  const unknown: string[] = [];

  const entries = fs.readdirSync(dir);

  for (const entry of entries) {
    if (entry === METADATA_FILE) continue;
    const fullPath = path.join(dir, entry);

    let isSymlink = false;
    let symlinkTarget: string | null = null;
    try {
      const stat = fs.lstatSync(fullPath);
      isSymlink = stat.isSymbolicLink();
      if (isSymlink) symlinkTarget = fs.readlinkSync(fullPath);
    } catch {}

    if (localSet.has(entry)) {
      local.push(entry);
    } else if (isSymlink) {
      const expectedTarget = path.join(meta.baseDir, entry);
      const stale = symlinkTarget !== expectedTarget;
      managed.push({ entry, target: symlinkTarget!, stale });
    } else if (managedSet.has(entry)) {
      // Was managed but is now a real file — it's an override
      overrides.push(entry);
    } else {
      overrides.push(entry);
    }
  }

  // Also check for base entries that are missing from the profile
  if (fs.existsSync(meta.baseDir)) {
    const baseEntries = new Set(fs.readdirSync(meta.baseDir));
    for (const entry of baseEntries) {
      if (entry === METADATA_FILE) continue;
      if (localSet.has(entry)) continue;
      if (!fs.existsSync(path.join(dir, entry))) {
        unknown.push(entry);
      }
    }
  }

  return {
    name: meta.profile,
    dir,
    baseDir: meta.baseDir,
    exists: true,
    local,
    managed,
    overrides,
    unknown,
  };
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export function list(baseDir = DEFAULT_BASE_DIR): Array<{ name: string; dir: string }> {
  const parentDir = path.dirname(baseDir);
  const baseName = path.basename(baseDir);
  const prefix = `${baseName}-`;

  if (!fs.existsSync(parentDir)) return [];

  const results: Array<{ name: string; dir: string }> = [];

  for (const entry of fs.readdirSync(parentDir)) {
    if (!entry.startsWith(prefix)) continue;
    const name = entry.slice(prefix.length);
    if (!name || !VALID_NAME.test(name)) continue;
    const dir = path.join(parentDir, entry);
    const meta = readMetadata(dir);
    if (meta) results.push({ name, dir });
  }

  return results;
}
