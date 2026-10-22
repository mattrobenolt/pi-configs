import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Models that support reduced refusals under Daybreak Blue.
const BLUE_MODELS = new Set(["gpt-5.6-sol", "gpt-6-sol", "gpt-6-luna"]);

// Astra and GPT-6.1 Sol require Daybreak Red entitlement, but the wire value
// stays daybreak_blue. Both reject daybreak_red.
const RED_ONLY_BLUE_WIRE_MODELS = new Set(["gpt-6-astra", "gpt-6.1-sol"]);

const RED_MODELS = new Set(["gpt-5.6-cyber"]);

/**
 * Injects the OpenAI Daybreak access program into Codex/Responses requests.
 *
 * Codex exposes this as `/daybreak` or `access_programs.cyber`; pi 1.3.0 does
 * not send the field. Set PI_DAYBREAK=blue or PI_DAYBREAK=red to enable.
 * Without it, this extension is a no-op.
 */
export default function (pi: ExtensionAPI) {
  const mode = process.env.PI_DAYBREAK?.trim().toLowerCase();
  if (mode !== "blue" && mode !== "red") return;

  pi.on("before_provider_request", (event) => {
    if (!event.payload || typeof event.payload !== "object") return;

    const payload = event.payload as Record<string, unknown>;
    if (typeof payload.model !== "string") return;

    const model = payload.model;

    if (mode === "blue") {
      if (!BLUE_MODELS.has(model)) return;
      return { ...payload, access_programs: { cyber: "daybreak_blue" } };
    }

    if (RED_MODELS.has(model)) {
      return { ...payload, access_programs: { cyber: "daybreak_red" } };
    }

    if (!BLUE_MODELS.has(model) && !RED_ONLY_BLUE_WIRE_MODELS.has(model)) return;
    return { ...payload, access_programs: { cyber: "daybreak_blue" } };
  });
}
