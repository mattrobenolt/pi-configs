import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

interface ModelConfig {
  id: string;
  providerParams?: Record<string, unknown>;
}

interface ModelsConfig {
  providers?: Record<string, { models?: ModelConfig[] }>;
}

const MODELS_PATH = path.join(os.homedir(), ".pi", "agent", "models.json");

function loadProviderParams(): Map<string, Record<string, unknown>> {
  const config = JSON.parse(fs.readFileSync(MODELS_PATH, "utf-8")) as ModelsConfig;
  const params = new Map<string, Record<string, unknown>>();

  for (const provider of Object.values(config.providers ?? {})) {
    for (const model of provider.models ?? []) {
      if (model.providerParams && Object.keys(model.providerParams).length > 0) {
        params.set(model.id, model.providerParams);
      }
    }
  }

  return params;
}

export default function (pi: ExtensionAPI) {
  pi.on("before_provider_request", (event, ctx) => {
    if (!event.payload || typeof event.payload !== "object") return;

    const payload = event.payload as Record<string, unknown>;
    if (typeof payload.model !== "string") return;

    const params = loadProviderParams().get(payload.model);
    if (!params) return;

    return {
      ...payload,
      ...params,
      user:
        typeof payload.user === "string" ? payload.user : `pi:${ctx.sessionManager.getSessionId()}`,
    };
  });
}
