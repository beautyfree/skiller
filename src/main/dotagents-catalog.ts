import { homedir } from "node:os";
import {
	skillerAgentCatalogToDescriptors,
} from "dotagents/adapters/skiller-agents";
import { builtinAgentDescriptors } from "dotagents/catalog";
import type { AgentDescriptor, Platform } from "dotagents/agents";
import {
	scanMachineAgents,
	type MachineInventory,
	type MachinePort,
} from "dotagents/machine";
import type { AgentConfig } from "./types";

function desktopPlatform(): Platform {
	if (process.platform === "darwin" || process.platform === "linux" || process.platform === "win32") return process.platform;
	throw new Error(`Unsupported desktop platform: ${process.platform}`);
}

/** Built-ins come from dotagents; only explicit custom TOML entries use the compatibility projection. */
export function dotagentsDescriptorsFromSkiller(configs: AgentConfig[]): AgentDescriptor[] {
	const builtins = new Map(builtinAgentDescriptors().map((descriptor) => [descriptor.slug, descriptor]));
	const custom = skillerAgentCatalogToDescriptors(configs.filter((config) => !builtins.has(config.slug)).map((config) => ({
		slug: config.slug,
		name: config.name,
		global_paths: config.global_paths,
		cli_command: config.cli_command,
		detect_paths: config.detect_paths,
		additional_readable_paths: config.additional_readable_paths,
	})));
	return configs
		.map((config) => builtins.get(config.slug))
		.filter((descriptor): descriptor is AgentDescriptor => Boolean(descriptor))
		.concat(custom)
		.sort((left, right) => left.slug.localeCompare(right.slug, "en"));
}

export async function scanDotagentsMachine(
	configs: AgentConfig[],
	options: { platform?: Platform; home?: string; port?: MachinePort } = {},
): Promise<MachineInventory> {
	return scanMachineAgents(dotagentsDescriptorsFromSkiller(configs), {
		platform: options.platform ?? desktopPlatform(),
		home: options.home ?? homedir(),
		...(options.port ? { port: options.port } : {}),
	});
}
