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
  Amp,
  Goose,
  Junie,
  KiloCode,
  Kimi,
  Mistral,
  OpenHands,
  Qwen,
  Replit,
  RooCode,
  Zencoder,
} from "@lobehub/icons";

// Fallback SVGs/PNGs for icons not available in @lobehub/icons
import factorySvg from "@/mainview/assets/agents/factory.svg";
import kiroSvg from "@/mainview/assets/agents/kiro.svg";
import warpSvg from "@/mainview/assets/agents/warp.svg";
import qoderSvg from "@/mainview/assets/agents/qoder.svg";
import codebuddySvg from "@/mainview/assets/agents/codebuddy.svg";
import augmentSvg from "@/mainview/assets/agents/augment.svg";
import firebenderSvg from "@/mainview/assets/agents/firebender.svg";
import continuePng from "@/mainview/assets/agents/continue.png";
import mcpjamPng from "@/mainview/assets/agents/mcpjam.png";
import neovatePng from "@/mainview/assets/agents/neovate.png";
import piSvg from "@/mainview/assets/agents/pi.svg";
import deepagentsSvg from "@/mainview/assets/agents/deepagents.svg";
import pochiPng from "@/mainview/assets/agents/pochi.png";
import crushPng from "@/mainview/assets/agents/crush.png";
import commandCodePng from "@/mainview/assets/agents/command-code.png";
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
  "trae-cn": Trae.Color,
  "opencode": OpenCode,
  "openclaw": OpenClaw.Color,
  "antigravity": Antigravity.Color,
  "amp": Amp.Color,
  "goose": Goose,
  "junie": Junie.Color,
  "kilo": KiloCode,
  "kimi-cli": Kimi.Color,
  "mistral-vibe": Mistral.Color,
  "openhands": OpenHands.Color,
  "qwen-code": Qwen.Color,
  "replit": Replit.Color,
  "roo": RooCode,
  "zencoder": Zencoder.Color,
};

// Static SVG fallback icons (img src)
// monochrome: true means the icon is single-color black and needs dark:invert
const AGENT_FALLBACK_ICONS: Record<string, { src: string; monochrome?: boolean }> = {
  "factory": { src: factorySvg, monochrome: true },
  "kiro": { src: kiroSvg },
  "warp": { src: warpSvg, monochrome: true },
  "qoder": { src: qoderSvg },
  "codebuddy": { src: codebuddySvg },
  "augment": { src: augmentSvg, monochrome: true },
  "firebender": { src: firebenderSvg },
  "continue": { src: continuePng },
  "mcpjam": { src: mcpjamPng },
  "neovate": { src: neovatePng },
  "pi": { src: piSvg, monochrome: true },
  "deepagents": { src: deepagentsSvg },
  "pochi": { src: pochiPng },
  "crush": { src: crushPng },
  "command-code": { src: commandCodePng },
};

export function getAgentIcon(slug: string): { type: "component"; Component: IconComponent } | { type: "img"; src: string; monochrome?: boolean } {
  const component = AGENT_ICONS[slug];
  if (component) return { type: "component", Component: component };

  const fallback = AGENT_FALLBACK_ICONS[slug];
  if (fallback) return { type: "img", ...fallback };

  return { type: "img", src: defaultSvg };
}
