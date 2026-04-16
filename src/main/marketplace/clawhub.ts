import type { MarketplaceSkill } from "../marketplace-types";
import { readCache, readCacheStale, writeCache } from "./cache";
import { fetchTimeoutSignal } from "./fetch-signal";

const BASE_URL = "https://clawhub.ai/api/v1";

type SkillDTO = {
	slug: string;
	displayName?: string;
	summary?: string;
	stats?: { downloads?: number; stars?: number };
};

type SkillListResponse = { items?: SkillDTO[] };

type SearchResultDTO = {
	slug: string;
	displayName?: string;
	summary?: string;
};

type SearchResponse = { results?: SearchResultDTO[] };

function parseSkillsResponse(jsonStr: string): MarketplaceSkill[] {
	try {
		const resp = JSON.parse(jsonStr) as SkillListResponse;
		if (resp.items?.length) {
			return resp.items.map((dto) => ({
				name: dto.displayName ?? dto.slug,
				description: dto.summary ?? null,
				author: null,
				repository: `https://clawhub.ai/skills/${dto.slug}`,
				installs: dto.stats?.downloads ?? null,
				source: "clawhub",
			}));
		}
	} catch {
		/* fallback */
	}
	return parseClawhubJsonFallback(jsonStr);
}

function parseSearchResponse(jsonStr: string): MarketplaceSkill[] {
	try {
		const resp = JSON.parse(jsonStr) as SearchResponse;
		return (resp.results ?? []).map((dto) => ({
			name: dto.displayName ?? dto.slug,
			description: dto.summary ?? null,
			author: null,
			repository: `https://clawhub.ai/skills/${dto.slug}`,
			installs: null,
			source: "clawhub",
		}));
	} catch {
		return [];
	}
}

function parseClawhubJsonFallback(payload: string): MarketplaceSkill[] {
	let json: unknown;
	try {
		json = JSON.parse(payload);
	} catch {
		return [];
	}
	const list = Array.isArray(json)
		? json
		: typeof json === "object" &&
				json !== null &&
				"data" in json &&
				Array.isArray((json as { data: unknown }).data)
			? (json as { data: unknown[] }).data
			: [];

	return list.map((item) => {
		const o = item as Record<string, unknown>;
		const name =
			(typeof o.name === "string" && o.name) ||
			(typeof o.displayName === "string" && o.displayName) ||
			"unknown";
		return {
			name,
			description:
				typeof o.summary === "string" ? o.summary : null,
			author: typeof o.author === "string" ? o.author : null,
			repository:
				(typeof o.repository === "string" && o.repository) ||
				(typeof o.repo === "string" && o.repo) ||
				null,
			installs:
				(typeof o.downloads === "number" && o.downloads) ||
				(typeof o.installs === "number" && o.installs) ||
				null,
			source: "clawhub",
		};
	});
}

export async function fetchClawhub(
	endpoint: string,
	paramsMap: Record<string, string>,
): Promise<MarketplaceSkill[]> {
	const sortedKeys = Object.keys(paramsMap).sort();
	const paramsStr = sortedKeys.map((k) => `${k}=${paramsMap[k]}`).join("&");
	const cacheKey = `clawhub:${endpoint}:${paramsStr}`;
	const fresh = readCache(cacheKey);
	// Do not treat cached empty arrays as hits (older builds cached failed /skills responses).
	if (fresh?.length) return fresh;

	const url = `${BASE_URL}/skills`;
	const query = new URLSearchParams();

	switch (endpoint) {
		case "downloads":
		case "top-downloads":
			query.set("sort", "downloads");
			query.set("dir", "desc");
			break;
		case "stars":
			query.set("sort", "stars");
			query.set("dir", "desc");
			break;
		default:
			break;
	}

	const limit = paramsMap.limit ?? "50";
	query.set("limit", limit);
	for (const [k, v] of Object.entries(paramsMap)) {
		if (k !== "limit") query.set(k, v);
	}

	const qs = query.toString();
	const fullUrl = qs ? `${url}?${qs}` : url;

	try {
		const res = await fetch(fullUrl, {
			headers: { Accept: "application/json", "User-Agent": "SkillsApp" },
			signal: fetchTimeoutSignal(60_000),
		});
		const text = await res.text();
		let skills = parseSkillsResponse(text);
		// ClawHub often returns `{ "items": [], "nextCursor": null }` for GET /skills
		// (browse listing disabled or changed). Fall back to search so the UI is usable.
		if (skills.length === 0) {
			skills = await clawhubBrowseWhenListEmpty(endpoint);
		}
		writeCache(cacheKey, skills, 5 * 60);
		return skills;
	} catch {
		const stale = readCacheStale(cacheKey);
		if (stale?.length) return stale;
		throw new Error("Failed to fetch ClawHub skills");
	}
}

