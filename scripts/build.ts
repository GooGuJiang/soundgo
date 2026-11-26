// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 SoundGo contributors

import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { pluginFiles, readMetadata, root, type Manifest } from "./metadata.ts";

const BANNED_GLOBALS = ["atob", "btoa", "unescape", "Buffer", "process", "require"] as const;

export function findExportNames(code: string): string[] {
  const names = new Set<string>();
  const blockRe = /export\s*\{([^}]+)\}/g;
  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(code)) !== null) {
    for (const part of match[1].split(",")) {
      const cleaned = part.trim();
      if (!cleaned) continue;
      const asMatch = cleaned.match(/\bas\s+([A-Za-z_$][\w$]*)$/);
      names.add(asMatch ? asMatch[1] : cleaned);
    }
  }
  const declRe = /export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g;
  while ((match = declRe.exec(code)) !== null) {
    names.add(match[1]);
  }
  return [...names].sort();
}

export function stripComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\r\n]*/g, "");
}

export async function verifyLocales(code: string, manifest: Manifest, directory = root) {
  const [en, zh] = await Promise.all([
    readFile(resolve(directory, "locales/en.json"), "utf8").then(
      (s) => JSON.parse(s) as Record<string, string>,
    ),
    readFile(resolve(directory, "locales/zh-CN.json"), "utf8").then(
      (s) => JSON.parse(s) as Record<string, string>,
    ),
  ]);

  const keys = new Set<string>();
  for (const match of code.matchAll(/\bt\(\s*"([^"]+)"\s*\)/g)) {
    keys.add(match[1]);
  }
  for (const nav of manifest.navigation || []) {
    if (nav.title) keys.add(nav.title);
  }

  const missingEn = [...keys].filter((key) => !(key in en));
  const missingZh = [...keys].filter((key) => !(key in zh));
  if (missingEn.length || missingZh.length) {
    throw new Error(
      `Missing locale keys — en: [${missingEn.join(", ")}], zh-CN: [${missingZh.join(", ")}]`,
    );
  }
}

export async function buildPlugin() {
  const { manifest } = await readMetadata();
  const directory = resolve(root, "dist/plugin");
  await rm(directory, { recursive: true, force: true });
  await mkdir(resolve(directory, "locales"), { recursive: true });

  const result = await Bun.build({
    entrypoints: [resolve(root, "src/index.ts")],
    outdir: directory,
    naming: "index.js",
    format: "esm",
    target: "browser",
    minify: false,
    splitting: false,
    sourcemap: "none",
    banner:
      "// SPDX-License-Identifier: AGPL-3.0-only\n// Copyright (C) 2026 SoundGo contributors\n",
  });

  if (!result.success) {
    const messages = result.logs.map((log) => log.message).join("\n");
    throw new Error(`Bundle build failed:\n${messages}`);
  }
  if (result.outputs.length !== 1) {
    throw new Error("The plugin must build into a single JavaScript module");
  }

  const bundlePath = resolve(directory, "index.js");
  const code = await readFile(bundlePath, "utf8");

  if (/^\s*import\s/m.test(code)) {
    throw new Error("The plugin bundle must be self-contained with zero imports");
  }

  const expected: string[] = JSON.parse(
    await readFile(resolve(root, "tests/fixtures/exports.json"), "utf8"),
  );
  const actual = findExportNames(code);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Plugin exports differ from contract.\nExpected: ${JSON.stringify(expected)}\nActual:   ${JSON.stringify(actual)}`,
    );
  }

  const codeOnly = stripComments(code);
  const foundBanned = BANNED_GLOBALS.filter((name) =>
    new RegExp(`\\b${name}\\b`).test(codeOnly),
  );
  if (foundBanned.length) {
    throw new Error(
      `Bundle references runtime globals unavailable in moejs: ${foundBanned.join(", ")}`,
    );
  }

  await verifyLocales(code, manifest);

  for (const file of pluginFiles) {
    if (file !== manifest.main) {
      await copyFile(resolve(root, file), resolve(directory, file));
    }
  }

  return directory;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const out = await buildPlugin();
  console.log(`Built SoundGo plugin into ${out}`);
}
