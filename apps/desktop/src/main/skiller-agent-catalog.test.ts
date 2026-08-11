import { describe, expect, it } from "bun:test"
import { skillerAgentCatalogToDescriptors } from "./skiller-agent-catalog"

describe("Skiller agent catalog adapter", () => {
  it("keeps Skiller TOML projection outside dotagents", () => {
    const [descriptor] = skillerAgentCatalogToDescriptors([
      {
        slug: "codex",
        name: "Codex",
        global_paths: ["~/.codex/skills"],
        cli_command: "codex",
        detect_paths: ["~/.codex"],
        additional_readable_paths: [{ path: "~/.agents/skills", source_agent: "shared" }],
      },
    ])
    expect(descriptor?.skills).toEqual([{ kind: "native-shared" }, { kind: "per-skill-link", roots: ["~/.codex/skills"] }])
  })
})
