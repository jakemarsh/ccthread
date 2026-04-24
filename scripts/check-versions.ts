#!/usr/bin/env bun
// Verify that ccthread's version is in sync across all three places it
// has to match for a release to work:
//
//   - package.json                         (baked into the binary)
//   - plugin/.claude-plugin/plugin.json    (what Claude Code reads)
//   - plugin/bin/.ccthread-version         (what the dispatcher fetches)
//
// Run during `bun test` (see tests/regressions.test.ts) and CI.

import { join } from "node:path";

export interface VersionFiles {
  "package.json": string;
  "plugin/.claude-plugin/plugin.json": string;
  "plugin/bin/.ccthread-version": string;
}

const REPO_ROOT = new URL("..", import.meta.url).pathname;

export async function readVersions(root = REPO_ROOT): Promise<VersionFiles> {
  const pkg = await Bun.file(join(root, "package.json")).json();
  const plugin = await Bun.file(join(root, "plugin", ".claude-plugin", "plugin.json")).json();
  const pinned = (await Bun.file(join(root, "plugin", "bin", ".ccthread-version")).text()).trim();
  return {
    "package.json": pkg.version,
    "plugin/.claude-plugin/plugin.json": plugin.version,
    "plugin/bin/.ccthread-version": pinned,
  };
}

export function findMismatches(versions: VersionFiles): string | null {
  const entries = Object.entries(versions);
  const [first, ...rest] = entries;
  if (!first) return "no version files read";
  for (const [path, v] of rest) {
    if (v !== first[1]) {
      return (
        `version mismatch:\n`
        + entries.map(([p, vv]) => `  ${p}: ${vv}`).join("\n")
      );
    }
  }
  return null;
}

if (import.meta.main) {
  const versions = await readVersions();
  const err = findMismatches(versions);
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`ccthread version: ${versions["package.json"]} (3 files in sync)`);
}
