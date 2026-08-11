import { readFileSync, statSync } from "node:fs";
import { parse as parseYaml } from "yaml";

function parseFrontmatterBool(v: unknown): boolean | undefined {
	if (v === true) return true;
	if (v === false) return false;
	if (typeof v === "string") {
		const s = v.trim().toLowerCase();
		if (s === "true" || s === "1" || s === "yes") return true;
		if (s === "false" || s === "0" || s === "no") return false;
	}
	return undefined;
}

export type ParsedSkillMd = {
	name?: string;
	description?: string;
	/** Combined with description for listing-size estimates (capped per skill in footprint). */
	when_to_use?: string;
	/** When true, description slice is omitted from normal listing (manual invoke). */
	disable_model_invocation?: boolean;
	metadata?: unknown;
	body: string;
	/** Full SKILL.md character count (entire file). */
	skill_md_char_count: number;
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
	const whenRaw =
		typeof fm.when_to_use === "string"
			? fm.when_to_use
			: typeof (fm as { whenToUse?: unknown }).whenToUse === "string"
				? ((fm as { whenToUse: string }).whenToUse as string)
				: undefined;
	const disableRaw =
		parseFrontmatterBool(fm.disable_model_invocation) ??
		parseFrontmatterBool((fm as { disableModelInvocation?: unknown }).disableModelInvocation);
	return {
		name: typeof fm.name === "string" ? fm.name : undefined,
		description: typeof fm.description === "string" ? fm.description : undefined,
		when_to_use: whenRaw,
		disable_model_invocation: disableRaw,
		metadata: fm.metadata,
		body,
		skill_md_char_count: content.length,
	};
}
