import type { MarketplaceSkill } from "../marketplace-types";
import { readCache, writeCache } from "./cache";
import { fetchTimeoutSignal } from "./fetch-signal";

const UA =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";
const DEFAULT_MARKETPLACE_GATEWAY_URL = "https://skiller-marketplace-proxy.vercel.app";

function marketplaceGatewayUrl(path: string): string {
	const configured = process.env.SKILLER_MARKETPLACE_PROXY_URL?.trim() || DEFAULT_MARKETPLACE_GATEWAY_URL;
	try {
		const base = new URL(configured);
		if (base.protocol !== "https:" && !(base.protocol === "http:" && base.hostname === "localhost")) {
			throw new Error("Marketplace gateway must use HTTPS");
		}
		return new URL(path, `${base.toString().replace(/\/$/, "")}/`).toString();
	} catch {
		throw new Error("Marketplace gateway URL is invalid");
	}
}

/** Official skills.sh API response, retrieved exclusively through Skiller's gateway. */
function parseSkillsApiResponse(jsonStr: string): MarketplaceSkill[] {
	type ApiSkill = {
		source?: string;
		slug?: string;
		name?: string;
		installs?: number;
		installUrl?: string | null;
		description?: string | null;
		id?: string;
		url?: string | null;
	};
	let parsed: { data?: ApiSkill[] };
	try {
		parsed = JSON.parse(jsonStr) as { data?: ApiSkill[] };
	} catch {
		return [];
	}
	return (parsed.data ?? []).flatMap((skill) => {
		if (!skill.source || !skill.slug) return [];
		const owner = skill.source.split("/", 1)[0] ?? skill.source;
		return [{
			name: skill.name ?? skill.slug,
			description: skill.description ?? null,
			author: owner,
			repository: skill.installUrl ?? (skill.source.includes("/") ? `https://github.com/${skill.source}` : null),
			catalog_id: skill.id ?? `${skill.source}/${skill.slug}`,
			url: skill.url ?? `https://www.skills.sh/${skill.source}/${skill.slug}`,
			skill_path: `skills/${skill.slug}`,
			installs: skill.installs ?? null,
			source: "skills.sh" as const,
		}];
	});
}

async function fetchGatewaySkills(
	path: string,
	cacheKey: string,
	failureMessage: string,
): Promise<MarketplaceSkill[]> {
	const fresh = readCache(cacheKey);
	if (fresh?.length) return fresh;

	try {
		const response = await fetch(marketplaceGatewayUrl(path), {
			headers: { Accept: "application/json", "User-Agent": UA },
			signal: fetchTimeoutSignal(60_000),
		});
		if (!response.ok) throw new Error("Marketplace gateway request failed");
		const skills = parseSkillsApiResponse(await response.text());
		if (skills.length === 0) throw new Error("Marketplace gateway returned no readable skills");
		writeCache(cacheKey, skills, 5 * 60);
		return skills;
	} catch {
		throw new Error(failureMessage);
	}
}

export async function fetchSkillssh(sort: string, page: number): Promise<MarketplaceSkill[]> {
	return fetchGatewaySkills(
		`api/v1/leaderboard?sort=${encodeURIComponent(sort)}&page=${page}`,
		`skills.sh:${sort}:${page}`,
		"Failed to fetch skills.sh leaderboard through the marketplace gateway",
	);
}

export async function searchSkillssh(query: string): Promise<MarketplaceSkill[]> {
	return fetchGatewaySkills(
		`api/v1/search?q=${encodeURIComponent(query)}`,
		`skills.sh:search:${query}`,
		"Failed to search skills.sh through the marketplace gateway",
	);
}
