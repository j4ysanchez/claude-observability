import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function defaultTranscriptRoot(): string {
  return join(homedir(), ".claude", "projects");
}

export function discoverTranscripts(root: string = defaultTranscriptRoot()): string[] {
  if (!existsSync(root)) {
    return [];
  }

  const results: string[] = [];

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        results.push(fullPath);
      }
    }
  };

  walk(root);
  return results.sort();
}
