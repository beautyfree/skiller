#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseChangelog } from "../src/shared/release-notes.ts";

const desktopRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = join(desktopRoot, "..", "..");
const changelogPath = join(repositoryRoot, "CHANGELOG.md");
const outputPath = join(desktopRoot, "src", "mainview", "release-notes.generated.json");

const changelog = await readFile(changelogPath, "utf8");
const notes = parseChangelog(changelog);
if (notes.length === 0) throw new Error("CHANGELOG.md does not contain any version headings");
await writeFile(outputPath, `${JSON.stringify(notes, null, 2)}\n`);
console.log(`Generated ${notes.length} release-note entries from CHANGELOG.md.`);
