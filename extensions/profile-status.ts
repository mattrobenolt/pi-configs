import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

interface ProfileMetadata {
  profile?: string;
}

function agentDir(): string {
  return path.resolve(process.env.PI_CODING_AGENT_DIR ?? path.join(os.homedir(), ".pi", "agent"));
}

function readProfileName(): string {
  const dir = agentDir();
  const metadataPath = path.join(dir, ".pi-profile.json");

  try {
    const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8")) as ProfileMetadata;
    return metadata.profile || path.basename(dir);
  } catch {
    return "base";
  }
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    const profile = readProfileName();
    ctx.ui.setStatus("profile", ctx.ui.theme.fg("dim", profile));
  });
}
