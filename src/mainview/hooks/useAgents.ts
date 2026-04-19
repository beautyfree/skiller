import { useQuery } from "@tanstack/react-query";
import { invoke } from "@/mainview/lib/native";

export interface AgentConfig {
  slug: string;
  name: string;
  enabled: boolean;
  global_paths: string[];
  skill_format: string;
  cli_command: string | null;
  install_command: string | null;
  install_command_windows: string | null;
  install_command_linux: string | null;
  install_docs_url: string | null;
  install_docs_url_linux: string | null;
  install_source_label: string | null;
  detected: boolean;
}

type OS = "windows" | "linux" | "macos";

function detectOS(): OS {
  // window.api.platform comes from the Electron preload bridge. Fall back to
  // userAgent sniffing for plain-Vite dev (`vite dev` without the Electron
  // shell) so the install buttons still resolve to something sensible.
  const native = (globalThis as { api?: { platform?: string } }).api?.platform;
  if (native === "win32") return "windows";
  if (native === "linux") return "linux";
  if (native === "darwin") return "macos";
  if (typeof navigator === "undefined") return "macos";
  const ua = navigator.userAgent;
  if (ua.includes("Windows")) return "windows";
  if (ua.includes("Linux")) return "linux";
  return "macos";
}

/**
 * Get the platform-appropriate install command. `install_command` is the
 * default (macOS-flavored — brew cask, curl | bash, npm -g). Windows and
 * Linux get their own optional fields; if null, we fall back to the default
 * ONLY when the default is plausibly cross-platform (starts with `npm `).
 * Otherwise return null so the UI can show "no install command for this OS".
 */
export function getInstallCommand(agent: AgentConfig): string | null {
  const os = detectOS();
  if (os === "windows") {
    return agent.install_command_windows ?? fallbackDefault(agent);
  }
  if (os === "linux") {
    return agent.install_command_linux ?? fallbackDefault(agent);
  }
  return agent.install_command;
}

/**
 * When a platform-specific command isn't defined, we fall back to the default
 * `install_command` ONLY if it looks host-agnostic. Whitelist:
 *   - node ecosystem (`npm`, `npx`, `pnpm`, `yarn`, `bun`)
 *   - python (`pip`, `pipx`)
 *   - rust/go (`cargo`, `go install`)
 *   - `curl | bash` style installers — these are almost always cross-platform
 *     in practice (the script inside branches on `uname`)
 * Blacklist (implicit — anything not matched returns null): `brew`, `winget`,
 * `choco`, `scoop`, `apt`, `snap`, `flatpak`, etc. — all OS-specific.
 */
function fallbackDefault(agent: AgentConfig): string | null {
  const cmd = agent.install_command;
  if (!cmd) return null;
  const trimmed = cmd.trim();
  const head = trimmed.split(/\s+/)[0];
  const CROSS_PLATFORM_PREFIXES = [
    "npm",
    "npx",
    "pnpm",
    "yarn",
    "bun",
    "bunx",
    "pip",
    "pipx",
    "cargo",
    "go",
    "curl", // curl|bash installers branch on uname internally
    "wget",
  ];
  if (CROSS_PLATFORM_PREFIXES.includes(head)) return cmd;
  return null;
}

/** Get the platform-appropriate docs URL. Linux can override the default
 *  since the default often points at Homebrew-cask pages that are useless
 *  for Linux users. */
export function getInstallDocsUrl(agent: AgentConfig): string | null {
  if (detectOS() === "linux" && agent.install_docs_url_linux) {
    return agent.install_docs_url_linux;
  }
  return agent.install_docs_url;
}

export function useAgents() {
  return useQuery<AgentConfig[]>({
    queryKey: ["agents"],
    queryFn: async () => (await invoke("detect_agents")) as AgentConfig[],
    staleTime: 5 * 60 * 1000, // agent detection rarely changes
  });
}

export function useAllAgents() {
  return useQuery<AgentConfig[]>({
    queryKey: ["all-agents"],
    queryFn: async () => (await invoke("list_agents")) as AgentConfig[],
    staleTime: 5 * 60 * 1000,
  });
}
