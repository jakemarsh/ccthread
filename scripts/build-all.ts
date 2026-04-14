#!/usr/bin/env bun
// Build ccthread for every target we publish.
//
// Bun can cross-compile freely between POSIX targets but Windows PE metadata
// only embeds when building on Windows. In CI we split the matrix across 3
// runners; locally this script builds every target from the host machine so
// devs can smoke-test on Mac (the resulting Windows binary works but lacks
// the Windows metadata).

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

for (const target of TARGETS) {
  const outDir = join(DIST, `ccthread-${VERSION}-${target}`);
  mkdirSync(outDir, { recursive: true });
  const exe = target.startsWith("bun-windows") ? "ccthread.exe" : "ccthread";
  const outfile = join(outDir, exe);

  console.log(`→ ${target}`);
  await $`bun build src/cli.ts --compile --minify --target=${target} --define CCTHREAD_VERSION='"${VERSION}"' --outfile ${outfile}`;

  const hash = await $`shasum -a 256 ${outfile}`.text();
  await Bun.write(outfile + ".sha256", hash.split(" ")[0] + "\n");
}

console.log(`\nBuilt ${TARGETS.length} binaries in ${DIST}/`);
