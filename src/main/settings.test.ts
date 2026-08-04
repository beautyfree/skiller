import { describe, expect, it } from "bun:test";
import { appDataRootPathFor } from "./settings";

describe("platform data paths", () => {
	it("uses native Windows roaming data", () => {
		expect(appDataRootPathFor("win32", "C:\\Users\\dev", { APPDATA: "C:\\Users\\dev\\AppData\\Roaming" }))
			.toBe("C:\\Users\\dev\\AppData\\Roaming/Skiller");
	});

	it("uses XDG data on Linux", () => {
		expect(appDataRootPathFor("linux", "/home/dev", { XDG_DATA_HOME: "/data" })).toBe("/data/skiller");
		expect(appDataRootPathFor("linux", "/home/dev", {})).toBe("/home/dev/.local/share/skiller");
	});

	it("keeps the established macOS location", () => {
		expect(appDataRootPathFor("darwin", "/Users/dev", {})).toBe("/Users/dev/.skiller");
	});

	it("supports an absolute isolated data root for packaged-app QA on every platform", () => {
		const env = { SKILLER_TEST_DATA_ROOT: "/private/tmp/skiller-live-qa" };
		expect(appDataRootPathFor("darwin", "/Users/dev", env)).toBe("/private/tmp/skiller-live-qa");
		expect(appDataRootPathFor("linux", "/home/dev", env)).toBe("/private/tmp/skiller-live-qa");
		expect(appDataRootPathFor("win32", "C:\\Users\\dev", env)).toBe("/private/tmp/skiller-live-qa");
	});

	it("rejects a relative isolated data root", () => {
		expect(() => appDataRootPathFor("darwin", "/Users/dev", {
			SKILLER_TEST_DATA_ROOT: "relative/live-qa",
		})).toThrow("SKILLER_TEST_DATA_ROOT must be an absolute path");
	});
});
