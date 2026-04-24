#!/usr/bin/env bun
// Build ccthread for every target we publish.
//
// Bun can cross-compile freely between POSIX targets but Windows PE metadata
// only embeds when building on Windows. In CI we split the matrix across 3
// runners; locally this script builds every target from the host machine so
// devs can smoke-test on Mac (the resulting Windows binary works but lacks
// the Windows metadata).
//
// Output layout matches the release workflow so install.sh and the plugin
// dispatcher can be exercised locally against dist/ccthread-v<V>-<target>.tar.gz.

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { $ } from "bun";

const VERSION = (await Bun.file("package.json").json()).version as string;

const TARGETS = [
  "bun-darwin-arm64",
  "bun-darwin-x64-baseline",
  "bun-linux-x64-baseline",
  "bun-linux-arm64",
  "bun-windows-x64-baseline",
  "bun-windows-arm64",
];

const DIST = "dist";
mkdirSync(DIST, { recursive: true });

async function sha256(path: string): Promise<string> {
  const bytes = await Bun.file(path).bytes();
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(bytes);
  return hasher.digest("hex");
}

for (const target of TARGETS) {
  const innerDir = `ccthread-${VERSION}-${target}`;
  const outDir = join(DIST, innerDir);
  mkdirSync(outDir, { recursive: true });
  const exe = target.startsWith("bun-windows") ? "ccthread.exe" : "ccthread";
  const outfile = join(outDir, exe);

  console.log(`→ ${target}`);
  await $`bun build src/cli.ts --compile --minify --target=${target} --define CCTHREAD_VERSION='"${VERSION}"' --outfile ${outfile}`;

  // Also tar + sha the archive the way the release workflow does, so
  // install.sh / the plugin dispatcher can be tested against a local
  // dist/ layout.
  const tgz = `ccthread-v${VERSION}-${target}.tar.gz`;
  await $`tar -czf ${tgz} ${innerDir}`.cwd(DIST);
  const tgzHash = await sha256(join(DIST, tgz));
  await Bun.write(join(DIST, tgz + ".sha256"), tgzHash + "\n");
}

console.log(`\nBuilt ${TARGETS.length} targets + tarballs in ${DIST}/`);
