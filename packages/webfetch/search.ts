export type SearchType = "auto" | "fast" | "instant" | "deep-lite" | "deep" | "deep-reasoning";

export type SearchCategory =
  | "company"
  | "people"
  | "research paper"
  | "news"
  | "personal site"
  | "financial report";

export type SearchParams = {
  query: string;
  numResults?: number;
  type?: SearchType;
  category?: SearchCategory;
  includeDomains?: string[];
  excludeDomains?: string[];
  startPublishedDate?: string;
  endPublishedDate?: string;
  content?: "highlights" | "text" | "none";
  maxCharacters?: number;
  maxAgeHours?: number;
  moderation?: boolean;
};

export type SearchResult = {
  title?: string | null;
  url?: string;
  publishedDate?: string | null;
  author?: string | null;
  highlights?: string[];
  text?: string;
  summary?: string;
  description?: string;
};

export type BackendSearchResponse = {
  backend: "exa" | "jina";
  requestId?: string;
  resolvedSearchType?: string;
  searchTime?: number;
  results: SearchResult[];
  answer?: unknown;
  citations?: Array<{ url: string; title?: string }>;
  costDollars?: Record<string, unknown>;
  usage?: Record<string, unknown>;
};

export type SearchAttempt = {
  backend: "exa" | "jina";
  latencyMs: number;
  outcome: "success" | "empty" | "failed" | "skipped";
  reason?: string;
};

export type RoutedSearchResponse = {
  response: BackendSearchResponse;
  attempts: SearchAttempt[];
};

export type SearchCredentials = {
  exa?: string;
  jina?: string;
};

export class SearchBackendError extends Error {
  readonly backend: "exa" | "jina";
  readonly kind: "request" | "auth" | "quota" | "transient" | "cancelled" | "fatal";
  readonly status?: number;

  constructor(
    backend: "exa" | "jina",
    kind: "request" | "auth" | "quota" | "transient" | "cancelled" | "fatal",
    message: string,
    status?: number,
  ) {
    super(message);
    this.name = "SearchBackendError";
    this.backend = backend;
    this.kind = kind;
    this.status = status;
  }

  get canFailOver(): boolean {
    return this.kind === "auth" || this.kind === "quota" || this.kind === "transient";
  }
}

const EXA_API_URL = "https://api.exa.ai/search";
const JINA_API_URL = "https://s.jina.ai/";
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const backendCooldownUntil = new Map<"exa" | "jina", number>();
const BACKEND_COOLDOWN_MS: Record<SearchBackendError["kind"], number> = {
  auth: 5 * 60_000,
  quota: 60_000,
  transient: 15_000,
  request: 0,
  cancelled: 0,
  fatal: 0,
};

export function buildExaSearchRequest(params: SearchParams): Record<string, unknown> {
  if (
    (params.category === "company" || params.category === "people") &&
    (params.excludeDomains || params.startPublishedDate || params.endPublishedDate)
  ) {
    throw new SearchBackendError(
      "exa",
      "request",
      `Exa's ${params.category} category does not support excludeDomains or publication-date filters`,
    );
  }

  const content = params.content ?? "highlights";
  const contentOptions = params.maxCharacters ? { maxCharacters: params.maxCharacters } : true;
  const contents =
    content === "none"
      ? undefined
      : {
          [content]: contentOptions,
          ...(params.maxAgeHours !== undefined ? { maxAgeHours: params.maxAgeHours } : {}),
        };

  return {
    query: params.query,
    type: params.type ?? "auto",
    numResults: params.numResults ?? 8,
    ...(params.category ? { category: params.category } : {}),
    ...(params.includeDomains?.length ? { includeDomains: params.includeDomains } : {}),
    ...(params.excludeDomains?.length ? { excludeDomains: params.excludeDomains } : {}),
    ...(params.startPublishedDate ? { startPublishedDate: params.startPublishedDate } : {}),
    ...(params.endPublishedDate ? { endPublishedDate: params.endPublishedDate } : {}),
    ...(params.moderation !== undefined ? { moderation: params.moderation } : {}),
    ...(contents ? { contents } : {}),
  };
}

