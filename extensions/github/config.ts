import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type CiWatchConfig = {
  /** Master switch. Default off: the watcher is passive background behavior. */
  enabled: boolean;
  /** Seconds between check polls while a watched head has pending checks. */
  pollSeconds: number;
  /** Seconds to wait for checks to appear on a freshly pushed head. */
  discoveryGraceSeconds: number;
  /** When idle, trigger a turn so the agent wakes up and addresses the failure. */
  wakeOnFailure: boolean;
  /**
   * When a transition failure steers the agent, instruct it to resume the task
   * it was working on before the interruption after fixing CI and pushing.
   */
  resumeAfterFix: boolean;
};

export const DEFAULT_CI_WATCH_CONFIG: CiWatchConfig = {
  enabled: false,
  pollSeconds: 30,
  discoveryGraceSeconds: 90,
  wakeOnFailure: true,
  resumeAfterFix: true,
};

type SettingsShape = {
  github?: {
    ciWatch?: {
      enabled?: unknown;
      pollSeconds?: unknown;
      discoveryGraceSeconds?: unknown;
      wakeOnFailure?: unknown;
      resumeAfterFix?: unknown;
    };
  };
};

const GLOBAL_SETTINGS_PATH = path.join(os.homedir(), ".pi", "agent", "settings.json");

/**
 * Reads `github.ciWatch` from global settings, with project `.pi/settings.json`
 * overriding individual keys. Unknown/garbage values fall back to defaults.
 */
export async function loadCiWatchConfig(cwd?: string): Promise<CiWatchConfig> {
  const [globalSettings, projectSettings] = await Promise.all([
    readSettings(GLOBAL_SETTINGS_PATH),
    cwd ? readSettings(path.join(cwd, ".pi", "settings.json")) : Promise.resolve({}),
  ]);
  return {
    ...DEFAULT_CI_WATCH_CONFIG,
    ...extract(globalSettings),
    ...extract(projectSettings),
  };
}

async function readSettings(filePath: string): Promise<SettingsShape> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as SettingsShape;
  } catch {
    return {};
  }
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function secondsValue(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const seconds = Math.floor(value);
  return seconds >= min && seconds <= max ? seconds : undefined;
}

function extract(settings: SettingsShape): Partial<CiWatchConfig> {
  const ciWatch = settings.github?.ciWatch;
  if (!ciWatch) return {};
  const config: Partial<CiWatchConfig> = {};
  const enabled = booleanValue(ciWatch.enabled);
  if (enabled !== undefined) config.enabled = enabled;
  const pollSeconds = secondsValue(ciWatch.pollSeconds, 5, 600);
  if (pollSeconds !== undefined) config.pollSeconds = pollSeconds;
  const discoveryGraceSeconds = secondsValue(ciWatch.discoveryGraceSeconds, 10, 1800);
  if (discoveryGraceSeconds !== undefined) config.discoveryGraceSeconds = discoveryGraceSeconds;
  const wakeOnFailure = booleanValue(ciWatch.wakeOnFailure);
  if (wakeOnFailure !== undefined) config.wakeOnFailure = wakeOnFailure;
  const resumeAfterFix = booleanValue(ciWatch.resumeAfterFix);
  if (resumeAfterFix !== undefined) config.resumeAfterFix = resumeAfterFix;
  return config;
}
