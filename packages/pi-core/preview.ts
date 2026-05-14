export type TruncateMode = "start" | "end" | "middle";

export type PreviewResult = {
  preview: string;
  truncated: boolean;
  totalLines: number;
  totalChars: number;
  previewLines: number;
  previewChars: number;
};

function truncateLines(lines: string[], maxLines: number, mode: TruncateMode) {
  if (maxLines <= 0 || lines.length <= maxLines) {
    return { lines, truncated: false };
  }

  if (mode === "end") {
    return { lines: lines.slice(-maxLines), truncated: true };
  }

  if (mode === "middle" && maxLines > 1) {
    const marker = "... (truncated) ...";
    const keep = maxLines - 1;
    const headCount = Math.ceil(keep / 2);
    const tailCount = Math.floor(keep / 2);
    const head = lines.slice(0, headCount);
    const tail = tailCount > 0 ? lines.slice(-tailCount) : [];
    return { lines: [...head, marker, ...tail], truncated: true };
  }

  return { lines: lines.slice(0, maxLines), truncated: true };
}

function truncateText(text: string, maxChars: number, mode: TruncateMode) {
  if (maxChars <= 0 || text.length <= maxChars) {
    return { text, truncated: false };
  }

  if (mode === "end") {
    return { text: text.slice(-maxChars), truncated: true };
  }

  if (mode === "middle" && maxChars > 10) {
    const marker = "... (truncated) ...";
    const keep = maxChars - marker.length;
    if (keep > 0) {
      const headCount = Math.ceil(keep / 2);
      const tailCount = Math.floor(keep / 2);
      return {
        text: text.slice(0, headCount) + marker + text.slice(text.length - tailCount),
        truncated: true,
      };
    }
  }

  return { text: text.slice(0, maxChars), truncated: true };
}

export function buildPreview(
  content: string,
  options: { maxLines: number; maxChars: number; mode: TruncateMode },
): PreviewResult {
  const normalized = content.trim();
  if (!normalized) {
    return {
      preview: "",
      truncated: false,
      totalLines: 0,
      totalChars: 0,
      previewLines: 0,
      previewChars: 0,
    };
  }

  const lines = normalized.split("\n");
  const totalLines = lines.length;
  const totalChars = normalized.length;

  const lineResult = truncateLines(lines, options.maxLines, options.mode);
  const text = lineResult.lines.join("\n");
  const charResult = truncateText(text, options.maxChars, options.mode);
  const preview = charResult.text;

  return {
    preview,
    truncated: lineResult.truncated || charResult.truncated,
    totalLines,
    totalChars,
    previewLines: preview ? preview.split("\n").length : 0,
    previewChars: preview.length,
  };
}

export function formatPreviewBlock(
  label: string,
  content: string,
  options: { maxLines: number; maxChars: number; mode: TruncateMode },
): string {
  const result = buildPreview(content, options);

  if (!result.preview) {
    return `${label}: empty.`;
  }

  const meta = `${label} (${result.totalLines} lines, ${result.totalChars} chars)`;
  const note = result.truncated
    ? `\n[preview truncated: showing ${result.previewLines}/${result.totalLines} lines, ${result.previewChars}/${result.totalChars} chars]`
    : "";
  return `${meta}\n\n${result.preview}${note}`;
}