export function jinaUnsupportedReason(params: SearchParams): string | undefined {
  if (params.type?.startsWith("deep")) return `search type ${params.type}`;
  if (params.category) return `category ${params.category}`;
  if ((params.includeDomains?.length ?? 0) > 1) return "multiple includeDomains";
  if (params.excludeDomains?.length) return "excludeDomains";
  if (params.startPublishedDate || params.endPublishedDate) return "publication-date filters";
  if (params.maxAgeHours !== undefined && params.maxAgeHours !== 0)
    return "maxAgeHours other than 0";
  if (params.moderation !== undefined) return "moderation";
  return undefined;
}

export async function searchExa(
  params: SearchParams,
  apiKey: string,
  signal?: AbortSignal,
): Promise<BackendSearchResponse> {
  const timeoutMs = params.type?.startsWith("deep") ? 120_000 : 60_000;
  const raw = await fetchBackendJson(
    "exa",
    EXA_API_URL,
    {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-api-key": apiKey,
        "x-exa-integration": "pi-websearch",
      },
      body: JSON.stringify(buildExaSearchRequest(params)),
    },
    signal,
    timeoutMs,
  );
  if (!isRecord(raw)) throw new SearchBackendError("exa", "fatal", "Exa returned no data");

  const output = isRecord(raw.output) ? raw.output : undefined;
  const grounding = Array.isArray(output?.grounding) ? output.grounding : [];
  const citations = grounding.flatMap((entry) => {
    if (!isRecord(entry) || !Array.isArray(entry.citations)) return [];
    return entry.citations.flatMap((citation) => {
      if (!isRecord(citation) || typeof citation.url !== "string") return [];
      return [{ url: citation.url, title: asString(citation.title) }];
    });
  });

  return {
    backend: "exa",
    requestId: asString(raw.requestId),
    resolvedSearchType: asString(raw.resolvedSearchType),
    searchTime: asNumber(raw.searchTime),
    results: parseResults(raw.results),
    answer: output?.content,
    citations,
    costDollars: isRecord(raw.costDollars) ? raw.costDollars : undefined,
  };
}

export async function searchJina(
  params: SearchParams,
  apiKey: string,
  signal?: AbortSignal,
): Promise<BackendSearchResponse> {
  const unsupported = jinaUnsupportedReason(params);
  if (unsupported) {
    throw new SearchBackendError("jina", "request", `Jina does not support ${unsupported}`);
  }

  const returnContent = params.content === "text";
  const headers: Record<string, string> = {
    accept: "application/json",
    authorization: `Bearer ${apiKey}`,
    "content-type": "application/json",
    ...(returnContent ? {} : { "x-respond-with": "no-content" }),
    ...(params.maxAgeHours === 0 ? { "x-no-cache": "true" } : {}),
    ...(params.includeDomains?.[0] ? { "x-site": normalizeSite(params.includeDomains[0]) } : {}),
    ...(params.type === "fast" || params.type === "instant" ? { "x-engine": "direct" } : {}),
  };

  const raw = await fetchBackendJson(
    "jina",
    JINA_API_URL,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        q: params.query,
        num: params.numResults ?? 8,
      }),
    },
    signal,
    30_000,
  );
  if (!isRecord(raw)) throw new SearchBackendError("jina", "fatal", "Jina returned no data");

  const results = parseResults(raw.data).map((result) => {
    const text = truncate(result.text, params.maxCharacters);
    return {
      ...result,
      ...(returnContent && text ? { text } : {}),
    };
  });

  return {
    backend: "jina",
    results,
    usage: isRecord(raw.meta) && isRecord(raw.meta.usage) ? raw.meta.usage : undefined,
  };
}

