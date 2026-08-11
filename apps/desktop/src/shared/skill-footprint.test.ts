import { describe, it, expect } from "bun:test";
import { parseSkillMdContent } from "../main/parser";
import {
	aggregateListingFootprint,
	approxTokensFromChars,
	LISTING_SLICE_CHAR_CAP,
	computeSkillFootprint,
	effectiveListingBudgetChars,
	formatApproxTok,
} from "./skill-footprint";

describe("computeSkillFootprint", () => {
	it("caps description+when_to_use at LISTING_SLICE_CHAR_CAP for listing slice", () => {
		const desc = "a".repeat(1000);
		const when = "b".repeat(1000);
		const fp = computeSkillFootprint({
			description: desc,
			when_to_use: when,
			disable_model_invocation: false,
			skill_md_char_count: 5000,
			display_name: "my-skill",
			skill_id: "my-skill",
		});
		expect(fp.footprint_listing_source_chars).toBe(2000);
		expect(fp.footprint_listing_slice_chars).toBe(LISTING_SLICE_CHAR_CAP);
		expect(fp.footprint_skill_md_chars).toBe(5000);
		expect(fp.footprint_name_chars).toBe("my-skill".length);
		expect(fp.listing_excluded).toBe(false);
	});

	it("zeroes listing slice when disable_model_invocation is true", () => {
		const fp = computeSkillFootprint({
			description: "hello",
			when_to_use: "world",
			disable_model_invocation: true,
			skill_md_char_count: 120,
			display_name: "x",
			skill_id: "x",
		});
		expect(fp.footprint_listing_slice_chars).toBe(0);
		expect(fp.listing_excluded).toBe(true);
		expect(fp.footprint_listing_source_chars).toBe(10);
	});
});

describe("aggregateListingFootprint", () => {
	it("sums slices and names", () => {
		const agg = aggregateListingFootprint(
			[
				{ footprint_listing_slice_chars: 100, footprint_name_chars: 5 },
				{ footprint_listing_slice_chars: 200, footprint_name_chars: 3 },
			],
			8000,
		);
		expect(agg.sum_listing_slices).toBe(300);
		expect(agg.sum_names).toBe(8);
		expect(agg.listing_chars_after_global_budget).toBe(300);
		expect(agg.used_chars).toBe(308);
		expect(agg.budget_unset).toBe(false);
		expect(agg.over_budget).toBe(false);
		expect(agg.approx_tokens_used).toBe(approxTokensFromChars(308));
	});

	it("returns raw sum when budget is unset (null)", () => {
		const agg = aggregateListingFootprint(
			[
				{ footprint_listing_slice_chars: 100, footprint_name_chars: 5 },
				{ footprint_listing_slice_chars: 200, footprint_name_chars: 3 },
			],
			null,
		);
		expect(agg.budget_unset).toBe(true);
		expect(agg.budget_chars).toBe(null);
		expect(agg.used_chars).toBe(308);
		expect(agg.listing_chars_after_global_budget).toBe(300);
	});

	it("caps summed description slices to global budget", () => {
		const agg = aggregateListingFootprint(
			[
				{ footprint_listing_slice_chars: 6000, footprint_name_chars: 10 },
				{ footprint_listing_slice_chars: 6000, footprint_name_chars: 10 },
			],
			8000,
		);
		expect(agg.sum_listing_slices).toBe(12000);
		expect(agg.listing_chars_after_global_budget).toBe(8000);
		expect(agg.used_chars).toBe(8020);
		expect(agg.over_budget).toBe(true);
		expect(agg.budget_unset).toBe(false);
	});

	it("flags over budget when raw description sum exceeds global budget", () => {
		const agg = aggregateListingFootprint(
			[{ footprint_listing_slice_chars: 9000, footprint_name_chars: 10 }],
			8000,
		);
		expect(agg.over_budget).toBe(true);
		expect(agg.listing_chars_after_global_budget).toBe(8000);
		expect(agg.used_chars).toBe(8010);
		expect(agg.budget_unset).toBe(false);
	});
});

describe("effectiveListingBudgetChars", () => {
	it("uses explicit budget when set", () => {
		expect(effectiveListingBudgetChars(12000, null)).toBe(12000);
	});

	it("uses 1% of window when no explicit budget (no silent floor)", () => {
		expect(effectiveListingBudgetChars(null, 1_000_000)).toBe(10_000);
		expect(effectiveListingBudgetChars(null, 200_000)).toBe(2000);
	});

	it("returns null when neither budget nor window is set", () => {
		expect(effectiveListingBudgetChars(undefined, null)).toBe(null);
		expect(effectiveListingBudgetChars(null, undefined)).toBe(null);
	});
});

describe("formatApproxTok", () => {
	it("formats compact token strings", () => {
		expect(formatApproxTok(0)).toBe("0");
		expect(formatApproxTok(42)).toBe("42");
		expect(formatApproxTok(999)).toBe("999");
		expect(formatApproxTok(1000)).toBe("1k");
		expect(formatApproxTok(1500)).toBe("1.5k");
		expect(formatApproxTok(10000)).toBe("10k");
	});
});

describe("parseSkillMdContent", () => {
	it("parses when_to_use and disable_model_invocation", () => {
		const md = `---
name: Test
description: Short
when_to_use: Use when testing
disable_model_invocation: true
---
Body here
`;
		const p = parseSkillMdContent(md);
		expect(p.when_to_use).toBe("Use when testing");
		expect(p.disable_model_invocation).toBe(true);
		expect(p.skill_md_char_count).toBe(md.length);
	});
});
