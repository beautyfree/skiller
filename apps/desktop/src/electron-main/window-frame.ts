import type { Rectangle } from "electron";

export function defaultWindowFrame(workArea: Rectangle): Rectangle {
	const width = Math.min(1600, workArea.width);
	const height = Math.min(1080, workArea.height);
	return {
		x: Math.round(workArea.x + (workArea.width - width) / 2),
		y: Math.round(workArea.y + (workArea.height - height) / 2),
		width,
		height,
	};
}
