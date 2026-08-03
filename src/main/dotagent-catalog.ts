import { homedir } from "node:os";
import {
	skillerAgentCatalogToDescriptors,
} from "@beautyfree/dotagent/adapters/skiller-agents";
import type { AgentDescriptor, Platform } from "@beautyfree/dotagent/agents";
import {
	scanMachineAgents,
	type MachineInventory,
	type MachinePort,
} from "@beautyfree/dotagent/machine";
import type { AgentConfig } from "./types";

function desktopPlatform(): Platform {
	if (process.platform === "darwin" || process.platform === "linux" || process.platform === "win32") return process.platform;
	throw new Error(`Unsupported desktop platform: ${process.platform}`);
}

/** Transitional catalog projection: Skiller TOML stays authoritative until parity is proven for every slug. */
export function dotagentDescriptorsFromSkiller(configs: AgentConfig[]): AgentDescriptor[] {
	return skillerAgentCatalogToDescriptors(configs.map((config) => ({
		slug: config.slug,
		name: config.name,
		global_paths: config.global_paths,
		cli_command: config.cli_command,
		detect_paths: config.detect_paths,
		additional_readable_paths: config.additional_readable_paths,
	})));
}

export async function scanDotagentMachine(
	configs: AgentConfig[],
	options: { platform?: Platform; home?: string; port?: MachinePort } = {},
): Promise<MachineInventory> {
	return scanMachineAgents(dotagentDescriptorsFromSkiller(configs), {
		platform: options.platform ?? desktopPlatform(),
		home: options.home ?? homedir(),
		...(options.port ? { port: options.port } : {}),
	});
}
