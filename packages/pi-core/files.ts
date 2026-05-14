import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export function expandHome(input: string): string {
  if (input === "~") return os.homedir();
  if (input.startsWith("~/")) return path.join(os.homedir(), input.slice(2));
  return input;
}

export async function ensureParentDir(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

export async function atomicWriteUtf8(filePath: string, content: string): Promise<void> {
  await ensureParentDir(filePath);

  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tmpPath = path.join(
    dir,
    `.${base}.tmp.${process.pid}.${Math.random().toString(16).slice(2)}`,
  );

  await fs.writeFile(tmpPath, content, "utf8");

  try {
    await fs.rename(tmpPath, filePath);
  } catch (error: any) {
    if (error?.code === "EEXIST" || error?.code === "EPERM") {
      await fs.unlink(filePath).catch(() => {});
      await fs.rename(tmpPath, filePath);
      return;
    }

    await fs.unlink(tmpPath).catch(() => {});
    throw error;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type FileLockOptions = {
  staleMs?: number;
  timeoutMs?: number;
};

export async function withFileLock<T>(
  filePath: string,
  fn: () => Promise<T>,
  options: FileLockOptions = {},
): Promise<T> {
  const lockPath = `${filePath}.lock`;
  const staleMs = options.staleMs ?? 30_000;
  const timeoutMs = options.timeoutMs ?? 5_000;

  await ensureParentDir(lockPath);

  const start = Date.now();
  while (true) {
    try {
      const handle = await fs.open(lockPath, "wx");
      try {
        await handle.writeFile(
          JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }) + "\n",
          "utf8",
        );
      } catch {}

      try {
        return await fn();
      } finally {
        await handle.close().catch(() => {});
        await fs.unlink(lockPath).catch(() => {});
      }
    } catch (error: any) {
      if (error?.code !== "EEXIST") throw error;

      try {
        const stats = await fs.stat(lockPath);
        if (Date.now() - stats.mtimeMs > staleMs) {
          await fs.unlink(lockPath);
          continue;
        }
      } catch {}

      if (Date.now() - start > timeoutMs) {
        throw new Error(`Timed out waiting for lock: ${lockPath}`);
      }
      await sleep(40 + Math.random() * 80);
    }
  }
}

export async function readTail(filePath: string, maxBytes = 256 * 1024): Promise<string> {
  let fileHandle: fs.FileHandle | undefined;
  try {
    const stats = await fs.stat(filePath);
    const size = stats.size;
    const start = Math.max(0, size - maxBytes);
    const length = size - start;
    if (length <= 0) return "";

    const buffer = Buffer.alloc(length);
    fileHandle = await fs.open(filePath, "r");
    const { bytesRead } = await fileHandle.read(buffer, 0, length, start);
    if (bytesRead === 0) return "";

    let chunk = buffer.subarray(0, bytesRead).toString("utf8");
    if (start > 0) {
      const firstNewline = chunk.indexOf("\n");
      if (firstNewline !== -1) chunk = chunk.slice(firstNewline + 1);
    }
    return chunk;
  } catch {
    return "";
  } finally {
    await fileHandle?.close();
  }
}
