import type { ComponentType, SVGProps } from "react";

import {
  ClaudeCode,
  Cursor,
  Windsurf,
  GithubCopilot,
  Codex,
  Gemini,
  Cline,
  Trae,
  OpenCode,
  OpenClaw,
  Antigravity,
} from "@lobehub/icons";

// Fallback SVGs for icons not available in @lobehub/icons
import factorySvg from "@/mainview/assets/agents/factory.svg";
import kiroSvg from "@/mainview/assets/agents/kiro.svg";
import warpSvg from "@/mainview/assets/agents/warp.svg";
import qoderSvg from "@/mainview/assets/agents/qoder.svg";
import codebuddySvg from "@/mainview/assets/agents/codebuddy.svg";
import defaultSvg from "@/mainview/assets/agents/default.svg";

type IconComponent = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;

// Use Color variant when available, otherwise Mono (default export)
const AGENT_ICONS: Record<string, IconComponent> = {
  "claude-code": ClaudeCode.Color,
  "cursor": Cursor,
  "windsurf": Windsurf,
  "copilot-cli": GithubCopilot,
  "codex": Codex.Color,
  "gemini-cli": Gemini.Color,
  "cline": Cline,
  "trae": Trae.Color,
  "opencode": OpenCode,
  "openclaw": OpenClaw.Color,
  "antigravity": Antigravity.Color,
};

// Static SVG fallback icons (img src)
// monochrome: true means the icon is single-color black and needs dark:invert
const AGENT_FALLBACK_ICONS: Record<string, { src: string; monochrome?: boolean }> = {
  "factory": { src: factorySvg, monochrome: true },
  "kiro": { src: kiroSvg },
  "warp": { src: warpSvg, monochrome: true },
  "qoder": { src: qoderSvg },
  "codebuddy": { src: codebuddySvg },
};

export function getAgentIcon(slug: string): { type: "component"; Component: IconComponent } | { type: "img"; src: string; monochrome?: boolean } {
  const component = AGENT_ICONS[slug];
  if (component) return { type: "component", Component: component };

  const fallback = AGENT_FALLBACK_ICONS[slug];
  if (fallback) return { type: "img", ...fallback };

  return { type: "img", src: defaultSvg };
}
