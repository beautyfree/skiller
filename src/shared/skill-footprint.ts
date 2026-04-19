/**
 * Per-skill cap on description + when_to_use text used for listing-size estimates (chars).
 * Hosts differ; this is a fixed heuristic for comparable UI numbers.
 */
export const LISTING_SLICE_CHAR_CAP = 1536;

export type SkillFootprintInputs = {
	description?: string | null;
	when_to_use?: string | null;
	disable_model_invocation?: boolean | null;
	skill_md_char_count: number;
	/** Display name from frontmatter or directory id */
	display_name: string;
	skill_id: string;
};

export type SkillFootprintComputed = {
	footprint_listing_source_chars: number;
	footprint_listing_slice_chars: number;
	footprint_name_chars: number;
	footprint_skill_md_chars: number;
	listing_excluded: boolean;
};

/** Rough token estimate for UI only (not model tokenizer). */
export function approxTokensFromChars(chars: number): number {
	if (chars <= 0) return 0;
	return Math.ceil(chars / 4);
}

/** Compact approximate token count for UI (e.g. 1.2k, 42). Heuristic: chars ÷ 4. */
export function formatApproxTok(tokens: number): string {
	if (tokens <= 0) return "0";
	if (tokens < 1000) return String(tokens);
	const k = tokens / 1000;
	const s = k >= 10 ? String(Math.round(k)) : k.toFixed(1).replace(/\.0$/, "");
	return `${s}k`;
}

export function computeSkillFootprint(inp: SkillFootprintInputs): SkillFootprintComputed {
	const desc = inp.description ?? "";
	const when = inp.when_to_use ?? "";
	const listingSource = desc + when;
	const excluded = inp.disable_model_invocation === true;
	const slice = excluded ? 0 : Math.min(LISTING_SLICE_CHAR_CAP, listingSource.length);
	const display = inp.display_name.trim() || inp.skill_id;
	return {
		footprint_listing_source_chars: listingSource.length,
		footprint_listing_slice_chars: slice,
		footprint_name_chars: display.length,
		footprint_skill_md_chars: inp.skill_md_char_count,
		listing_excluded: excluded,
	};
}

export type FootprintRow = {
	footprint_listing_slice_chars: number;
	footprint_name_chars: number;
};

/**
 * Aggregate listing footprint when a global description budget applies:
 * sum of per-skill listing slices is capped by `budgetChars`; skill names are added in full.
 * (Per-skill slices are already capped by `LISTING_SLICE_CHAR_CAP` before this step.)
 */
export function aggregateListingFootprint(
	rows: FootprintRow[],
	budgetChars: number | null,
): {
	sum_listing_slices: number;
	sum_names: number;
	/** Sum of listing slices after applying global description budget (min with budget). */
	listing_chars_after_global_budget: number;
	/** Approximate chars after global budget: capped description pool + all names. */
	used_chars: number;
	budget_chars: number | null;
	/** True when no budget was set — used_chars is raw sum_listing_slices + sum_names (uncapped). */
	budget_unset: boolean;
	/** How full the global *description* budget is: sum_listing_slices / budget (can exceed 1). */
	fraction: number;
	over_budget: boolean;
	approx_tokens_used: number;
} {
	const sum_listing_slices = rows.reduce((a, r) => a + r.footprint_listing_slice_chars, 0);
	const sum_names = rows.reduce((a, r) => a + r.footprint_name_chars, 0);

	if (budgetChars == null || budgetChars <= 0) {
		const used_chars = sum_listing_slices + sum_names;
		return {
			sum_listing_slices,
			sum_names,
			listing_chars_after_global_budget: sum_listing_slices,
			used_chars,
			budget_chars: null,
			budget_unset: true,
			fraction: 0,
			over_budget: false,
			approx_tokens_used: approxTokensFromChars(used_chars),
		};
	}

	const b = budgetChars;
	const listing_chars_after_global_budget = Math.min(sum_listing_slices, b);
	const used_chars = listing_chars_after_global_budget + sum_names;
	const fraction = sum_listing_slices / b;
	return {
		sum_listing_slices,
		sum_names,
		listing_chars_after_global_budget,
		used_chars,
		budget_chars: b,
		budget_unset: false,
		fraction,
		over_budget: sum_listing_slices > b,
		approx_tokens_used: approxTokensFromChars(used_chars),
	};
}

/**
 * Returns null when neither an explicit budget nor a context window is configured.
 * When only the window is set: 1% of it as a listing budget heuristic (no silent default floor).
 */
export function effectiveListingBudgetChars(
	assumedListingCharBudget: number | null | undefined,
	assumedContextWindowChars: number | null | undefined,
): number | null {
	const explicit = assumedListingCharBudget;
	if (explicit != null && explicit > 0) return explicit;
	const window = assumedContextWindowChars;
	if (window != null && window > 0) {
		return Math.round(0.01 * window);
	}
	return null;
}