export async function searchWithFailover(
  params: SearchParams,
  credentials: SearchCredentials,
  signal?: AbortSignal,
  order: Array<"exa" | "jina"> = ["exa", "jina"],
): Promise<RoutedSearchResponse> {
  const attempts: SearchAttempt[] = [];
  let lastError: SearchBackendError | undefined;
  let emptyResponse: BackendSearchResponse | undefined;

  for (const backend of order) {
    const cooldownUntil = backendCooldownUntil.get(backend) ?? 0;
    if (cooldownUntil > Date.now()) {
      attempts.push({
        backend,
        latencyMs: 0,
        outcome: "skipped",
        reason: `cooldown for ${Math.ceil((cooldownUntil - Date.now()) / 1000)}s`,
      });
      continue;
    }

    const key = credentials[backend]?.trim();
    if (!key) {
      attempts.push({ backend, latencyMs: 0, outcome: "skipped", reason: "not configured" });
      continue;
    }
    const unsupported = backend === "jina" ? jinaUnsupportedReason(params) : undefined;
    if (unsupported) {
      attempts.push({ backend, latencyMs: 0, outcome: "skipped", reason: unsupported });
      continue;
    }

    const started = Date.now();
    try {
      const response =
        backend === "exa"
          ? await searchExa(params, key, signal)
          : await searchJina(params, key, signal);
      backendCooldownUntil.delete(backend);
      if (response.results.length === 0 && response.answer === undefined) {
        emptyResponse = response;
        attempts.push({
          backend,
          latencyMs: Date.now() - started,
          outcome: "empty",
          reason: "no results",
        });
        continue;
      }
      attempts.push({ backend, latencyMs: Date.now() - started, outcome: "success" });
      return { response, attempts };
    } catch (error) {
      const failure = normalizeBackendError(backend, error);
      attempts.push({
        backend,
        latencyMs: Date.now() - started,
        outcome: "failed",
        reason: failure.message,
      });
      lastError = failure;
      if (!failure.canFailOver) throw failure;
      backendCooldownUntil.set(backend, Date.now() + BACKEND_COOLDOWN_MS[failure.kind]);
    }
  }

  if (emptyResponse) return { response: emptyResponse, attempts };
  if (lastError) throw lastError;
  const reasons = attempts.map((attempt) => `${attempt.backend}: ${attempt.reason}`).join("; ");
  throw new Error(
    `No configured websearch backend supports this request${reasons ? ` (${reasons})` : ""}`,
  );
}

export function formatSearchResponse(response: BackendSearchResponse): string {
  const sections: string[] = [];
  if (response.answer !== undefined) {
    sections.push(
      `Answer:\n${typeof response.answer === "string" ? response.answer : JSON.stringify(response.answer, null, 2)}`,
    );
  }

  for (const result of response.results) {
    const lines = [
      `Title: ${result.title || "N/A"}`,
      `URL: ${result.url || "N/A"}`,
      `Published: ${result.publishedDate || "N/A"}`,
      `Author: ${result.author || "N/A"}`,
    ];
    if (result.highlights?.length) lines.push(`Highlights:\n${result.highlights.join("\n")}`);
    if (result.description) lines.push(`Snippet: ${result.description}`);
    if (result.summary) lines.push(`Summary: ${result.summary}`);
    if (result.text) lines.push(`Text: ${result.text}`);
    sections.push(lines.join("\n"));
  }

  const citations = response.citations
    ?.filter((citation) => citation.url)
    .map((citation) => `- ${citation.title || citation.url}: ${citation.url}`);
  if (citations?.length) sections.push(`Sources:\n${[...new Set(citations)].join("\n")}`);

  return sections.join("\n\n---\n\n") || "No search results found. Please try a different query.";
}

