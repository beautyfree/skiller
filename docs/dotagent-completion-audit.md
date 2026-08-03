# dotagent completion audit

Audit date: 2026-08-03

Audited revisions:

- `beautyfree/dotagent` `96ef6eee92133364f773141657be5ab0cfc4a806`
- `beautyfree/skiller` `feat/agent-sync-foundation`, based on `75c608c` with
  the audit remediations carried by this document's commit

This report audits the objective and every acceptance boundary in
`dotagent-architecture-plan.md`. A checked roadmap item is not accepted as
evidence by itself; the evidence below comes from current source, tests, CI,
package artifacts, and exact-path native runtime review.

## Completion verdict

The TypeScript core, canonical library model, Skiller integration, migration
compatibility, safety model, cross-platform CI, reproducible artifact builder,
and local packaged-app gate are implemented and verified. The objective is not
yet globally complete because the roadmap deliberately requires an actual
signed/provenance-aware package publication. The package is still
`private: true` at placeholder version `0.0.0`, so an accidental npm
publication is impossible.

The remaining release decision is external to the implementation: select and
review a real package version, decide public registry visibility, create the
release commit, and explicitly run the protected publish workflow. No npm
package, GitHub release, notarized installer, or cross-platform installer has
been claimed as published.

## Requirement evidence matrix

| Requirement | Authoritative evidence | Verdict |
| --- | --- | --- |
| Reusable JavaScript/TypeScript core | Node 20+ ESM package; 33 subpath exports; 30-export API snapshot; no Electron import in `dotagent/src` | Proven |
| Canonical public/private library | Versioned `skills.json`, `skills.lock`, `dotagent.yaml`; private `dotagent.local.yaml` and ledger; public/private audit tests | Proven |
| Skills CLI and RFC compatibility | Read-only Skills CLI v3 adapter, unknown-version refusal, RFC #210 compatibility guide, repository-root and multi-skill fixtures | Proven |
| Shared agent model | Authoritative 49-agent data-only catalog; Skiller TOML parity tests; shared-reader capability separate from installation evidence | Proven |
| `.agents/skills` semantics | Machine/registry/scanner tests prove a skills-only directory is never installation evidence and shared skills are not attributed to every reader | Proven |
| Immutable external skills | Git and skills.sh sources become commit-and-integrity-pinned dependencies; explicit vendoring requires immutable origin and license | Proven |
| Safe local materialization | Preview/apply plan IDs, unmanaged-target refusal, symlink/junction/copy strategies, markers, journaled rollback and recovery | Proven |
| Safe Git synchronization | Provider-neutral reviewed init/clone/commit/pull/push; credential-free identity; detached exact-commit review; fast-forward-only apply | Proven |
| No secret or machine-state leakage | Value-free findings; credential-bearing remotes rejected; portable output/path-redaction tests; local routing remains gitignored | Proven |
| Existing Skiller compatibility | v1/v2/v3 fixtures migrate in memory through versioned adapters; existing repositories are not silently rewritten | Proven |
| Existing Skills CLI compatibility | Skills CLI locks are read-only input adapters and never become dotagent's source of truth | Proven |
| One engine, not two | Skiller imports dotagent schemas, discovery, catalog, audit, export, Git, reconciliation, and transaction APIs; alternate restore/setup routes and kill switch are removed | Proven |
| Same plans across adapters | Golden fixtures prove byte-equivalent serialized import plans and IDs; renderer JSON mappings redact paths | Proven |
| Public/private Sync Center UX | Live exact-path dev and signed arm64 packaged reviews show separate create/connect, review/apply, destination, conflict, and recovery stages | Proven for current macOS package |
| macOS/Linux/Windows behavior | dotagent CI run `30824101405` passes on all three operating systems; platform path and strategy fixtures pass | Proven at CI level |
| Reproducible release artifacts | Clean-commit builder creates byte-reproducible tarball, CycloneDX SBOM, checksums, version-specific notes, docs, and a commit-bound manifest; exact-allowlist verifier rejects tampering and extra assets | Proven |
| Permanent release flow | Retry-safe publisher refuses npm integrity and Git-tag collisions, holds GitHub Release as draft until every verified asset is present, then verifies tag and asset sizes | Proven without publication |
| Published signed/provenance package | Protected OIDC workflow is ready and non-publishing run `30824175165` passed; registry publication has not been authorized or performed | **Not complete** |

## Current verification snapshot

Fresh local verification at the audited revisions:

