import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum, Type, type Static } from "@mattrobenolt/pi-core/schema";

const HUNK_BIN = process.env.HUNK_BIN?.trim() || "hunk";
const TIMEOUT_MS = 15_000;

const ACTIONS = ["status", "read", "reply", "comment", "navigate", "reload"] as const;

const Params = Type.Object({
  action: StringEnum(ACTIONS, {
    description:
      "status lists live sessions; read returns the review and its notes; reply answers a note; comment adds a note; navigate moves the review; reload shows new changes.",
  }),
  repo: Type.Optional(
    Type.String({
      description: "Repository path. Defaults to the session working directory.",
    }),
  ),
  session_id: Type.Optional(
    Type.String({
      description:
        "Live Hunk session id. Use it when more than one session matches the repository.",
    }),
  ),
  note_id: Type.Optional(
    Type.String({
      description: "Note id from action=read. Used by reply and navigate.",
    }),
  ),
  summary: Type.Optional(Type.String({ description: "Reply text, or the body of a new note." })),
  file: Type.Optional(Type.String({ description: "Repository-relative file path." })),
  line: Type.Optional(
    Type.Number({ description: "Line number for comment or navigate. New side by default." }),
  ),
  side: Type.Optional(
    StringEnum(["new", "old"], { description: "Side of the diff for line. Defaults to new." }),
  ),
  hunk: Type.Optional(
    Type.Number({ description: "One-based hunk index for comment or navigate." }),
  ),
  direction: Type.Optional(
    StringEnum(["next-comment", "prev-comment"], {
      description: "Move to the next or previous note.",
    }),
  ),
  include_patch: Type.Optional(
    Type.Boolean({ description: "With action=read, include the raw unified diff in details." }),
  ),
  kind: Type.Optional(
    StringEnum(["diff", "show"], {
      description: "With action=reload, show the working tree diff or a commit. Defaults to diff.",
    }),
  ),
  ref: Type.Optional(
    Type.String({ description: "With action=reload kind=show, the commit or revision to show." }),
  ),
  focus: Type.Optional(
    Type.Boolean({ description: "Move the Hunk selection to the new note. Defaults to false." }),
  ),
});

type Input = Static<typeof Params>;

interface HunkSession {
  sessionId: string;
  cwd: string;
  repoRoot: string;
  title?: string;
}

interface HunkComment {
  noteId: string;
  parentId?: string;
  source: "user" | "agent" | "ai";
  filePath: string;
  hunkIndex?: number;
  oldRange?: [number, number];
  newRange?: [number, number];
  body: string;
  author?: string;
  createdAt?: string;
}

interface HunkReview {
  sessionId: string;
  cwd: string;
  repoRoot: string;
  selectedFile?: {
    path: string;
    hunkCount?: number;
    additions?: number;
    deletions?: number;
  } | null;
  selectedHunk?: { index: number } | null;
  liveCommentCount?: number;
  reviewNoteCount?: number;
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function anchor(comment: HunkComment): string {
  const range = comment.newRange ?? comment.oldRange;
  if (!range) return comment.filePath;
  const [start, end] = range;
  return `${comment.filePath}:${start}${end > start ? `-${end}` : ""}`;
}

function targetArgs(params: Input, ctx: { cwd: string }): string[] {
  if (params.session_id) return [params.session_id];
  return ["--repo", params.repo ?? ctx.cwd];
}

function execCwd(params: Input, ctx: { cwd: string }): string {
  return params.repo ?? ctx.cwd;
}

function requireParam(params: Input, key: keyof Input): string {
  const value = params[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`action=${params.action} requires ${String(key)}`);
  }
  return value;
}

function noteSummary(comments: HunkComment[]): string {
  const replies = new Map<string, HunkComment[]>();
  for (const comment of comments) {
    if (!comment.parentId) continue;
    const list = replies.get(comment.parentId) ?? [];
    list.push(comment);
    replies.set(comment.parentId, list);
  }

  const roots = comments.filter((comment) => !comment.parentId);
  const lines = roots.map((comment) => {
    const answered = comment.source === "user" && replies.has(comment.noteId);
    const suffix = comment.source === "user" && !answered ? " (unanswered)" : "";
    const body = [`- [${comment.noteId}] ${anchor(comment)} — ${oneLine(comment.body)}${suffix}`];
    for (const reply of replies.get(comment.noteId) ?? []) {
      body.push(`  ↳ [${reply.noteId}] ${oneLine(reply.body)}`);
    }
    return body.join("\n");
  });

  const userCount = comments.filter((comment) => comment.source === "user").length;
  const agentCount = comments.filter((comment) => comment.source !== "user").length;
  const heading = `${userCount} user note${userCount === 1 ? "" : "s"}, ${agentCount} agent note${agentCount === 1 ? "" : "s"}`;
  return [heading, ...lines].join("\n");
}

