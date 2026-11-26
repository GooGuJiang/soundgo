// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 SoundGo contributors

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  buildPlugin,
  findExportNames,
  stripComments,
  verifyLocales,
} from "../../scripts/build.ts";
import { pluginFiles, readMetadata, root } from "../../scripts/metadata.ts";
import { PLUGIN_VERSION } from "../../src/constants.ts";

describe("Build and metadata tooling", () => {
  test("package.json, plugin.json, and src/constants.ts versions stay in sync", async () => {
    const { pkg, manifest } = await readMetadata();
    expect(manifest.version).toBe(pkg.version);
    expect(PLUGIN_VERSION).toBe(pkg.version);
    expect(manifest.main).toBe("index.js");
  });

  test("buildPlugin outputs a self-contained ESM bundle matching the export contract and locales", async () => {
    const dir = await buildPlugin();
    const bundle = await readFile(resolve(dir, "index.js"), "utf8");
    const expected: string[] = JSON.parse(
      await readFile(resolve(root, "tests/fixtures/exports.json"), "utf8"),
    );

    expect(findExportNames(bundle)).toEqual(expected);
    expect(/^\s*import\s/m.test(bundle)).toBe(false);

    const codeOnly = stripComments(bundle);
    for (const banned of ["atob", "btoa", "unescape", "Buffer", "process", "require"]) {
      expect(new RegExp(`\\b${banned}\\b`).test(codeOnly)).toBe(false);
    }

    const { manifest } = await readMetadata();
    await verifyLocales(bundle, manifest);

    for (const file of pluginFiles) {
      const content = await readFile(resolve(dir, file));
      expect(content.byteLength).toBeGreaterThan(0);
    }
  });
});
