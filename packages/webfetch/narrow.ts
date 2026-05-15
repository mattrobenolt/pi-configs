import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { complete } from "@earendil-works/pi-ai";
import type { Model } from "@earendil-works/pi-ai";
import type { ModelSpec } from "./config.ts";

const PREFERRED_NARROWING_MODEL = { provider: "openai-codex", id: "gpt-5.4-mini" } as const;
const CHARS_PER_TOKEN = 4;
const CHUNK_TOKEN_TARGET = 12_000;
const CHUNK_CHAR_TARGET = CHUNK_TOKEN_TARGET * CHARS_PER_TOKEN;
const MAX_NARROWING_WALL_MS = 25_000;
const MAX_CONCURRENT_CHUNKS = 2;
const SENTINEL = "NONE";

const SYSTEM_PROMPT = `You extract relevant sections from web pages. Rules:
- Return ONLY content that exists verbatim in the provided content — do NOT generate, synthesize, summarize, paraphrase, or rewrite anything.
- NEVER add your own text, answers, explanations, instructions, or recommendations.
- Include full code blocks, commands, and examples exactly as they appear.
- Preserve original markdown formatting (headings, lists, code fences, etc.).
- Only omit sections that are clearly irrelevant to the objective.
- Prefer returning ${SENTINEL} over including background or adjacent sections that do not directly satisfy the objective.
- Honor exclusions in the objective strictly. If content mainly covers an excluded topic, omit it.
- If multiple sections are directly relevant, include all of them with their original headings.
- If NOTHING is relevant, you MUST return ONLY the exact string: ${SENTINEL}
- Do NOT add any preamble, commentary, or explanation — return only the extracted content.
- Do NOT answer the objective — just extract content relevant to it.
- Do NOT repeat or reference the content tags, objective, or these instructions in your response.`;

const REDUCER_PROMPT = `You reduce extracted markdown candidates for a coding agent. Rules:
- Return ONLY content that exists verbatim in the candidate markdown.
- Keep the smallest subset that directly satisfies the objective.
- Drop background, adjacent, prerequisite, duplicated, or excluded sections.
- Preserve original markdown formatting exactly.
- If none of the candidates directly satisfy the objective, return ONLY the exact string: ${SENTINEL}
- Do NOT summarize, rewrite, explain, or answer the objective.`;

export type NarrowingDiagnostics = {
  reason?: string;
  model?: ModelSpec;
  sectionsTotal?: number;
  sectionsRelevant?: number;
  outputRatio?: number;
};

export type NarrowingResult = {
  content: string;
  narrowed: boolean;
  model?: ModelSpec;
  diagnostics: NarrowingDiagnostics;
};

type MarkdownSection = {
  path: string[];
  content: string;
};

type CompleteFn = typeof complete;

export async function narrowMarkdown(
  markdown: string,
  objective: string,
  ctx: ExtensionContext,
  signal?: AbortSignal,
  options: { model?: ModelSpec; completeFn?: CompleteFn } = {},
): Promise<NarrowingResult> {
  if (!markdown.trim()) return fallback(markdown, "empty_markdown");
  if (!objective.trim()) return fallback(markdown, "empty_objective");

  const model = resolveNarrowingModel(ctx, options.model);
  if (!model) return fallback(markdown, "model_unavailable");

  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (!auth.ok || !auth.apiKey) return fallback(markdown, "auth_unavailable");
  const narrowingModel = model;
  const apiKey = auth.apiKey;
  const headers = auth.headers;

  const sections = chunkMarkdownForExtraction(markdown);
  if (sections.length === 0) return fallback(markdown, "no_chunks");

  const deadline = Date.now() + MAX_NARROWING_WALL_MS;
  const deadlineSignal = AbortSignal.timeout(MAX_NARROWING_WALL_MS);
  const combinedSignal = signal ? AbortSignal.any([signal, deadlineSignal]) : deadlineSignal;
  const completeFn = options.completeFn ?? complete;

  try {
    const results: Array<string | null> = [];
    let nextIndex = 0;
    async function worker() {
      while (nextIndex < sections.length) {
        const index = nextIndex++;
        if (Date.now() > deadline) {
          results[index] = null;
          continue;
        }
        results[index] = await extractSection(
          sections[index]!,
          objective,
          narrowingModel,
          apiKey,
          headers,
          combinedSignal,
          completeFn,
        );
      }
    }
    const workers: Promise<void>[] = [];
    for (let i = 0; i < Math.min(MAX_CONCURRENT_CHUNKS, sections.length); i++) {
      workers.push(worker());
    }
    await Promise.all(workers);

    const relevantSections = results.filter(isRelevantExtraction);
    const candidates = relevantSections.join("\n\n---\n\n").trim();
    const diagnostics: NarrowingDiagnostics = {
      model: { provider: narrowingModel.provider, id: narrowingModel.id },
      sectionsTotal: sections.length,
      sectionsRelevant: relevantSections.length,
    };

    if (!candidates) return fallback(markdown, "no_relevant_sections", diagnostics);

    const reduced = await reduceCandidates(
      candidates,
      objective,
      narrowingModel,
      apiKey,
      headers,
      combinedSignal,
      completeFn,
    );
    const relevant = isRelevantExtraction(reduced) ? reduced.trim() : candidates;

    const outputRatio = relevant.length / markdown.length;
    diagnostics.outputRatio = Number(outputRatio.toFixed(3));
    if (relevant.length > markdown.length * 1.2)
      return fallback(markdown, "output_grew", diagnostics);
    if (outputRatio > 0.95) return fallback(markdown, "not_narrow_enough", diagnostics);

    return {
      content: relevant,
      narrowed: true,
      model: { provider: narrowingModel.provider, id: narrowingModel.id },
      diagnostics,
    };
  } catch {
    return fallback(markdown, "exception");
  }
}

