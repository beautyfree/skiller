import { readFileSync, statSync } from "node:fs";
import { parse as parseYaml } from "yaml";

export type ParsedSkillMd = {
	name?: string;
	description?: string;
	metadata?: unknown;
	body: string;
};

type ParsedSkillCacheEntry = {
	mtimeMs: number;
	size: number;
	parsed: ParsedSkillMd;
};

const parsedSkillCache = new Map<string, ParsedSkillCacheEntry>();

function splitFrontmatter(content: string): { fm: Record<string, unknown>; body: string } {
	const trimmed = content.trim();
	if (!trimmed) return { fm: {}, body: "" };
	const lines = content.split(/\r?\n/);
	if (lines[0]?.trim() !== "---") {
		return { fm: {}, body: content };
	}
	const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
	if (end === -1) return { fm: {}, body: content };
	const yamlBlock = lines.slice(1, end).join("\n");
	const body = lines.slice(end + 1).join("\n");
	try {
		const fm = (parseYaml(yamlBlock) as Record<string, unknown>) ?? {};
		return { fm, body };
	} catch {
		return { fm: {}, body: content };
	}
}

export function parseSkillMdFile(path: string): ParsedSkillMd {
	let out: ParsedSkillMd;
	try {
		const st = statSync(path);
		const cached = parsedSkillCache.get(path);
		if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) {
			return cached.parsed;
		}
		const content = readFileSync(path, "utf-8");
		out = parseSkillMdContent(content);
		parsedSkillCache.set(path, {
			mtimeMs: st.mtimeMs,
			size: st.size,
			parsed: out,
		});
	} catch {
		const content = readFileSync(path, "utf-8");
		out = parseSkillMdContent(content);
	}
	return out;
}

export function parseSkillMdContent(content: string): ParsedSkillMd {
	const { fm, body } = splitFrontmatter(content);
	return {
		name: typeof fm.name === "string" ? fm.name : undefined,
		description: typeof fm.description === "string" ? fm.description : undefined,
		metadata: fm.metadata,
		body,
	};
}
