import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
} from "@earendil-works/pi-coding-agent";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ensureParentDir } from "./files";

export type TruncatedOutput = {
  text: string;
  details: {
    truncated: boolean;
    outputLines?: number;
    totalLines?: number;
    outputBytes?: number;
    totalBytes?: number;
    tempFile?: string;
  };
};

export function truncateForModel(text: string): { text: string; truncated: boolean } {
  const truncated = truncateHead(text, {
    maxLines: DEFAULT_MAX_LINES,
    maxBytes: DEFAULT_MAX_BYTES,
  });
  return {
    text: truncated.content,
    truncated: truncated.truncated,
  };
}

export async function truncateForModelWithTempFile(
  text: string,
  prefix: string,
): Promise<TruncatedOutput> {
  const truncation = truncateHead(text, {
    maxLines: DEFAULT_MAX_LINES,
    maxBytes: DEFAULT_MAX_BYTES,
  });

  if (!truncation.truncated) {
    return { text: truncation.content, details: { truncated: false } };
  }

  let tempFile: string | undefined;
  try {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-tool-output-"));
    tempFile = path.join(dir, `${prefix}-${Date.now()}.txt`);
    await fs.writeFile(tempFile, text, "utf8");
  } catch {
    tempFile = undefined;
  }

  let note = `\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).`;
  note += tempFile ? ` Full output saved to: ${tempFile}]` : " Full output could not be saved.]";

  return {
    text: truncation.content + note,
    details: {
      truncated: true,
      outputLines: truncation.outputLines,
      totalLines: truncation.totalLines,
      outputBytes: truncation.outputBytes,
      totalBytes: truncation.totalBytes,
      tempFile,
    },
  };
}

export function resolveOutputFilePath(
  outputFile: unknown,
  cwd = process.cwd(),
): string | undefined {
  if (typeof outputFile !== "string") return undefined;
  const trimmed = outputFile.trim();
  return trimmed ? path.resolve(cwd, trimmed) : undefined;
}

export async function writeOptionalOutputFile(
  outputFile: unknown,
  text: string,
  cwd = process.cwd(),
): Promise<string | undefined> {
  const outputFilePath = resolveOutputFilePath(outputFile, cwd);
  if (!outputFilePath) return undefined;

  await ensureParentDir(outputFilePath);
  await fs.writeFile(outputFilePath, text, "utf8");
  return outputFilePath;
}
