import { determineAgent } from "@vercel/detect-agent";

export type RuntimeAgent = {
	runtime_name: string;
	mapped_agent_slug: string | null;
	source: "AI_AGENT" | "@vercel/detect-agent";
};

const runtimeAliases: Record<string, string> = {
	"augment-cli": "augment",
	claude: "claude-code",
	cowork: "claude-code",
	gemini: "gemini-cli",
	"github-copilot": "copilot-cli",
	"github-copilot-cli": "copilot-cli",
	"cursor-cli": "cursor",
};

export function classifyRuntimeAgent(
	runtimeName: string,
	source: RuntimeAgent["source"],
): RuntimeAgent | null {
	const normalized = runtimeName.trim().toLowerCase();
	if (!normalized) return null;
	return {
		runtime_name: normalized,
		mapped_agent_slug: runtimeAliases[normalized] ?? normalized,
		source,
	};
}

/**
 * Detects the process currently running Skiller. This is intentionally kept
 * separate from filesystem/CLI install detection: an active agent is not proof
 * that it should be selected as an install target.
 */
export async function detectRuntimeAgent(): Promise<RuntimeAgent | null> {
	const explicit = process.env.AI_AGENT;
	if (explicit?.trim()) return classifyRuntimeAgent(explicit, "AI_AGENT");

	const result = await determineAgent();
	if (!result.isAgent || !result.agent) return null;
	// The upstream package treats CURSOR_TRACE_ID as Cursor. Its own CLI
	// documents this as a trace propagation variable, so retain Skills CLI's
	// guard against a false-positive runtime banner.
	if (
		result.agent.name === "cursor" &&
		process.env.CURSOR_TRACE_ID &&
		!process.env.CURSOR_AGENT &&
		process.env.CURSOR_EXTENSION_HOST_ROLE !== "agent-exec"
	) {
		return null;
	}
	return classifyRuntimeAgent(result.agent.name, "@vercel/detect-agent");
}