/** Search HTTP only (no read-through cache) — used as browse fallback when /skills is empty. */
async function fetchClawhubSearchDirect(
	query: string,
	limit = 50,
): Promise<MarketplaceSkill[]> {
	const url = `${BASE_URL}/search?q=${encodeURIComponent(query)}&limit=${limit}`;
	const res = await fetch(url, {
		headers: { Accept: "application/json", "User-Agent": "SkillsApp" },
		signal: fetchTimeoutSignal(60_000),
	});
	const text = await res.text();
	return parseSearchResponse(text);
}

function clawhubSlugFromRepository(repository: string | null | undefined): string | null {
	if (!repository) return null;
	const m = repository.match(/clawhub\.ai\/skills\/([^/?#]+)/i);
	return m?.[1] ?? null;
}

async function fetchClawhubSkillStats(
	slug: string,
): Promise<{ downloads: number; stars: number } | null> {
	try {
		const res = await fetch(`${BASE_URL}/skills/${encodeURIComponent(slug)}`, {
			headers: { Accept: "application/json", "User-Agent": "SkillsApp" },
			signal: fetchTimeoutSignal(20_000),
		});
		const text = await res.text();
		const json = JSON.parse(text) as {
			skill?: { stats?: { downloads?: number; stars?: number } };
		};
		const s = json.skill?.stats;
		if (!s) return null;
		return {
			downloads: typeof s.downloads === "number" ? s.downloads : 0,
			stars: typeof s.stars === "number" ? s.stars : 0,
		};
	} catch {
		return null;
	}
}

/** Enrich search-only results with per-skill stats and sort (browse /skills is often empty). */
async function enrichClawhubSkillsForSort(
	skills: MarketplaceSkill[],
	sort: "downloads" | "stars",
): Promise<MarketplaceSkill[]> {
	const withSlug = skills
		.map((skill) => ({
			skill,
			slug: clawhubSlugFromRepository(skill.repository),
		}))
		.filter((x): x is { skill: MarketplaceSkill; slug: string } => Boolean(x.slug));

	const concurrency = 10;
	const statsList: ({ skill: MarketplaceSkill; slug: string } & {
		downloads: number;
		stars: number;
	})[] = [];
	for (let i = 0; i < withSlug.length; i += concurrency) {
		const chunk = withSlug.slice(i, i + concurrency);
		const part = await Promise.all(
			chunk.map(async ({ skill, slug }) => {
				const st = await fetchClawhubSkillStats(slug);
				return {
					skill,
					slug,
					downloads: st?.downloads ?? 0,
					stars: st?.stars ?? 0,
				};
			}),
		);
		statsList.push(...part);
	}

	statsList.sort((a, b) =>
		sort === "downloads"
			? b.downloads - a.downloads
			: b.stars - a.stars,
	);

	return statsList.map(({ skill, downloads }) => ({
		...skill,
		// Surface download counts in the list; stars only affect order here.
		installs: sort === "downloads" ? downloads : skill.installs ?? null,
	}));
}

/**
 * When GET /skills returns no items, search is the only browse API. The same search query
 * was used for every sort mode, so Downloads/Stars looked broken — we fetch details and sort.
 */
async function clawhubBrowseWhenListEmpty(
	endpoint: string,
): Promise<MarketplaceSkill[]> {
	const base = await fetchClawhubSearchDirect("skill", 50);
	if (base.length === 0) {
		const wider = await fetchClawhubSearchDirect("agent", 50);
		if (wider.length === 0) return [];
		return enrichOrPassthrough(wider, endpoint);
	}
	return enrichOrPassthrough(base, endpoint);
}

async function enrichOrPassthrough(
	skills: MarketplaceSkill[],
	endpoint: string,
): Promise<MarketplaceSkill[]> {
	switch (endpoint) {
		case "downloads":
		case "top-downloads":
			return enrichClawhubSkillsForSort(skills, "downloads");
		case "stars":
			return enrichClawhubSkillsForSort(skills, "stars");
		default:
			return skills;
	}
}

export async function searchClawhub(query: string): Promise<MarketplaceSkill[]> {
	const cacheKey = `clawhub:search:${query}`;
	const fresh = readCache(cacheKey);
	// Same as browse: do not short-circuit on cached empty arrays from buggy runs.
	if (fresh?.length) return fresh;

	const url = `${BASE_URL}/search?q=${encodeURIComponent(query)}&limit=50`;

	try {
		const res = await fetch(url, {
			headers: { Accept: "application/json", "User-Agent": "SkillsApp" },
			signal: fetchTimeoutSignal(60_000),
		});
		const text = await res.text();
		const skills = parseSearchResponse(text);
		writeCache(cacheKey, skills, 5 * 60);
		return skills;
	} catch {
		const stale = readCacheStale(cacheKey);
		if (stale?.length) return stale;
		throw new Error("Failed to search ClawHub");
	}
}
