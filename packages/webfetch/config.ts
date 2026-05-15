import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type ModelSpec = {
  provider: string;
  id: string;
};

export type WebfetchConfig = {
  objectiveModel?: ModelSpec;
};

const GLOBAL_SETTINGS_PATH = path.join(os.homedir(), ".pi", "agent", "settings.json");
const PROJECT_SETTINGS_PATH = path.join(".pi", "settings.json");

type SettingsShape = {
  webfetch?: {
    objectiveModel?: unknown;
    objective?: {
      model?: unknown;
    };
  };
};

export async function loadWebfetchConfig(cwd?: string): Promise<WebfetchConfig> {
  const [globalSettings, projectSettings] = await Promise.all([
    readSettings(GLOBAL_SETTINGS_PATH),
    cwd ? readSettings(path.join(cwd, PROJECT_SETTINGS_PATH)) : Promise.resolve({}),
  ]);

  return {
    ...extractWebfetchConfig(globalSettings),
    ...extractWebfetchConfig(projectSettings),
  };
}

export function parseModelSpec(value: unknown): ModelSpec | undefined {
  if (!value) return undefined;

  if (typeof value === "string") {
    const [provider, ...rest] = value.split("/");
    const id = rest.join("/");
    if (!provider || !id) return undefined;
    return { provider, id };
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const provider = record.provider;
    const id = record.id ?? record.modelId ?? record.model;
    if (typeof provider === "string" && typeof id === "string" && provider && id)
      return { provider, id };
  }

  return undefined;
}

async function readSettings(filePath: string): Promise<SettingsShape> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as SettingsShape;
  } catch {
    return {};
  }
}

function extractWebfetchConfig(settings: SettingsShape): WebfetchConfig {
  return {
    objectiveModel: parseModelSpec(
      settings.webfetch?.objectiveModel ?? settings.webfetch?.objective?.model,
    ),
  };
}
