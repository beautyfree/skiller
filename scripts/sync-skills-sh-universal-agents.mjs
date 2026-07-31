#!/usr/bin/env node

/**
 * Synchronizes the vendored universal-agent snapshot with Skills CLI.
 *
 * Usage:
 *   node scripts/sync-skills-sh-universal-agents.mjs --check
 *   node scripts/sync-skills-sh-universal-agents.mjs --refresh --ref <commit>
 *
 * `--check` is network-free and is suitable for CI. `--refresh` intentionally
 * requires an explicit immutable ref, so an upstream branch change cannot
 * silently change Skiller's supported-agent contract.
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = join(root, "agents", "skills-sh-universal.json");

export function extractUniversalAgents(source) {
  // Match complete top-level entries, rather than searching across the next
  // entry. `detectInstalled` bodies also contain `},`, so the next top-level
  // key (or the end of the object) is the reliable delimiter.
  const entries = [...source.matchAll(
    /^  (?:'([^']+)'|([a-z][\w-]*)):\s*\{([\s\S]*?)(?=^  (?:'[^']+'|[a-z][\w-]*):\s*\{|^};)/gm,
  )];
  return entries
    .filter((entry) => /skillsDir:\s*['"]\.agents\/skills['"]/.test(entry[3]))
    .map((entry) => entry[1] ?? entry[2])
    .filter(Boolean)
    .sort();
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (args.has("--check")) {
    if (!Array.isArray(manifest.agents) || manifest.agents.length === 0) {
      throw new Error("skills-sh universal-agent snapshot is empty");
    }
    console.log(`Skills CLI universal snapshot: ${manifest.agents.length} agents at ${manifest.upstream.commit}`);
    return;
  }
  if (!args.has("--refresh")) {
    throw new Error("use --check or --refresh --ref <immutable Skills CLI commit>");
  }
  const refIndex = process.argv.indexOf("--ref");
  const ref = refIndex >= 0 ? process.argv[refIndex + 1] : undefined;
  if (!ref || !/^[0-9a-f]{7,64}$/i.test(ref)) {
    throw new Error("--refresh requires an immutable git commit SHA");
  }
  const url = `https://raw.githubusercontent.com/vercel-labs/skills/${ref}/src/agents.ts`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`failed to fetch ${url}: ${response.status}`);
  const agents = extractUniversalAgents(await response.text());
  if (agents.length === 0) throw new Error("could not parse any .agents/skills agents from Skills CLI");
  manifest.upstream.commit = ref;
  const pseudoAgents = new Set(manifest.pseudoAgents ?? []);
  manifest.agents = agents;
  manifest.pseudoAgents = [...pseudoAgents].filter((name) => agents.includes(name)).sort();
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Updated ${manifestPath} with ${agents.length} Skills CLI universal agents.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
