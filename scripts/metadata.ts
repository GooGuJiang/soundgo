// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 SoundGo contributors

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("../", import.meta.url));
export const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export const pluginFiles = [
  "LICENSE",
  "README.md",
  "index.js",
  "locales/en.json",
  "locales/zh-CN.json",
  "plugin.json",
] as const;

export interface NavItem {
  title?: string;
  page?: string;
  builtin?: string;
  icon?: string;
}

export interface Manifest {
  id: string;
  name: string;
  version: string;
  minAppVersion: string;
  main: string;
  playback: string;
  permissions: {
    network: string[];
    process?: string[];
  };
  navigation?: NavItem[];
}

export interface PackageJson {
  name: string;
  version: string;
}

export function validateVersion(value: unknown): asserts value is string {
  if (typeof value !== "string" || !versionPattern.test(value)) {
    throw new Error(`Expected a stable three-part version, got ${String(value)}`);
  }
}

export function validateMetadata(pkg: PackageJson, manifest: Manifest) {
  validateVersion(pkg.version);
  validateVersion(manifest.minAppVersion);
  if (manifest.version !== pkg.version) {
    throw new Error("package.json and plugin.json versions must match");
  }
  if (manifest.main !== "index.js") {
    throw new Error("The plugin entry must be index.js");
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(pkg.name)) {
    throw new Error("Unsafe package name");
  }
  return { pkg, manifest };
}

export async function readMetadata(directory = root) {
  const [pkg, manifest] = await Promise.all(
    ["package.json", "plugin.json"].map(
      async (file) =>
        JSON.parse(await readFile(resolve(directory, file), "utf8")) as unknown,
    ),
  );
  return validateMetadata(pkg as PackageJson, manifest as Manifest);
}
