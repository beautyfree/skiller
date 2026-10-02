import { expect, test } from "bun:test";
import { defaultWindowFrame } from "./window-frame";

test("startup window fits the catalog's 800 by 600 display", () => {
	expect(defaultWindowFrame({ x: 0, y: 0, width: 800, height: 600 })).toEqual({
		x: 0, y: 0, width: 800, height: 600,
	});
});

test("startup window keeps its preferred size and centers on a large display", () => {
	expect(defaultWindowFrame({ x: 0, y: 0, width: 1920, height: 1200 })).toEqual({
		x: 160, y: 60, width: 1600, height: 1080,
	});
});

test("startup window respects the display's work area origin", () => {
	expect(defaultWindowFrame({ x: -1280, y: 32, width: 1280, height: 992 })).toEqual({
		x: -1280, y: 32, width: 1280, height: 992,
	});
});
