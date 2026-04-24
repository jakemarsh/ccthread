#!/usr/bin/env bun
// Bump ccthread's version in all three places at once.
//
//   bun run scripts/bump.ts 0.2.0
//
// Also updates the hardcoded CCTHREAD_VERSION define in package.json's
// "build" script so `bun run build` keeps producing a correctly-tagged
// binary without a separate edit.

import { join } from "node:path";

const REPO_ROOT = new URL("..", import.meta.url).pathname;

const next = process.argv[2];
if (!next || !/^\d+\.\d+\.\d+(-[A-Za-z0-9.]+)?$/.test(next)) {
  console.error("usage: bun run scripts/bump.ts <semver>\n  example: bun run scripts/bump.ts 0.2.0");
  process.exit(2);
}

const pkgPath = join(REPO_ROOT, "package.json");
const pkg = await Bun.file(pkgPath).json();
const prev = pkg.version;
pkg.version = next;
if (typeof pkg.scripts?.build === "string") {
  pkg.scripts.build = pkg.scripts.build.replace(
    /CCTHREAD_VERSION='"[^"]*"'/,
    `CCTHREAD_VERSION='"${next}"'`
  );
}
await Bun.write(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

const pluginPath = join(REPO_ROOT, "plugin", ".claude-plugin", "plugin.json");
const plugin = await Bun.file(pluginPath).json();
plugin.version = next;
await Bun.write(pluginPath, JSON.stringify(plugin, null, 2) + "\n");

const pinnedPath = join(REPO_ROOT, "plugin", "bin", ".ccthread-version");
await Bun.write(pinnedPath, next + "\n");

console.log(`bumped ${prev} → ${next} in package.json, plugin.json, .ccthread-version`);
