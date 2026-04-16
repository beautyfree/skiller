/**
 * AbortSignal with timeout. Some embedded Bun / older runtimes lack
 * `AbortSignal.timeout`, which would throw and break marketplace fetches.
 */
export function fetchTimeoutSignal(ms: number): AbortSignal {
	if (
		typeof AbortSignal !== "undefined" &&
		typeof AbortSignal.timeout === "function"
	) {
		return AbortSignal.timeout(ms);
	}
	const controller = new AbortController();
	setTimeout(() => controller.abort(), ms);
	return controller.signal;
}
