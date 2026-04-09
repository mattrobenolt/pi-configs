/**
 * Profile management for pi.
 *
 * Profiles bundle auth credentials + default model settings, selectable via
 * the PI_PROFILE environment variable:
 *
 *   PI_PROFILE=work pi       # or: alias pi-work='PI_PROFILE=work pi'
 *
 * Auth credentials are handled by the pi-profile shell wrapper (scripts/pi-profile),
 * which swaps auth.json before pi starts and restores it on exit. This extension
 * only handles model selection and UI — it never touches auth.json directly.
 *
 * Profile files: ~/.pi/agent/profiles/<name>.json
 * Format:
 *   {
 *     "defaultProvider": "anthropic",
 *     "defaultModel": "claude-sonnet-4-20250514",
 *     "auth": {
 *       "anthropic": { "type": "oauth", "access": "...", "refresh": "...", "expires": 0 },
 *       "openai-codex": { "type": "oauth", "access": "...", "refresh": "...", "expires": 0, "accountId": "..." }
 *     }
 *   }
 *
 * Commands:
 *   /profile          — show active profile and available profiles
 *   /profile list     — list profile names
 *   /profile save [name]  — save current model + OAuth credentials as a profile
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

interface Profile {
  defaultProvider?: string;
  defaultModel?: string;
  auth?: Record<string, unknown>;
}

const PROFILES_DIR = path.join(os.homedir(), ".pi", "agent", "profiles");
const AUTH_FILE = path.join(os.homedir(), ".pi", "agent", "auth.json");

function loadProfile(name: string): Profile | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(PROFILES_DIR, `${name}.json`), "utf-8")) as Profile;
  } catch {
    return null;
  }
}

function saveProfile(name: string, profile: Profile): void {
  fs.mkdirSync(PROFILES_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(PROFILES_DIR, `${name}.json`), JSON.stringify(profile, null, 2), {
    mode: 0o600,
  });
}

function listProfiles(): string[] {
  try {
    return fs
      .readdirSync(PROFILES_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.slice(0, -5))
      .sort();
  } catch {
    return [];
  }
}

function readAuth(): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(AUTH_FILE, "utf-8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    const name = process.env["PI_PROFILE"];
    if (!name) return;

    const profile = loadProfile(name);
    if (!profile) {
      ctx.ui.notify(`Profile "${name}" not found.\nCreate it with: /profile save ${name}`, "error");
      return;
    }

    // Apply default model.
    if (profile.defaultProvider && profile.defaultModel) {
      const model = ctx.modelRegistry.find(profile.defaultProvider, profile.defaultModel);
      if (model) {
        await pi.setModel(model);
      } else {
        ctx.ui.notify(
          `Profile "${name}": model ${profile.defaultProvider}/${profile.defaultModel} not found`,
          "warning",
        );
      }
    }

    // Surface profile name in the footer (rendered by statusline extension).
    ctx.ui.setStatus("profile", name);
  });

  pi.registerCommand("profile", {
    description: "Manage profiles. Usage: /profile [list | save [name]]",
    handler: async (args, ctx) => {
      const parts = (args?.trim() ?? "").split(/\s+/).filter(Boolean);
      const cmd = parts[0];

      if (!cmd) {
        const active = process.env["PI_PROFILE"] ?? "(none)";
        const profiles = listProfiles();
        ctx.ui.notify(
          [
            `Active profile: ${active}`,
            profiles.length > 0 ? `Available: ${profiles.join(", ")}` : "No profiles saved yet.",
          ].join("\n"),
          "info",
        );
        return;
      }

      if (cmd === "list") {
        const profiles = listProfiles();
        ctx.ui.notify(profiles.length > 0 ? profiles.join(", ") : "No profiles saved.", "info");
        return;
      }

      if (cmd === "save") {
        const name = parts[1] ?? process.env["PI_PROFILE"];
        if (!name) {
          ctx.ui.notify("Usage: /profile save <name>", "error");
          return;
        }

        const model = ctx.model;
        const auth = readAuth();

        const profile: Profile = {
          ...(model ? { defaultProvider: model.provider, defaultModel: model.id } : {}),
          ...(Object.keys(auth).length > 0 ? { auth } : {}),
        };

        saveProfile(name, profile);
        ctx.ui.notify(`Profile "${name}" saved.`, "info");
        return;
      }

      ctx.ui.notify(`Unknown subcommand "${cmd}". Usage: /profile [list | save [name]]`, "error");
    },
  });
}
