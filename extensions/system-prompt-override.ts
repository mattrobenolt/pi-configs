/**
 * system-prompt-override — replace pi's default system prompt template.
 *
 * Rebuilds the prompt from scratch each turn in before_agent_start, using the
 * same structured inputs pi's own builder gets (event.systemPromptOptions).
 *
 * Structure convention (model-agnostic): markdown ## headings for instruction
 * sections, XML-style tags only for injected data blocks. Static content
 * first, volatile content (Environment) last to protect cache prefixes.
 *
 * What changes vs pi's template:
 *   - static identity block is ours (BASE_PROMPT), not "You are an expert
 *     coding assistant..."
 *   - persona comes from system-prompt-persona.md next to this file (the old
 *     global APPEND_SYSTEM.md mechanism is retired; pi's appendSystemPrompt
 *     input is still honored for per-project .pi/APPEND_SYSTEM.md files)
 *   - the pi-docs block appears only when cwd is under ~/.pi
 *   - section headers are ## markdown; cwd moves into ## Environment
 *   - context files under ~/.pi are scoped to sessions under ~/.pi (pi's
 *     agentDir global AGENTS.md otherwise leaks into every project), and
 *     context files are deduped by realpath
 *
 * What stays byte-compatible with pi: the tools list entries, the deduped
 * guidelines (tool-provided plus our static ones), the <project_context>
 * wrapper, and the <available_skills> block (still gated on the read tool).
 *
 * Notes:
 *   - If a customPrompt is set (SYSTEM.md / --system-prompt) we defer to pi's
 *     own builder entirely.
 *   - Projects with a .pi/SOUL.md own their prompt (greg-soul et al.); we
 *     defer there too. Project extensions load after global ones, so a
 *     project handler would win the chain regardless — deferring just makes
 *     the arrangement explicit and skips a build that would be discarded.
 *   - The idle-time base prompt is still pi's default (there is no API to
 *     replace the cached base). `/system-prompt` renders this builder directly,
 *     `/system-prompt base` shows pi's stock template.
 *   - Load order matters: this file must sort before system-prompt.ts so the
 *     inspector snapshots our output, not pi's base ("-" < "." byte-wise).
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import os from "node:os";
import { join, sep } from "node:path";
import type { BuildSystemPromptOptions, ExtensionAPI } from "@earendil-works/pi-coding-agent";

// =============================================================================
// Static template — this is the part to shape. Edit and /reload.
// =============================================================================

const BASE_PROMPT = `You are a coding agent operating inside pi. You help the user by reading files, executing commands, editing code, and writing new files.`;

const STATIC_GUIDELINES = [
  "Be concise in your responses",
  "Show file paths clearly when working with files",
];

// =============================================================================
// Persona — the retired ~/.pi/agent/APPEND_SYSTEM.md, now owned by this
// extension. Read per turn so edits apply without /reload.
// =============================================================================

const PERSONA_PATH = join(os.homedir(), ".pi/agent/extensions/system-prompt-persona.md");

function loadPersona(): string {
  try {
    return readFileSync(PERSONA_PATH, "utf8").trim();
  } catch {
    return "";
  }
}

// =============================================================================
// Pi docs block — only when working under ~/.pi (where pi work happens)
// =============================================================================

const PI_HOME_ROOTS = (() => {
  const piHome = join(os.homedir(), ".pi");
  const roots = [piHome];
  try {
    roots.push(realpathSync(piHome));
  } catch {
    // Keep the unresolved form only.
  }
  return roots;
})();

function cwdInPiHome(cwd: string): boolean {
  const candidates = [cwd];
  try {
    candidates.push(realpathSync(cwd));
  } catch {
    // Use cwd as-is.
  }
  return candidates.some((dir) =>
    PI_HOME_ROOTS.some((root) => dir === root || dir.startsWith(`${root}${sep}`)),
  );
}

let cachedDocsBlock: string | undefined | null = null;

function piDocsBlock(): string | undefined {
  if (cachedDocsBlock !== null) return cachedDocsBlock;
  try {
    // The package's exports map blocks require.resolve, so resolve the real
    // install dir through the node_modules symlink instead.
    const pkgDir = realpathSync(
      join(os.homedir(), ".pi/agent/node_modules/@earendil-works/pi-coding-agent"),
    );
    cachedDocsBlock = `## Pi documentation

Read this documentation only when the user asks about pi itself, its SDK, extensions, themes, skills, or TUI.
- Main documentation: ${join(pkgDir, "README.md")}
- Additional docs: ${join(pkgDir, "docs")}
- Examples: ${join(pkgDir, "examples")} (extensions, custom tools, SDK)
- When reading pi docs or examples, resolve docs/... under Additional docs and examples/... under Examples, not the current working directory
- When asked about: extensions (docs/extensions.md, examples/extensions/), themes (docs/themes.md), skills (docs/skills.md), prompt templates (docs/prompt-templates.md), TUI components (docs/tui.md), keybindings (docs/keybindings.md), SDK integrations (docs/sdk.md), custom providers (docs/custom-provider.md), adding models (docs/models.md), pi packages (docs/packages.md), environment variables (docs/environment-variables.md)
- When working on pi topics, read the docs and examples, and follow .md cross-references before implementing
- Always read pi .md files completely and follow links to related docs (e.g., tui.md for TUI API details)`;
  } catch {
    cachedDocsBlock = undefined;
  }
  return cachedDocsBlock;
}

// =============================================================================
// Project-local prompt ownership (greg-soul uses .pi/SOUL.md as its trigger)
// =============================================================================

export function localSoulOwner(cwd: string): string | undefined {
  for (const name of ["SOUL.md", "SOUL-BUZZ.md"]) {
    if (existsSync(join(cwd, ".pi", name))) return `.pi/${name}`;
  }
  return undefined;
}

// =============================================================================
// Host info (computed once, cached)
// =============================================================================

function detectOsPrettyName(): string | undefined {
  try {
    if (os.platform() === "darwin") {
      const version = execFileSync("sw_vers", ["-productVersion"], { encoding: "utf8" }).trim();
      return `macOS ${version}`;
    }
    if (os.platform() === "linux") {
      const release = readFileSync("/etc/os-release", "utf8");
      const match = release.match(/^PRETTY_NAME="?([^"\n]+)"?/m);
      if (match) return match[1];
    }
  } catch {
    // Fall through to the uname-style line.
  }
  return undefined;
}

const HOST_LINE = (() => {
  const pretty = detectOsPrettyName();
  const uname = `${os.type()} ${os.release()} ${os.arch()}`;
  const platform = pretty ? `${pretty} (${uname})` : uname;
  return `Platform: ${platform}, host ${os.hostname()}`;
})();

// Day-resolution date only; a high-resolution timestamp would bust the cache
// prefix every turn for no benefit. temporal-context injects relative times
// per turn as messages, and `date` is one bash call away.
function dateLine(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const weekday = now.toLocaleDateString("en-US", { weekday: "long" });
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return `Date: ${y}-${m}-${d} (${weekday})${tz ? `, ${tz}` : ""}`;
}

export type PromptModel = { id: string; name?: string; provider: string };

function modelLine(model: PromptModel | undefined): string | undefined {
  if (!model) return undefined;
  const ref = `${model.provider}/${model.id}`;
  const name = model.name?.trim();
  return `Model: ${name && name !== model.id ? `${name} (${ref})` : ref}`;
}

function environmentSection(cwd: string, model?: PromptModel): string {
  const lines = [HOST_LINE];
  if (process.env.SHELL) {
    lines.push(`Shell: ${process.env.SHELL}`);
  }
  const modelEntry = modelLine(model);
  if (modelEntry) lines.push(modelEntry);
  lines.push(dateLine());
  lines.push("Run `date` for the current time.");
  lines.push(`Working directory: ${cwd.replace(/\\/g, "/")}`);
  return `## Environment\n\n${lines.map((l) => `- ${l}`).join("\n")}`;
}

// =============================================================================
// Sections copied from pi's builder (dist/core/system-prompt.js, skills.js)
// =============================================================================

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function formatSkills(skills: NonNullable<BuildSystemPromptOptions["skills"]>): string {
  const visible = skills.filter((s) => !s.disableModelInvocation);
  if (visible.length === 0) return "";
  const lines = [
    "\n\nThe following skills provide specialized instructions for specific tasks.",
    "Use the read tool to load a skill's file when the task matches its description.",
    "When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.",
    "",
    "<available_skills>",
  ];
  for (const skill of visible) {
    lines.push("  <skill>");
    lines.push(`    <name>${escapeXml(skill.name)}</name>`);
    lines.push(`    <description>${escapeXml(skill.description)}</description>`);
    lines.push(`    <location>${escapeXml(skill.filePath)}</location>`);
    lines.push("  </skill>");
  }
  lines.push("</available_skills>");
  return lines.join("\n");
}

// Pi treats agentDir/AGENTS.md as global context for every session. Here it
// is repo documentation, so it belongs only under ~/.pi. Also dedup by
// realpath: agent/ and agent-work/ are symlink twins and pi dedups by raw
// path, which injects the same file twice.
function filterContextFiles(
  files: NonNullable<BuildSystemPromptOptions["contextFiles"]>,
  cwd: string,
): NonNullable<BuildSystemPromptOptions["contextFiles"]> {
  const inPiHome = cwdInPiHome(cwd);
  const seen = new Set<string>();
  const out: typeof files = [];
  for (const file of files) {
    let real: string | undefined;
    try {
      real = realpathSync(file.path);
    } catch {
      // Use the raw path.
    }
    const key = real ?? file.path;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!inPiHome) {
      const underPiHome = PI_HOME_ROOTS.some(
        (root) =>
          file.path === root ||
          file.path.startsWith(`${root}${sep}`) ||
          real === root ||
          (real?.startsWith(`${root}${sep}`) ?? false),
      );
      if (underPiHome) continue;
    }
    out.push(file);
  }
  return out;
}

function formatContextFiles(files: NonNullable<BuildSystemPromptOptions["contextFiles"]>): string {
  if (files.length === 0) return "";
  let out = "\n\n<project_context>\n\nProject-specific instructions and guidelines:\n\n";
  for (const { path, content } of files) {
    out += `<project_instructions path="${path}">\n${content}\n</project_instructions>\n\n`;
  }
  return out + "</project_context>\n";
}

// =============================================================================
// The builder
// =============================================================================

export function buildPrompt(
  options: BuildSystemPromptOptions,
  extra?: { model?: PromptModel },
): string {
  const tools = options.selectedTools ?? ["read", "bash", "edit", "write"];
  const toolSnippets = options.toolSnippets ?? {};
  const visibleTools = tools.filter((name) => !!toolSnippets[name]);
  const toolsList =
    visibleTools.length > 0
      ? visibleTools.map((name) => `- ${name}: ${toolSnippets[name]}`).join("\n")
      : "(none)";

  // Guidelines: ours first, then tool-provided, deduped. Mirrors pi's
  // bash-only fallback for minimal tool sets.
  const guidelines: string[] = [];
  const seen = new Set<string>();
  const add = (g: string) => {
    const trimmed = g.trim();
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      guidelines.push(trimmed);
    }
  };
  if (
    tools.includes("bash") &&
    !tools.includes("grep") &&
    !tools.includes("find") &&
    !tools.includes("ls")
  ) {
    add("Use bash for file operations like ls, rg, find");
  }
  for (const g of STATIC_GUIDELINES) add(g);
  for (const g of options.promptGuidelines ?? []) add(g);
  const guidelinesList = guidelines.map((g) => `- ${g}`).join("\n");

  const sections = [
    BASE_PROMPT,
    `## Available tools\n\n${toolsList}`,
    `## Guidelines\n\n${guidelinesList}`,
  ];

  const persona = loadPersona();
  if (persona) sections.push(persona);

  // Still honor pi's appendSystemPrompt input for per-project
  // .pi/APPEND_SYSTEM.md files; the global one is retired into the persona.
  if (options.appendSystemPrompt) sections.push(options.appendSystemPrompt);

  if (cwdInPiHome(options.cwd)) {
    const docs = piDocsBlock();
    if (docs) sections.push(docs);
  }

  let prompt = sections.join("\n\n");
  prompt += formatContextFiles(filterContextFiles(options.contextFiles ?? [], options.cwd));
  if (tools.includes("read")) {
    prompt += formatSkills(options.skills ?? []);
  }
  prompt += `\n\n${environmentSection(options.cwd, extra?.model)}`;
  return prompt;
}

export default function (pi: ExtensionAPI) {
  pi.on("before_agent_start", (event, ctx) => {
    // A custom prompt (SYSTEM.md / --system-prompt) is an explicit full
    // replacement; leave pi's own handling of it alone.
    if (event.systemPromptOptions.customPrompt) return;
    if (localSoulOwner(event.systemPromptOptions.cwd)) return;
    return { systemPrompt: buildPrompt(event.systemPromptOptions, { model: ctx.model }) };
  });
}