async function fetchBackendJson(
  backend: "exa" | "jina",
  url: string,
  init: RequestInit,
  parentSignal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<unknown> {
  const { signal, cleanup, didTimeout } = mergeAbortSignals(parentSignal, timeoutMs);
  try {
    for (let attempt = 0; attempt <= 2; attempt += 1) {
      let response: Response;
      try {
        response = await fetch(url, { ...init, signal });
      } catch (error) {
        if (parentSignal?.aborted)
          throw new SearchBackendError(backend, "cancelled", "Search was cancelled");
        if (didTimeout())
          throw new SearchBackendError(backend, "transient", "Search request timed out");
        if (attempt === 2) throw new SearchBackendError(backend, "transient", errorText(error));
        await waitForRetry(500 * 2 ** attempt, signal);
        continue;
      }

      if (RETRYABLE_STATUS.has(response.status) && attempt < 2) {
        const delayMs = retryDelayMs(response, attempt);
        await response.body?.cancel();
        await waitForRetry(delayMs, signal);
        continue;
      }

      const text = await response.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        if (!response.ok)
          throw statusError(backend, response.status, response.statusText || text.slice(0, 300));
        throw new SearchBackendError(backend, "fatal", `${backend} returned malformed JSON`);
      }
      if (!response.ok) {
        const body = isRecord(parsed) ? parsed : {};
        const message =
          asString(body.error) ?? asString(body.message) ?? response.statusText ?? "request failed";
        if (backend === "jina" && response.status === 422 && /no search results/i.test(message)) {
          return { data: [] };
        }
        const tag = asString(body.tag);
        const requestId = asString(body.requestId);
        throw statusError(
          backend,
          response.status,
          `${tag ? `[${tag}] ` : ""}${message}${requestId ? ` (request ${requestId})` : ""}`,
        );
      }
      return parsed;
    }
    throw new SearchBackendError(backend, "transient", "Search failed after retries");
  } catch (error) {
    if (error instanceof SearchBackendError) throw error;
    if (parentSignal?.aborted) {
      throw new SearchBackendError(backend, "cancelled", "Search was cancelled");
    }
    if (didTimeout()) {
      throw new SearchBackendError(backend, "transient", "Search request timed out");
    }
    throw new SearchBackendError(backend, "transient", errorText(error));
  } finally {
    cleanup();
  }
}

function statusError(backend: "exa" | "jina", status: number, message: string) {
  const kind =
    status === 402 ||
    status === 429 ||
    (backend === "jina" && status === 403 && /balance|resource limit/i.test(message))
      ? "quota"
      : status === 401 || status === 403
        ? "auth"
        : status === 400 || status === 422
          ? "request"
          : status >= 500
            ? "transient"
            : "fatal";
  return new SearchBackendError(
    backend,
    kind,
    `${backend} search error (${status}): ${message}`,
    status,
  );
}

function normalizeBackendError(backend: "exa" | "jina", error: unknown): SearchBackendError {
  return error instanceof SearchBackendError
    ? error
    : new SearchBackendError(backend, "fatal", errorText(error));
}

function parseResults(value: unknown): SearchResult[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const highlights = Array.isArray(item.highlights)
      ? item.highlights.filter((entry): entry is string => typeof entry === "string")
      : undefined;
    return [
      {
        title: asString(item.title),
        url: asString(item.url),
        publishedDate: asString(item.publishedDate),
        author: asString(item.author),
        highlights,
        text: asString(item.content) ?? asString(item.text),
        summary: asString(item.summary),
        description: asString(item.description),
      },
    ];
  });
}

function mergeAbortSignals(parentSignal: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error("Timed out"));
  }, timeoutMs);
  const onAbort = () => controller.abort(parentSignal?.reason ?? new Error("Aborted"));
  if (parentSignal) {
    if (parentSignal.aborted) onAbort();
    else parentSignal.addEventListener("abort", onAbort, { once: true });
  }
  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    cleanup: () => {
      clearTimeout(timeout);
      if (parentSignal) parentSignal.removeEventListener("abort", onAbort);
    },
  };
}

function retryDelayMs(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  }
  return 500 * 2 ** attempt;
}

function waitForRetry(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const onAbort = () => {
      if (timeout) clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      reject(new Error("Search request timed out or was cancelled"));
    };
    if (signal.aborted) return onAbort();
    timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function normalizeSite(domain: string): string {
  return /^https?:\/\//i.test(domain) ? domain : `https://${domain}`;
}

function truncate(
  value: string | undefined,
  maxCharacters: number | undefined,
): string | undefined {
  if (!value || !maxCharacters || value.length <= maxCharacters) return value;
  return value.slice(0, maxCharacters);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