- dotagent `bun run release:check`: 114 tests, 399 assertions, lint, formatting,
  typecheck, schema drift, API drift, CLI inspect/audit smoke tests, 160 package
  files, and 33 export paths all pass;
- Skiller `bun test`: 108 tests and 386 assertions pass;
- Skiller `bun run typecheck`: renderer and Node configurations pass;
- Skiller production Electron/Vite build passes with the audit remediations;
- Developer-ID-signed local arm64 `.app` passes
  `codesign --verify --deep --strict` and exact-path runtime review of Dashboard,
  Sync Center, and existing-library connection without visible RPC failure;
- dotagent CI `30824101405` passes on Ubuntu, macOS, and Windows;
- release validation run `30824175165` produced artifact `8860103162` with
  digest `sha256:4a6d014193041d4accca308ad0503255b20ceb816e97af5583234bbd721faaee`
  without invoking the protected npm/GitHub publication job.

## Sync Center interface audit

### Anti-pattern verdict

Pass with reservations. The landing view has a deliberate product identity and
one clear primary action, but the centered hero plus compact metric row is close
to a generic marketing template. The reviewed workflow itself avoids the worse
patterns: it uses progressive disclosure, a single virtualized list, inline
details instead of a modal, and distinct review/destination/apply stages.

### Executive summary

- 0 critical functional issues found;
- 1 high accessibility issue remains;
- 2 medium accessibility/responsive findings were fixed and live-verified;
- no performance blocker found in the large skill list;
- architecture and safety behavior remain the stronger part of the surface.

### High severity

#### Hero text contrast

- Location: `src/mainview/index.css` `.sync-center-hero` and the landing copy in
  `src/mainview/pages/SyncCenter.tsx`.
- Category: Accessibility / theming.
- Evidence: `oklch(0.72 0.18 270)` resolves to approximately `rgb(122 155 255)`.
  Fully white text is about `2.65:1`; the 82%, 76%, and 68% white copy falls to
  roughly `2.26:1`, `2.15:1`, and `1.99:1`.
- Impact: the headline narrowly misses the 3:1 large-text threshold, while body
  copy, secondary action, safety note, and metrics miss WCAG AA 4.5:1.
- Standard: WCAG 2.2 1.4.3 Contrast (Minimum).
- Recommendation: keep the approved indigo identity but validate a darker
  landing tone or an intentional opaque reading surface before changing the
  currently approved visual design.

### Resolved during this audit

#### Inventory checkbox target

- Location: `InventorySkillRow` in `src/mainview/pages/SyncCenter.tsx`.
- Category: Accessibility.
- Description: the checkbox label wraps only the native checkbox and small
  vertical padding; the skill-name button is a separate action.
- Impact: selection remains keyboard-accessible, but the pointer target can be
  below the WCAG 2.2 24-by-24 minimum and is harder to acquire in a long list.
- Standard: WCAG 2.2 2.5.8 Target Size (Minimum).
- Resolution: the selection label now has a 28-by-28 hit area while preserving
  the separate inspect action.

#### Narrow-window detail layout

- Location: `ReviewSkillDetail` width `w-[min(26rem,46%)]` and the two-pane
  inventory layout.
- Category: Responsive design.
- Description: the Electron window has a default size but no enforced minimum;
  at narrow widths the list and details continue sharing one horizontal row.
- Impact: skill instructions and outcome labels can become cramped even though
  no functionality is intentionally hidden.
- Resolution: a content-driven container query now replaces the list with a
  full-width detail pane and an explicit `Back to skills` action below 42rem.
  Exact-path Electron review verified that the list disappears only while a
  detail is open, the return action restores it, and no RPC error is introduced.

### Positive findings

- Inventory rendering is virtualized with a stable key, memoized rows, and
  overscan; checkbox changes do not render the entire library.
- Skill previews use query caching and never execute skill content.
- Every state-changing sync action is separated from its review and binds the
  reviewed plan ID.
- Loading states explain the current operation; errors do not dump stack traces
  or matched secret values into the UI.
- Buttons and form controls have semantic roles, labels, keyboard focus rings,
  and reduced-motion handling for the CTA shimmer.
- The destination choice is not mixed into skill selection, and back navigation
  exists across the multi-step flow.

## Priority

1. Release decision: approve version/visibility and run the protected
   provenance publication only when an actual release is intended.
2. Accessibility: agree on a darker but still fixed indigo surface, then adjust
   the hero contrast as one coherent design change.
3. Keep the new checkbox hit area and narrow-container master/detail behavior in
   future Sync Center UI reviews.
