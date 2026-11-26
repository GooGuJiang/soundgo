// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 SoundGo contributors

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readMetadata, root, validateVersion } from "./metadata.ts";

export async function setVersion(version: string, directory = root) {
  validateVersion(version);
  const { pkg } = await readMetadata(directory);
  const previous = pkg.version.split(".").map(BigInt);
  const next = version.split(".").map(BigInt);
  const difference = next
    .map((part, i) => part - previous[i])
    .find((part) => part !== 0n);
  if (difference === undefined || difference < 0n) {
    throw new Error("Version must increase");
  }

  const jsonPaths = ["package.json", "plugin.json"].map((name) =>
    resolve(directory, name),
  );
  const constantsPath = resolve(directory, "src/constants.ts");
  const originals = await Promise.all([
    ...jsonPaths.map((p) => readFile(p, "utf8")),
    readFile(constantsPath, "utf8"),
  ]);

  try {
    for (const [i, path] of jsonPaths.entries()) {
      const doc = JSON.parse(originals[i]) as { version: string };
      doc.version = version;
      await writeFile(path, JSON.stringify(doc, null, 2) + "\n");
    }
    const updatedConstants = originals[2].replace(
      /export const PLUGIN_VERSION = "[^"]+";/,
      `export const PLUGIN_VERSION = "${version}";`,
    );
    await writeFile(constantsPath, updatedConstants);
  } catch (error) {
    await Promise.all([
      ...jsonPaths.map((p, i) => writeFile(p, originals[i])),
      writeFile(constantsPath, originals[2]),
    ]);
    throw error;
  }

  console.log(
    `Version set to ${version}; review and commit package.json, plugin.json, and src/constants.ts.`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await setVersion(process.argv[2]);
}
