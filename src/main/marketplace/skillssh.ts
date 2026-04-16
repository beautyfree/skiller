import type { MarketplaceSkill } from "../marketplace-types";
import { readCache, readCacheStale, writeCache } from "./cache";
import { fetchTimeoutSignal } from "./fetch-signal";

const UA =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

const RSC_PATTERN =
	/\{[^}]*"skillId"\s*:\s*"[^"]+"[^}]*"installs"\s*:\s*\d+[^}]*\}/g;

function parseSearchResponse(jsonStr: string): MarketplaceSkill[] {
	type SearchSkill = {
		source?: string;
		skillId?: string;
		name?: string;
		installs?: number;
	};
	type SearchResponse = { skills?: SearchSkill[] };
	let parsed: SearchResponse;
	try {
		parsed = JSON.parse(jsonStr) as SearchResponse;
	} catch {
		return [];
	}
	const skills = parsed.skills ?? [];
	const out: MarketplaceSkill[] = [];
	for (const s of skills) {
		const sourcePath = s.source;
		const skillId = s.skillId;
		if (!sourcePath || !skillId) continue;
		const parts = sourcePath.split("/", 2);
		const owner = parts.length === 2 ? parts[0] : sourcePath;
		out.push({
			name: s.name ?? skillId,
			description: null,
			author: owner,
			repository: `https://github.com/${sourcePath}`,
			installs: s.installs ?? null,
			source: "skills.sh",
		});
	}
	return out;
}

/** Next.js RSC embeds the full leaderboard as `initialSkills` JSON — one parse vs hundreds of regex walks. */
function tryParseInitialSkillsFromRsc(html: string): MarketplaceSkill[] | null {
	const startMarker = 'initialSkills\\\":[';
	const endMarker = '}],\\\"totalSkills';
	const s = html.indexOf(startMarker);
	if (s < 0) return null;
	const arrStart = s + startMarker.length - 1;
	if (html[arrStart] !== "[") return null;
	const e = html.indexOf(endMarker, arrStart);
	if (e < 0) return null;
	const raw = html.slice(arrStart, e + 2);
	try {
		const jsonText = raw.replace(/\\"/g, '"');
		const rows = JSON.parse(jsonText) as Array<{
			source?: string;
			skillId?: string;
			name?: string;
			installs?: number;
		}>;
		const out: MarketplaceSkill[] = [];
		for (const r of rows) {
			const sourcePath = r.source;
			const skillId = r.skillId;
			if (!sourcePath || !skillId) continue;
			const parts = sourcePath.split("/", 2);
			const owner = parts.length === 2 ? parts[0] : sourcePath;
			out.push({
				name: r.name ?? skillId,
				description: null,
				author: owner,
				repository: `https://github.com/${sourcePath}`,
				installs: r.installs ?? null,
				source: "skills.sh",
			});
		}
		return out.length ? out : null;
	} catch {
		return null;
	}
}

function tryDecodeRscSkill(jsonStr: string): MarketplaceSkill | null {
	type RscSkill = {
		source: string;
		skillId: string;
		name?: string;
		installs?: number;
	};
	let rsc: RscSkill;
	try {
		rsc = JSON.parse(jsonStr) as RscSkill;
	} catch {
		return null;
	}
	if (!rsc.source || !rsc.skillId) return null;
	const parts = rsc.source.split("/", 2);
	const owner = parts.length === 2 ? parts[0] : rsc.source;
	return {
		name: rsc.name ?? rsc.skillId,
		description: null,
		author: owner,
		repository: `https://github.com/${rsc.source}`,
		installs: rsc.installs ?? null,
		source: "skills.sh",
	};
}

export function parseLeaderboardHtml(html: string): MarketplaceSkill[] {
	const fromRsc = tryParseInitialSkillsFromRsc(html);
	if (fromRsc?.length) return fromRsc;

	const skills: MarketplaceSkill[] = [];
	const seen = new Set<string>();

	for (const m of html.matchAll(RSC_PATTERN)) {
		const skill = tryDecodeRscSkill(m[0]);
		if (skill && !seen.has(skill.name)) {
			seen.add(skill.name);
			skills.push(skill);
		}
	}

	if (skills.length === 0) {
		const escapedPattern =
			/\{(?:[^{}]|\\[{}])*\\?"skillId\\?"\s*:\\?\s*\\?"[^"\\]+\\?"[^}]*\}/g;
		for (const m of html.matchAll(escapedPattern)) {
			const unescaped = m[0]
				.replace(/\\"/g, '"')
				.replace(/\\\//g, "/")
				.replace(/\\\\/g, "\\");
			const skill = tryDecodeRscSkill(unescaped);
			if (skill && !seen.has(skill.name)) {
				seen.add(skill.name);
				skills.push(skill);
			}
		}
	}

	return skills;
}

export async function fetchSkillssh(
	sort: string,
	page: number,
): Promise<MarketplaceSkill[]> {
	const cacheKey = `skills.sh:${sort}:${page}`;
	const fresh = readCache(cacheKey);
	if (fresh?.length) return fresh;

	const url =
		sort === "trending"
			? `https://skills.sh/trending?page=${page}`
			: sort === "hot"
				? `https://skills.sh/hot?page=${page}`
				: `https://skills.sh/?page=${page}`;

	try {
		const res = await fetch(url, {
			headers: { "User-Agent": UA },
			signal: fetchTimeoutSignal(60_000),
		});
		const html = await res.text();
		const skills = parseLeaderboardHtml(html);
		writeCache(cacheKey, skills, 5 * 60);
		return skills;
	} catch {
		const stale = readCacheStale(cacheKey);
		if (stale?.length) return stale;
		throw new Error("Failed to fetch skills.sh leaderboard");
	}
}

export async function searchSkillssh(query: string): Promise<MarketplaceSkill[]> {
	const cacheKey = `skills.sh:search:${query}`;
	const fresh = readCache(cacheKey);
	if (fresh?.length) return fresh;

	const q = encodeURIComponent(query);
	const url = `https://skills.sh/api/search?q=${q}&limit=50`;

	try {
		const res = await fetch(url, {
			headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" },
			signal: fetchTimeoutSignal(60_000),
		});
		const text = await res.text();
		const skills = parseSearchResponse(text);
		writeCache(cacheKey, skills, 5 * 60);
		return skills;
	} catch {
		const stale = readCacheStale(cacheKey);
		if (stale?.length) return stale;
		throw new Error("Failed to search skills.sh");
	}
}
