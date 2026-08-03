import { closeSync, openSync, readSync, statSync } from "node:fs";

export interface IncrementalReadResult {
  readonly lines: readonly string[];
  readonly newOffset: number;
}

/**
 * Reads only the bytes appended after `byteOffset`. A trailing line with no
 * terminating newline is left unread (may still be mid-write) and picked up
 * on the next call once it's complete.
 */
export function readNewLines(filePath: string, byteOffset: number): IncrementalReadResult {
  const size = statSync(filePath).size;
  if (size <= byteOffset) {
    return { lines: [], newOffset: byteOffset };
  }

  const length = size - byteOffset;
  const buffer = Buffer.alloc(length);
  const fd = openSync(filePath, "r");
  try {
    readSync(fd, buffer, 0, length, byteOffset);
  } finally {
    closeSync(fd);
  }

  const text = buffer.toString("utf8");
  const lastNewline = text.lastIndexOf("\n");
  if (lastNewline === -1) {
    return { lines: [], newOffset: byteOffset };
  }

  const complete = text.slice(0, lastNewline);
  const consumedBytes = Buffer.byteLength(text.slice(0, lastNewline + 1), "utf8");
  const lines = complete.split("\n").filter((line) => line.length > 0);

  return { lines, newOffset: byteOffset + consumedBytes };
}
