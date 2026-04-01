import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { truncateHead, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES } from "@mariozechner/pi-coding-agent";
import { Type, type Static } from "@sinclair/typebox";
import { execSync } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";
import os from "node:os";

const MAX_BLOCK_DEPTH = 5;
const MAX_DB_RESULTS = 100;
const MAX_PAGE_CHUNKS = 10;

// --- Token extraction from Notion.app ---

let cachedToken: string | undefined;

function extractToken(): string {
  if (cachedToken) return cachedToken;

  if (process.env.NOTION_TOKEN) {
    cachedToken = process.env.NOTION_TOKEN;
    return cachedToken;
  }

  if (process.platform !== "darwin") {
    throw new Error("Automatic token extraction only works on macOS. Set NOTION_TOKEN manually.");
  }

  try {
    const keyB64 = execSync('security find-generic-password -s "Notion Safe Storage" -w', {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();

    const key = crypto.pbkdf2Sync(keyB64, "saltysalt", 1003, 16, "sha1");

    const dbPath = path.join(os.homedir(), "Library/Application Support/Notion/Partitions/notion/Cookies");
    const hex = execSync(
      `sqlite3 "${dbPath}" "SELECT hex(encrypted_value) FROM cookies WHERE name='token_v2' AND host_key='.www.notion.so';"`,
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
    ).trim();

    if (!hex) throw new Error("token_v2 cookie not found in Notion's cookie store");

    const encrypted = Buffer.from(hex, "hex");
    const data = encrypted.subarray(3); // strip v10 prefix

    const iv = Buffer.alloc(16, 0x20);
    const decipher = crypto.createDecipheriv("aes-128-cbc", key, iv);
    decipher.setAutoPadding(false);
    let decrypted = decipher.update(data);
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    const str = decrypted.toString("utf-8");
    const tokenStart = str.indexOf("v0");
    if (tokenStart < 0) throw new Error("Could not find token in decrypted cookie data");

    const raw = str.substring(tokenStart).replace(/[\x00-\x1f]/g, "");
    cachedToken = decodeURIComponent(raw);
    return cachedToken;
  } catch (e: any) {
    throw new Error(
      `Failed to extract token from Notion.app: ${e.message}. ` +
        "Make sure Notion.app is installed and you're logged in, or set NOTION_TOKEN manually.",
    );
  }
}

// --- Internal API client ---

async function notionPost(endpoint: string, body: unknown, signal?: AbortSignal): Promise<any> {
  const token = extractToken();
  const resp = await fetch(`https://www.notion.so/api/v3/${endpoint}`, {
    method: "POST",
    headers: {
      Cookie: `token_v2=${encodeURIComponent(token)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!resp.ok) throw new Error(`Notion API ${resp.status}: ${await resp.text()}`);
  return resp.json();
}

// --- URL parsing ---

function parseNotionId(input: string): string {
  let s = input.trim();
  try {
    const url = new URL(s);
    const p = url.searchParams.get("p");
    s = p ?? url.pathname;
  } catch {
    // Not a URL
  }

  const hex = s.match(/([a-f0-9]{32})/i);
  if (hex) {
    const h = hex[1];
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  const uuid = s.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
  if (uuid) return uuid[1];

  throw new Error(`Could not extract a Notion ID from: ${input}`);
}

// --- Name resolution ---

// Caches resolved user and page names across calls within a session.
const nameCache = new Map<string, string>();

async function resolveNames(
  ids: { users: Set<string>; pages: Set<string> },
  signal?: AbortSignal,
): Promise<void> {
  const requests: Array<{ pointer: { table: string; id: string } }> = [];

  for (const id of ids.users) {
    if (!nameCache.has(`user:${id}`)) {
      requests.push({ pointer: { table: "notion_user", id } });
    }
  }
  for (const id of ids.pages) {
    if (!nameCache.has(`page:${id}`)) {
      requests.push({ pointer: { table: "block", id } });
    }
  }

  if (!requests.length) return;

  const resp = await notionPost(
    "syncRecordValues",
    { requests: requests.map((r) => ({ ...r, version: -1 })) },
    signal,
  );
  const rm = resp.recordMap ?? {};

  for (const id of ids.users) {
    const val = rm.notion_user?.[id]?.value?.value ?? rm.notion_user?.[id]?.value;
    if (val?.name) nameCache.set(`user:${id}`, val.name);
  }
  for (const id of ids.pages) {
    const val = rm.block?.[id]?.value?.value ?? rm.block?.[id]?.value;
    const title = internalPlainText(val?.properties?.title);
    if (title) nameCache.set(`page:${id}`, title);
  }
}

// Scan rich text for user/page mention IDs that need resolving.
function collectMentionIds(chunks: any[] | undefined, out: { users: Set<string>; pages: Set<string> }): void {
  if (!chunks?.length) return;
  for (const chunk of chunks) {
    if (!Array.isArray(chunk) || !chunk[1]) continue;
    for (const ann of chunk[1]) {
      if (!Array.isArray(ann)) continue;
      const [type, value] = ann;
      if (type === "u" && value) out.users.add(value);
      if (type === "p" && value) out.pages.add(value);
    }
  }
}

// Scan all properties in a block for mentions.
function collectBlockMentions(block: any, out: { users: Set<string>; pages: Set<string> }): void {
  if (!block?.properties) return;
  for (const val of Object.values(block.properties)) {
    collectMentionIds(val as any, out);
  }
}

// --- Rich text → Markdown ---

function internalRichTextToMd(chunks: any[] | undefined): string {
  if (!chunks?.length) return "";
  return chunks
    .map((chunk: any) => {
      if (typeof chunk === "string") return chunk;
      if (!Array.isArray(chunk)) return "";
      const [text, annotations] = chunk;
      if (text === undefined || text === null) return "";
      if (!annotations?.length) return text;

      let result = String(text);
      for (const ann of annotations) {
        if (!Array.isArray(ann)) continue;
        const [type, value] = ann;
        switch (type) {
          case "b":
            result = `**${result}**`;
            break;
          case "i":
            result = `*${result}*`;
            break;
          case "s":
            result = `~~${result}~~`;
            break;
          case "c":
            result = `\`${result}\``;
            break;
          case "a":
            result = `[${result}](${value})`;
            break;
          case "u": {
            const name = nameCache.get(`user:${value}`) ?? value;
            result = `@${name}`;
            break;
          }
          case "p": {
            const name = nameCache.get(`page:${value}`) ?? "page";
            result = `[${name}](https://www.notion.so/${(value ?? "").replace(/-/g, "")})`;
            break;
          }
          case "d": {
            // Inline date — value is { type, start_date, ... }
            if (value?.start_date) {
              result = value.end_date ? `${value.start_date} → ${value.end_date}` : value.start_date;
            }
            break;
          }
          case "e":
            result = `$${value ?? result}$`;
            break;
          case "h":
            // Highlight/color — skip, not meaningful in markdown
            break;
        }
      }
      return result;
    })
    .join("");
}

function internalPlainText(chunks: any[] | undefined): string {
  if (!chunks?.length) return "";
  return chunks
    .map((chunk: any) => {
      if (typeof chunk === "string") return chunk;
      if (!Array.isArray(chunk)) return "";
      const [text, annotations] = chunk;
      // For mentions, resolve name even in plain text
      if (annotations?.length) {
        for (const ann of annotations) {
          if (!Array.isArray(ann)) continue;
          if (ann[0] === "u") return nameCache.get(`user:${ann[1]}`) ?? ann[1] ?? text ?? "";
          if (ann[0] === "p") return nameCache.get(`page:${ann[1]}`) ?? text ?? "";
        }
      }
      return text ?? "";
    })
    .join("");
}

// --- Block tree loading with pagination ---

async function fetchBlockTree(
  blockId: string,
  signal?: AbortSignal,
): Promise<Map<string, any>> {
  const blocks = new Map<string, any>();
  let cursor = { stack: [] as any[] };

  for (let chunk = 0; chunk < MAX_PAGE_CHUNKS; chunk++) {
    const resp = await notionPost(
      "loadPageChunk",
      {
        pageId: blockId,
        limit: 200,
        cursor,
        chunkNumber: chunk,
        verticalColumns: false,
      },
      signal,
    );

    for (const [id, data] of Object.entries(resp.recordMap?.block ?? {})) {
      const value = (data as any)?.value?.value ?? (data as any)?.value;
      if (value) blocks.set(id, value);
    }

    const nextCursor = resp.cursor;
    if (!nextCursor?.stack?.length) break;
    cursor = nextCursor;
  }

  return blocks;
}

// --- Block tree → Markdown ---

async function internalBlocksToMarkdown(
  blockIds: string[],
  blocks: Map<string, any>,
  signal?: AbortSignal,
  depth = 0,
  indent = "",
): Promise<string> {
  if (depth > MAX_BLOCK_DEPTH) return `${indent}*(content truncated — max depth)*\n`;

  const lines: string[] = [];
  let numIdx = 0;

  for (const id of blockIds) {
    const block = blocks.get(id);
    if (!block) continue;

    const type = block.type;
    if (type !== "numbered_list") numIdx = 0;

    const text = internalRichTextToMd(block.properties?.title);
    const children: string[] = block.content ?? [];

    switch (type) {
      case "text":
        lines.push(`${indent}${text}`, "");
        break;

      case "header":
        lines.push(`${indent}# ${text}`, "");
        break;
      case "sub_header":
        lines.push(`${indent}## ${text}`, "");
        break;
      case "sub_sub_header":
        lines.push(`${indent}### ${text}`, "");
        break;

      case "bulleted_list":
        lines.push(`${indent}- ${text}`);
        if (children.length) {
          lines.push(await internalBlocksToMarkdown(children, blocks, signal, depth + 1, indent + "  "));
        }
        break;

      case "numbered_list":
        numIdx++;
        lines.push(`${indent}${numIdx}. ${text}`);
        if (children.length) {
          lines.push(await internalBlocksToMarkdown(children, blocks, signal, depth + 1, indent + "   "));
        }
        break;

      case "to_do": {
        const checked = block.properties?.checked?.[0]?.[0] === "Yes";
        lines.push(`${indent}- [${checked ? "x" : " "}] ${text}`);
        if (children.length) {
          lines.push(await internalBlocksToMarkdown(children, blocks, signal, depth + 1, indent + "  "));
        }
        break;
      }

      case "toggle":
        lines.push(`${indent}<details>`, `${indent}<summary>${text}</summary>`, "");
        if (children.length) {
          lines.push(await internalBlocksToMarkdown(children, blocks, signal, depth + 1, indent));
        }
        lines.push(`${indent}</details>`, "");
        break;

      case "code": {
        const language = block.properties?.language?.[0]?.[0] ?? "";
        const code = internalPlainText(block.properties?.title);
        lines.push(`${indent}\`\`\`${language.toLowerCase()}`, code, `\`\`\``, "");
        break;
      }

      case "quote":
        lines.push(`${indent}> ${text}`);
        if (children.length) {
          lines.push(await internalBlocksToMarkdown(children, blocks, signal, depth + 1, `${indent}> `));
        }
        lines.push("");
        break;

      case "callout": {
        const icon = block.format?.page_icon ?? "";
        lines.push(`${indent}> ${icon} ${text}`);
        if (children.length) {
          lines.push(await internalBlocksToMarkdown(children, blocks, signal, depth + 1, `${indent}> `));
        }
        lines.push("");
        break;
      }

      case "divider":
        lines.push("---", "");
        break;

      case "image": {
        const src = block.format?.display_source ?? block.properties?.source?.[0]?.[0] ?? "";
        const caption = internalRichTextToMd(block.properties?.caption);
        lines.push(`${indent}![${caption}](${src})`, "");
        break;
      }

      case "bookmark": {
        const url = block.properties?.link?.[0]?.[0] ?? "";
        const title = internalPlainText(block.properties?.title);
        const desc = internalPlainText(block.properties?.description);
        if (title) {
          lines.push(`${indent}[${title}](${url})${desc ? ` — ${desc}` : ""}`, "");
        } else {
          lines.push(`${indent}${url}`, "");
        }
        break;
      }

      case "embed":
      case "video":
      case "audio":
      case "file":
      case "pdf": {
        const src = block.format?.display_source ?? block.properties?.source?.[0]?.[0] ?? "";
        const caption = internalRichTextToMd(block.properties?.caption);
        lines.push(`${indent}[${caption || type}](${src})`, "");
        break;
      }

      case "equation": {
        const expr = block.properties?.title?.[0]?.[0] ?? "";
        lines.push(`$$${expr}$$`, "");
        break;
      }

      case "table_of_contents":
        break;

      case "column_list":
        for (const childId of children) {
          const col = blocks.get(childId);
          if (col?.content?.length) {
            lines.push(await internalBlocksToMarkdown(col.content, blocks, signal, depth + 1, indent));
          }
        }
        break;

      case "page":
      case "collection_view_page":
      case "collection_view": {
        const title = internalPlainText(block.properties?.title);
        const icon = type === "page" ? "📄" : "🗃️";
        lines.push(`${icon} [${title || "(untitled)"}](https://www.notion.so/${id.replace(/-/g, "")})`, "");
        break;
      }

      case "alias": {
        const pointerId = block.format?.alias_pointer?.id;
        if (pointerId) {
          const target = blocks.get(pointerId);
          const targetTitle = target ? internalPlainText(target.properties?.title) : pointerId;
          lines.push(`${indent}↗ ${targetTitle}`, "");
        }
        break;
      }

      case "synced_block":
      case "transclusion_container":
      case "transclusion_reference":
        if (children.length) {
          lines.push(await internalBlocksToMarkdown(children, blocks, signal, depth + 1, indent));
        }
        break;

      case "table": {
        const colOrder: string[] = block.format?.table_block_column_order ?? [];
        const colHeader = block.format?.table_block_column_header ?? false;

        let isFirst = true;
        for (const rowId of children) {
          const row = blocks.get(rowId);
          if (!row?.properties) continue;
          const cells = colOrder.map((col) => {
            const val = internalRichTextToMd(row.properties[col]);
            return val.replace(/\|/g, "\\|").replace(/\n/g, " ");
          });
          lines.push(`${indent}| ${cells.join(" | ")} |`);
          if (isFirst && colHeader) {
            lines.push(`${indent}| ${cells.map(() => "---").join(" | ")} |`);
          }
          isFirst = false;
        }
        lines.push("");
        break;
      }

      default:
        if (text) lines.push(`${indent}${text}`, "");
        if (children.length) {
          lines.push(await internalBlocksToMarkdown(children, blocks, signal, depth + 1, indent));
        }
        break;
    }
  }

  return lines.join("\n");
}

// --- Read page ---

async function readPageInternal(
  id: string,
  signal?: AbortSignal,
): Promise<{ title: string; url: string; markdown: string; type: string }> {
  const syncResp = await notionPost(
    "syncRecordValues",
    { requests: [{ pointer: { table: "block", id }, version: -1 }] },
    signal,
  );

  const blockWrapper = syncResp.recordMap?.block?.[id];
  const blockData = blockWrapper?.value?.value ?? blockWrapper?.value;
  if (!blockData) throw new Error(`Block ${id} not found or not accessible.`);

  const blockType = blockData.type;
  const spaceId = blockWrapper?.spaceId ?? blockData.space_id;

  if (blockType === "collection_view_page" || blockType === "collection_view") {
    return await readCollectionInternal(id, blockData, spaceId, signal);
  }

  // Regular page
  const blocks = await fetchBlockTree(id, signal);
  const pageBlock = blocks.get(id);
  const childIds = pageBlock?.content ?? [];

  // Collect and resolve all mentions
  const mentions = { users: new Set<string>(), pages: new Set<string>() };
  for (const block of blocks.values()) collectBlockMentions(block, mentions);
  await resolveNames(mentions, signal);

  const title = internalPlainText(pageBlock?.properties?.title);
  const markdown = await internalBlocksToMarkdown(childIds, blocks, signal);

  return {
    title,
    url: `https://www.notion.so/${id.replace(/-/g, "")}`,
    markdown: title ? `# ${title}\n\n${markdown}` : markdown,
    type: "page",
  };
}

// --- Read collection/database ---

async function readCollectionInternal(
  pageId: string,
  blockData: any,
  spaceId: string,
  signal?: AbortSignal,
): Promise<{ title: string; url: string; markdown: string; type: string }> {
  const collectionId = blockData.collection_id;
  const viewId = blockData.view_ids?.[0];
  if (!collectionId) throw new Error("No collection ID found on this database page.");

  // Fetch schema
  const collResp = await notionPost(
    "syncRecordValues",
    { requests: [{ pointer: { table: "collection", id: collectionId, spaceId }, version: -1 }] },
    signal,
  );

  const collValue =
    collResp.recordMap?.collection?.[collectionId]?.value?.value ??
    collResp.recordMap?.collection?.[collectionId]?.value;
  const schema = collValue?.schema ?? {};

  // Query rows
  const queryResp = await notionPost(
    "queryCollection",
    {
      collection: { id: collectionId, spaceId },
      collectionView: { id: viewId, spaceId },
      loader: {
        type: "reducer",
        reducers: { collection_group_results: { type: "results", limit: MAX_DB_RESULTS } },
        searchQuery: "",
        userTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
    },
    signal,
  );

  const blockIds: string[] = queryResp.result?.reducerResults?.collection_group_results?.blockIds ?? [];
  const blocks = queryResp.recordMap?.block ?? {};

  // Collect and resolve mentions across all rows
  const mentions = { users: new Set<string>(), pages: new Set<string>() };
  for (const bid of blockIds) {
    const block = blocks[bid]?.value?.value ?? blocks[bid]?.value;
    collectBlockMentions(block, mentions);
  }
  await resolveNames(mentions, signal);

  const title = internalPlainText(collValue?.name);
  const schemaKeys = Object.keys(schema);
  const colNames = schemaKeys.map((k) => schema[k].name);

  if (!blockIds.length) {
    return {
      title,
      url: `https://www.notion.so/${pageId.replace(/-/g, "")}`,
      markdown: `# ${title}\n\n*No entries*`,
      type: "database",
    };
  }

  const header = `| ${colNames.join(" | ")} |`;
  const sep = `| ${colNames.map(() => "---").join(" | ")} |`;
  const rows: string[] = [];

  for (const bid of blockIds) {
    const block = blocks[bid]?.value?.value ?? blocks[bid]?.value;
    if (!block?.properties) continue;
    const cells = schemaKeys.map((k) => {
      const val = internalRichTextToMd(block.properties[k]);
      return val.replace(/\|/g, "\\|").replace(/\n/g, " ");
    });
    rows.push(`| ${cells.join(" | ")} |`);
  }

  const truncNote = blockIds.length >= MAX_DB_RESULTS ? `\n\n*Showing first ${MAX_DB_RESULTS} entries*` : "";

  return {
    title,
    url: `https://www.notion.so/${pageId.replace(/-/g, "")}`,
    markdown: `# ${title}\n\n${header}\n${sep}\n${rows.join("\n")}${truncNote}`,
    type: "database",
  };
}

// --- Space discovery ---

interface SpaceInfo {
  id: string;
  name: string;
}

let cachedSpaces: SpaceInfo[] | undefined;

async function discoverSpaces(signal?: AbortSignal): Promise<SpaceInfo[]> {
  if (cachedSpaces) return cachedSpaces;

  const resp = await notionPost("getSpaces", {}, signal);
  const spaceIds = new Set<string>();

  // Walk all users returned — each may belong to different workspaces.
  for (const userData of Object.values(resp) as any[]) {
    for (const svData of Object.values(userData?.space_view ?? {}) as any[]) {
      const sv = svData?.value?.value ?? svData?.value;
      if (sv?.space_id) spaceIds.add(sv.space_id);
    }
    // Also grab directly listed spaces.
    for (const sid of Object.keys(userData?.space ?? {})) {
      spaceIds.add(sid);
    }
  }

  // Resolve space names
  if (!spaceIds.size) {
    cachedSpaces = [];
    return cachedSpaces;
  }

  const nameResp = await notionPost(
    "syncRecordValues",
    {
      requests: [...spaceIds].map((id) => ({ pointer: { table: "space", id }, version: -1 })),
    },
    signal,
  );

  cachedSpaces = [...spaceIds].map((id) => {
    const val = nameResp.recordMap?.space?.[id]?.value?.value ?? nameResp.recordMap?.space?.[id]?.value;
    return { id, name: val?.name ?? "(unnamed)" };
  });

  return cachedSpaces;
}

// --- Search ---

async function searchNotion(
  query: string,
  spaceId?: string,
  signal?: AbortSignal,
): Promise<Array<{ type: string; id: string; title: string; url: string; space: string }>> {
  let targets: SpaceInfo[];
  if (spaceId) {
    targets = [{ id: spaceId, name: "" }];
  } else {
    targets = await discoverSpaces(signal);
  }

  const results: Array<{ type: string; id: string; title: string; url: string; space: string }> = [];

  for (const space of targets) {
    const resp = await notionPost(
      "search",
      {
        type: "BlocksInSpace",
        query,
        spaceId: space.id,
        limit: 20,
        filters: {
          isDeletedOnly: false,
          excludeTemplates: true,
          navigableBlockContentOnly: true,
          requireEditPermissions: false,
          ancestors: [],
          createdBy: [],
          editedBy: [],
          lastEditedTime: {},
          createdTime: {},
        },
        sort: { field: "relevance" },
        source: "quick_find",
      },
      signal,
    );

    // Collect mentions from search result titles so we can resolve them.
    const mentions = { users: new Set<string>(), pages: new Set<string>() };
    for (const r of resp.results ?? []) {
      const block = resp.recordMap?.block?.[r.id]?.value?.value ?? resp.recordMap?.block?.[r.id]?.value;
      collectMentionIds(block?.properties?.title, mentions);
    }
    if (mentions.users.size || mentions.pages.size) await resolveNames(mentions, signal);

    for (const r of resp.results ?? []) {
      const block = resp.recordMap?.block?.[r.id]?.value?.value ?? resp.recordMap?.block?.[r.id]?.value;
      let title = internalRichTextToMd(block?.properties?.title) || "";

      // collection_view_page blocks have no title in properties — pull from the collection.
      if (!title && block?.collection_id) {
        const coll = resp.recordMap?.collection?.[block.collection_id];
        const collVal = coll?.value?.value ?? coll?.value;
        title = internalRichTextToMd(collVal?.name) || "";
      }

      results.push({
        type: block?.type ?? "unknown",
        id: r.id,
        title: title || "(untitled)",
        url: `https://www.notion.so/${r.id.replace(/-/g, "")}`,
        space: space.name,
      });
    }
  }

  return results;
}

// --- Tool schemas ---

const NotionReadParams = Type.Object({
  url: Type.String({
    description:
      "A Notion URL or page/database ID. Examples: 'https://www.notion.so/My-Page-abc123...' or a raw 32-char hex ID.",
  }),
});

const NotionSearchParams = Type.Object({
  query: Type.String({
    description: "Search query — matches against page and database titles in the workspace.",
  }),
  spaceId: Type.Optional(
    Type.String({
      description: "Optional Notion space/workspace ID to search in. Omit to search all accessible spaces.",
    }),
  ),
});

type NotionReadInput = Static<typeof NotionReadParams>;
type NotionSearchInput = Static<typeof NotionSearchParams>;

// --- Extension ---

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "NotionRead",
    label: "Notion Read",
    description: [
      "Read a Notion page or database by URL or ID.",
      "Pages are returned as markdown. Databases are returned as a markdown table.",
      "Auth is automatic on macOS — reads token from Notion.app. Set NOTION_TOKEN to override.",
    ].join("\n"),
    promptSnippet:
      "Read Notion pages and databases. Accepts Notion URLs or page/database IDs. Auth is automatic from Notion.app.",
    parameters: NotionReadParams,

    async execute(_toolCallId, params: NotionReadInput, signal) {
      const id = parseNotionId(params.url);
      const result = await readPageInternal(id, signal);
      const truncated = truncateHead(result.markdown, {
        maxLines: DEFAULT_MAX_LINES,
        maxBytes: DEFAULT_MAX_BYTES,
      });
      return {
        content: [{ type: "text" as const, text: truncated.content }],
        details: {
          type: result.type,
          title: result.title,
          url: result.url,
          truncated: truncated.truncated,
        },
      };
    },
  });

  pi.registerTool({
    name: "NotionSearch",
    label: "Notion Search",
    description: [
      "Search for pages and databases in Notion by title.",
      "Returns a list of matching items with titles, URLs, and types.",
      "Auth is automatic on macOS — reads token from Notion.app. Set NOTION_TOKEN to override.",
    ].join("\n"),
    promptSnippet:
      "Search Notion workspace for pages and databases by title. Auth is automatic from Notion.app.",
    parameters: NotionSearchParams,

    async execute(_toolCallId, params: NotionSearchInput, signal) {
      const results = await searchNotion(params.query, params.spaceId, signal);

      if (!results.length) {
        return {
          content: [{ type: "text" as const, text: "No results found." }],
          details: { query: params.query, count: 0 },
        };
      }

      const lines = results.map(
        (r) =>
          `- **${r.title}** (${r.type})${r.space ? ` [${r.space}]` : ""} — ${r.url}`,
      );

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
        details: { query: params.query, count: results.length },
      };
    },
  });
}
