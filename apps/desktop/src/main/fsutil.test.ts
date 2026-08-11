import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { userHomePathFor } from "./fsutil";

describe("userHomePathFor", () => {
	test("uses the operating-system home in normal application runs", () => {
		expect(userHomePathFor("/Users/person", {})).toBe("/Users/person");
	});

	test("supports an isolated absolute home for live application QA", () => {
		expect(userHomePathFor("/Users/person", { SKILLER_TEST_HOME: "/private/tmp/skiller-live-home" }))
			.toBe(resolve("/private/tmp/skiller-live-home"));
	});

	test("rejects a relative isolated home", () => {
		expect(() => userHomePathFor("/Users/person", { SKILLER_TEST_HOME: "relative/home" }))
			.toThrow("SKILLER_TEST_HOME must be an absolute path");
	});
});