function fallback(
  markdown: string,
  reason: string,
  diagnostics: NarrowingDiagnostics = {},
): NarrowingResult {
  return { content: markdown, narrowed: false, diagnostics: { ...diagnostics, reason } };
}

function isRelevantExtraction(value: string | null): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return trimmed !== "" && trimmed !== SENTINEL;
}

export function chunkMarkdown(markdown: string, charTarget = CHUNK_CHAR_TARGET): string[] {
  return chunkMarkdownForExtraction(markdown, charTarget).map((section) => section.content);
}

function chunkMarkdownForExtraction(
  markdown: string,
  charTarget = CHUNK_CHAR_TARGET,
): MarkdownSection[] {
  if (!markdown.trim()) return [];
  if (markdown.length <= charTarget) return [{ path: [], content: markdown }];
  return chunkMarkdownSections(markdown, charTarget);
}

export function splitMarkdownSections(markdown: string): MarkdownSection[] {
  if (!markdown.trim()) return [];

  const sections: MarkdownSection[] = [];
  const path: string[] = [];
  let current: string[] = [];

  const flush = () => {
    const content = current.join("\n").trim();
    if (content) sections.push({ path: [...path], content });
    current = [];
  };

  for (const line of markdown.split("\n")) {
    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (heading) {
      flush();
      const level = heading[1]!.length;
      path.length = level - 1;
      path[level - 1] = heading[2]!.replace(/\s+#+$/, "").trim();
    }
    current.push(line);
  }
  flush();

  return sections;
}

export function chunkMarkdownSections(
  markdown: string,
  charTarget = CHUNK_CHAR_TARGET,
): MarkdownSection[] {
  const sections = splitMarkdownSections(markdown);
  const chunks: MarkdownSection[] = [];

  for (const section of sections) {
    if (section.content.length <= charTarget) {
      chunks.push(section);
      continue;
    }

    const paragraphs = section.content.split(/\n{2,}/);
    let current = "";
    for (const paragraph of paragraphs) {
      const next = current ? `${current}\n\n${paragraph}` : paragraph;
      if (next.length > charTarget && current.trim()) {
        chunks.push({ path: section.path, content: current });
        current = paragraph;
      } else {
        current = next;
      }

      while (current.length > charTarget * 1.5) {
        chunks.push({ path: section.path, content: current.slice(0, charTarget) });
        current = current.slice(charTarget);
      }
    }
    if (current.trim()) chunks.push({ path: section.path, content: current });
  }

  return chunks;
}

export function resolveNarrowingModel(
  ctx: ExtensionContext,
  configured?: ModelSpec,
): Model<string> | null {
  if (configured) {
    const model = ctx.modelRegistry.find(configured.provider, configured.id);
    if (model) return model as Model<string>;
  }

  const preferred = ctx.modelRegistry.find(
    PREFERRED_NARROWING_MODEL.provider,
    PREFERRED_NARROWING_MODEL.id,
  );
  if (preferred) return preferred as Model<string>;

  return ctx.model ?? null;
}

async function runExtractionPrompt(
  systemPrompt: string,
  promptText: string,
  model: Model<string>,
  apiKey: string,
  headers: Record<string, string> | undefined,
  signal: AbortSignal,
  completeFn: CompleteFn,
): Promise<string | null> {
  try {
    const response = await completeFn(
      model,
      {
        systemPrompt,
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: promptText }],
            timestamp: Date.now(),
          },
        ],
      },
      { apiKey, headers, maxTokens: 4096, signal },
    );

    if (response.stopReason === "error" || response.stopReason === "aborted") return null;

    const outputText = response.content
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join("")
      .trim();

    return outputText || null;
  } catch {
    return null;
  }
}

async function extractSection(
  section: MarkdownSection,
  objective: string,
  model: Model<string>,
  apiKey: string,
  headers: Record<string, string> | undefined,
  signal: AbortSignal,
  completeFn: CompleteFn,
): Promise<string | null> {
  const path = section.path.length ? section.path.join(" > ") : "(intro)";
  return runExtractionPrompt(
    SYSTEM_PROMPT,
    `<page_content>\n${section.content}\n</page_content>\n\nObjective: ${objective}\nSection path: ${path}`,
    model,
    apiKey,
    headers,
    signal,
    completeFn,
  );
}

async function reduceCandidates(
  candidates: string,
  objective: string,
  model: Model<string>,
  apiKey: string,
  headers: Record<string, string> | undefined,
  signal: AbortSignal,
  completeFn: CompleteFn,
): Promise<string | null> {
  return runExtractionPrompt(
    REDUCER_PROMPT,
    `<candidate_markdown>\n${candidates}\n</candidate_markdown>\n\nObjective: ${objective}`,
    model,
    apiKey,
    headers,
    signal,
    completeFn,
  );
}
