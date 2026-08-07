import { describe, expect, it } from "bun:test"
import { createSkillerSyncManifest, parseSkillerSyncManifest, stringifySkillerSyncManifest } from "./legacy-skiller-sync"

describe("Skiller legacy sync format", () => {
  it("keeps its old manifest format inside Skiller and upgrades v1 in memory", () => {
    const current = createSkillerSyncManifest("personal", "public", { mode: "selected", agent_slugs: ["codex"] })
    expect(parseSkillerSyncManifest(stringifySkillerSyncManifest(current))).toEqual(current)

    const legacy = parseSkillerSyncManifest(
      "schema_version: 1\nprofile: { id: personal, mode: private }\nagent_policy: { mode: detected }\nskills:\n  - { id: writing, kind: bundled, path: skills/writing, sha256: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa }\n",
    )
    expect(legacy.schema_version).toBe(3)
  })
})