export default function hunkExtension(pi: ExtensionAPI) {
  async function runJson(
    args: string[],
    params: Input,
    ctx: { cwd: string },
    signal: AbortSignal | undefined,
  ): Promise<unknown> {
    const result = await pi.exec(HUNK_BIN, args, {
      cwd: execCwd(params, ctx),
      signal,
      timeout: TIMEOUT_MS,
    });
    if (result.code !== 0) {
      const message =
        result.stderr.trim() ||
        result.stdout.trim() ||
        `hunk ${args.slice(0, 3).join(" ")} exited ${result.code}`;
      const hint = /multiple|more than one|ambiguous/i.test(message)
        ? "\nMore than one live session matches. Call hunk_review action=status and pass session_id."
        : "";
      throw new Error(`${message}${hint}`);
    }
    try {
      return JSON.parse(result.stdout);
    } catch {
      throw new Error(`hunk returned non-JSON output: ${result.stdout.slice(0, 200)}`);
    }
  }

  pi.registerTool({
    name: "hunk_review",
    label: "Hunk Review",
    description:
      "Read and answer line-anchored review notes from a live Hunk pane. Use action=read when the user sends a message that starts with 'Hunk review notes:'. Reply under each note with action=reply instead of answering only in chat. The tool never starts the Hunk TUI.",
    promptSnippet: "Read and answer live Hunk review notes",
    promptGuidelines: [
      "When a user message starts with 'Hunk review notes:', call hunk_review action=read before editing code.",
      "After you address a note, call hunk_review action=reply with its note_id. Do not leave the answer only in chat.",
      "Use action=status when hunk_review reports more than one matching session.",
    ],
    parameters: Params,
    async execute(_toolCallId, params: Input, signal, _onUpdate, ctx) {
      const target = targetArgs(params, ctx);

      if (params.action === "status") {
        const payload = (await runJson(["session", "list", "--json"], params, ctx, signal)) as {
          sessions?: HunkSession[];
        };
        const sessions = payload.sessions ?? [];
        if (sessions.length === 0) {
          return {
            content: [{ type: "text", text: "No live Hunk sessions." }],
            details: { action: params.action, sessions },
          };
        }
        const text = sessions
          .map(
            (session) =>
              `- ${session.sessionId} — ${session.cwd}${session.title ? ` (${session.title})` : ""}`,
          )
          .join("\n");
        return {
          content: [{ type: "text", text: `Live Hunk sessions:\n${text}` }],
          details: { action: params.action, sessions },
        };
      }

      if (params.action === "read") {
        const reviewArgs = ["session", "review", ...target, "--json"];
        if (params.include_patch) reviewArgs.push("--include-patch");
        const [reviewPayload, commentsPayload] = await Promise.all([
          runJson(reviewArgs, params, ctx, signal),
          runJson(
            ["session", "comment", "list", ...target, "--type", "all", "--json"],
            params,
            ctx,
            signal,
          ),
        ]);
        const review = (reviewPayload as { review: HunkReview }).review;
        const comments = (commentsPayload as { comments?: HunkComment[] }).comments ?? [];
        const selected = review.selectedFile
          ? `${review.selectedFile.path}${review.selectedHunk ? ` hunk ${review.selectedHunk.index + 1}` : ""}`
          : "none";
        const text = [
          `Hunk session ${review.sessionId} — ${review.cwd}`,
          `selected: ${selected}`,
          noteSummary(comments),
        ].join("\n");
        return {
          content: [{ type: "text", text }],
          details: {
            action: params.action,
            session_id: review.sessionId,
            selected_file: review.selectedFile?.path ?? null,
            selected_hunk: review.selectedHunk?.index ?? null,
            comments,
            review: params.include_patch ? reviewPayload : undefined,
          },
        };
      }

      if (params.action === "reply") {
        const noteId = requireParam(params, "note_id");
        const summary = requireParam(params, "summary");
        const args = [
          "session",
          "comment",
          "add",
          ...target,
          "--reply-to",
          noteId,
          "--summary",
          summary,
          "--author",
          "pi",
          "--json",
        ];
        if (params.focus) args.push("--focus");
        const payload = await runJson(args, params, ctx, signal);
        const result = (payload as { result?: Record<string, unknown> }).result ?? {};
        return {
          content: [
            {
              type: "text",
              text: `Replied under ${noteId}${result.commentId ? ` as ${String(result.commentId)}` : ""}.`,
            },
          ],
          details: { action: params.action, note_id: noteId, result },
        };
      }

      if (params.action === "comment") {
        const summary = requireParam(params, "summary");
        const file = requireParam(params, "file");
        const side = params.side ?? "new";
        const args = ["session", "comment", "add", ...target, "--file", file];
        if (params.line === undefined) {
          throw new Error("action=comment requires line");
        }
        args.push(side === "old" ? "--old-line" : "--new-line", String(params.line));
        args.push("--summary", summary, "--author", "pi", "--json");
        if (params.focus) args.push("--focus");
        const payload = await runJson(args, params, ctx, signal);
        const result = (payload as { result?: Record<string, unknown> }).result ?? {};
        return {
          content: [{ type: "text", text: `Added a note at ${file}.` }],
          details: { action: params.action, file, result },
        };
      }

      if (params.action === "navigate") {
        const args = ["session", "navigate", ...target];
        if (params.note_id) {
          args.push("--comment", params.note_id);
        } else if (params.direction) {
          args.push(params.direction === "next-comment" ? "--next-comment" : "--prev-comment");
        } else {
          const file = requireParam(params, "file");
          args.push("--file", file);
          if (params.hunk !== undefined) args.push("--hunk", String(params.hunk));
          else if (params.line !== undefined) {
            args.push(
              (params.side ?? "new") === "old" ? "--old-line" : "--new-line",
              String(params.line),
            );
          } else {
            throw new Error("action=navigate requires note_id, direction, hunk, or line");
          }
        }
        args.push("--json");
        const payload = await runJson(args, params, ctx, signal);
        const result = (payload as { result?: Record<string, unknown> }).result ?? {};
        return {
          content: [{ type: "text", text: "Moved the Hunk review." }],
          details: { action: params.action, result },
        };
      }

      if (params.action === "reload") {
        const kind = params.kind ?? "diff";
        const args = ["session", "reload", ...target, "--json", "--", kind];
        if (params.ref) args.push(params.ref);
        const payload = await runJson(args, params, ctx, signal);
        return {
          content: [{ type: "text", text: `Reloaded the Hunk review with ${kind}.` }],
          details: { action: params.action, kind, result: payload },
        };
      }

      throw new Error(`Unsupported hunk_review action: ${String(params.action)}`);
    },
  });
}
