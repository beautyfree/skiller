# beautyfree/dotagent — architecture and delivery plan

> Status: active implementation plan  
> Created: 2026-08-03  
> Owners: beautyfree/dotagent core and Skiller integration  
> Decision rule: update this document whenever the format, package boundary, migration order, or acceptance criteria changes.

## 1. Outcome

`beautyfree/dotagent` is a TypeScript library and headless CLI for maintaining one canonical agent library, normally cloned at `~/.agents`, and materializing reviewed views into the native locations of supported agents.

Skiller remains the desktop product. It imports the same core package used by the CLI and adds discovery UX, review, Git provider setup, conflict resolution, background status, and release integration. Skiller must not keep a second implementation of manifest parsing, source resolution, secret scanning, reconciliation, or materialization planning.

The first useful release must support this complete story:

1. A user has a public or private Git repository containing a canonical `skills/` directory.
2. The repository distinguishes owned skills from external dependencies and pins external content immutably.
3. A clean machine can clone the library, inspect a no-write plan, and materialize selected skills to detected agents.
4. Existing unmanaged files are never overwritten silently.
5. Machine paths, credentials, private overrides, caches, and conflict decisions never enter the portable repository.
6. The same plan and result types are available to the CLI and Skiller.

## 2. Naming and distribution

| Surface | Name |
| --- | --- |
| GitHub repository | `beautyfree/dotagent` |
| npm package | `@beautyfree/dotagent` |
| JavaScript import | `import { ... } from '@beautyfree/dotagent'` |
| Initial collision-free binary | `beautyfree-dotagent` |
| Canonical library directory | `~/.agents` by default; configurable |
| Product UI | Skiller Sync Center / Library |

The unscoped npm package `dotagent` already exists. The scoped package is mandatory. A short binary alias may be reconsidered later, but v1 must not unexpectedly shadow another installed command.

## 3. Product model

### 3.1 Source of truth

The Git repository is the portable source of truth. Agent-specific folders are materialized views, not separate libraries and not independent Git repositories.

```text
public/private Git repository
            │
            ▼
      canonical library
       ~/.agents/skills
            │
       reviewed plan
            │
     ┌──────┼─────────┐
     ▼      ▼         ▼
  Codex   Claude   shared readers
  link    link     direct .agents read
```

### 3.2 Portable and local state

Portable repository content:

- owned skill folders and their resources;
- package identity and exported skill paths;
- external Git dependencies and requested refs;
- generated immutable lockfile with content integrity;
- portable defaults that do not expose a machine or person;
- README, license, attribution, and generated inventory if desired.

Machine-local state:

- absolute paths and detected agent installations;
- chosen materialization mode when it differs from the portable default;
- last applied library revision and base hashes;
- keep-local, skip, rename, and conflict decisions;
- Git authentication and provider sessions;
- caches and temporary clones;
- private overlay entries and secrets expressed only as environment references.

Local state must be ignored by Git and must not be serializable through the portable-manifest API by accident.

### 3.3 Source kinds

| Kind | Portable representation | Materialization |
| --- | --- | --- |
| `owned` | real files under `skills/<name>/` plus hashes | direct shared path, link, junction, or reviewed copy |
| `dependency` | Git identity + requested ref + selected skill paths | fetch pinned commit, verify integrity, expose selected skills |
| `vendored` | reviewed external files under `skills/` plus origin/license metadata | same as owned, but update/audit retains provenance |
| `local-only` | no portable entry | remains on one machine |
| `excluded` | optional non-sensitive reason only | no write |

An external skill never becomes `owned` silently. Vendoring is explicit because it changes update behavior, attribution requirements, repository size, and what a public library redistributes.

## 4. Repository format

```text
~/.agents/                     # repository root
├── skills.json                # Agent Skills package/distribution manifest
├── skills.lock                # resolved commits and content integrity
├── dotagent.yaml              # portable materialization policy and feature config
├── dotagent.local.yaml        # machine/private overlay; gitignored
├── skills/
│   ├── review-checklist/
│   │   ├── SKILL.md
│   │   └── references/
│   └── release-helper/
│       └── SKILL.md
├── agents/                    # future role definitions; not required for v1
├── hooks/                     # future portable hooks; not required for v1
├── README.md
├── LICENSE
└── .dotagent/                 # local state/cache; gitignored
    ├── state.json
    ├── journal.json
    └── cache/
```

### 4.1 `skills.json`

Follow Agent Skills discussion #210 where stable and additive:

- `schema_version`;
- package `name`, `version`, `description`, and `license`;
- flat exported `skills` paths;
- dependencies identified by normalized Git URL and explicit ref;
- no agent-specific paths;
- no commands, credentials, or installation state.

The RFC is not yet treated as an immutable external standard. dotagent owns a versioned parser and can read compatible RFC shapes through adapters. Unknown fields are preserved when safe; unknown schema versions fail with an actionable error instead of being guessed.

### 4.2 `skills.lock`

The lockfile pins:

- normalized source identity;
- requested ref;
- immutable 40-character Git commit;
- selected skill paths and discovered names;
- deterministic SHA-256 integrity over allowed skill files sorted by normalized path;
- optional license and origin metadata used by audit output;
- lock format version and generator version.

Branches and tags are inputs. Agents are only materialized from an immutable commit. Moving tags do not update an existing lock without an explicit update operation.

### 4.3 `dotagent.yaml`

This file contains only portable policy not covered by the package RFC:

- default inclusion strategy;
- portable agent targeting by stable slug, when the author deliberately limits a skill;
- dependency selection and optional explicit vendoring strategy;
- verified feature declarations for roles, MCP, and hooks in later versions;
- minimum compatible dotagent schema version.

Agent paths never appear here. A public library may omit agent targeting entirely, allowing the consumer to choose compatible targets.

### 4.4 `dotagent.local.yaml`

The local overlay may replace or add:

- detected/selected agents;
- explicit installation roots;
- materialization preference (`native`, `symlink`, `junction`, `copy`);
- local exclusions;
- environment-variable references;
- private dependencies that must not appear in a public manifest.

Overlay merge is keyed and deterministic. Every merged field records whether it came from portable or local configuration so Skiller can explain why a value is present.

## 5. Public API boundary

The first package is one npm package, not a premature monorepo. It exposes stable subpath exports while sharing one implementation:

```text
@beautyfree/dotagent
@beautyfree/dotagent/schema
@beautyfree/dotagent/library
@beautyfree/dotagent/sources
@beautyfree/dotagent/materialize
@beautyfree/dotagent/audit
@beautyfree/dotagent/adapters/skills-cli
```

Core API rules:

- every mutating operation has a pure/read-only `plan*` counterpart;
- a plan has a deterministic ID/hash and preconditions;
- `apply*` rejects a stale or modified plan;
- filesystem, Git runner, clock, platform, and home directory are injectable ports;
- errors are typed and carry `code`, `message`, `cause`, `remediation`, and safe structured context;
- public results contain no matched secret values;
- no API imports Electron, React, tRPC, Skiller settings, or provider UI.

Initial API sketch:

```ts
parseLibraryManifest(input): Result<LibraryManifest, DotagentIssue[]>
parseLibraryLock(input): Result<LibraryLock, DotagentIssue[]>
loadLibrary(options): Promise<LibrarySnapshot>
scanLibrary(options): Promise<LibraryInventory>
scanMachine(options): Promise<MachineInventory>
planImport(options): Promise<ImportPlan>
planResolve(options): Promise<ResolutionPlan>
planMaterialize(options): Promise<MaterializationPlan>
planReconcile(options): Promise<ReconciliationPlan>
applyPlan(plan, options): Promise<ApplyResult>
auditLibrary(options): Promise<AuditReport>
```

The CLI is a thin adapter over these calls. It may format terminal output and prompt, but it cannot own reconciliation logic unavailable to Skiller.

## 6. Agent capability model

Do not encode support as only a directory path. Each stable agent slug exposes capabilities:

```ts
type SkillDelivery =
  | { kind: 'native-shared'; root: PathTemplate }
  | { kind: 'per-skill-link'; roots: PathTemplate[] }
  | { kind: 'config-path'; config: ConfigPatchDescriptor }
  | { kind: 'copy-only'; roots: PathTemplate[] }

interface AgentDescriptor {
  slug: string
  displayName: string
  platforms: Platform[]
  detection: DetectionRule[]
  skills: SkillDelivery[]
  roles?: RoleDelivery[]
  mcp?: McpDelivery[]
  hooks?: HookDelivery[]
}
```

Rules:

- `.agents/skills` being present does not prove that any specific agent is installed;
- direct readers of `.agents/skills` need no mirror;
- per-agent links are created per skill, never by replacing an entire unmanaged skills directory;
- Windows uses directory junctions or copies where symlink privilege is unavailable;
- unsupported capability surfaces remain unsupported instead of receiving invented compatibility files;
- agent descriptors and aliases are data shipped by dotagent and reused by Skiller.

## 7. Reconciliation and safety

### 7.1 Three-way state

For managed objects compare:

1. last applied base;
2. current canonical library or resolved dependency;
3. current materialized target.

Actions are `create`, `unchanged`, `update`, `remove-managed`, `keep-local`, `adopt-local`, `rename`, and `conflict`. A target containing unmanaged content is never automatically replaced.

### 7.2 Transaction protocol

1. Inspect without writes.
2. Resolve dependencies into an isolated cache.
3. Verify Git commit, paths, schema, hashes, and content limits.
4. Run secret and supply-chain audit.
5. Produce a serializable plan with exact writes/removals and rollback information.
6. Require explicit confirmation at CLI/UI boundary.
7. Revalidate preconditions.
8. Stage files beside the destination where possible.
9. Apply atomically or journal every reversible step.
10. Verify final state and update local ledger only after success.

### 7.3 Trust rules

- never execute skill scripts during resolve, audit, import, or materialize;
- never follow symlinks escaping an allowed skill root;
- never return matched secret values to logs or UI;
- never embed credentials from Git URLs or environment values in portable files;
- reject path traversal, duplicate normalized paths, case-fold collisions, reserved Windows names, oversized files, and excessive file counts;
- external updates are opt-in and show the old/new commit plus audit delta;
- vendoring requires explicit origin and license acknowledgement.

## 8. CLI experience

Initial commands:

```text
beautyfree-dotagent init [path]
beautyfree-dotagent inspect [--json]
beautyfree-dotagent import [--from agents] [--dry-run] [--json]
beautyfree-dotagent resolve [--frozen-lockfile]
beautyfree-dotagent plan [--agents ...] [--json]
beautyfree-dotagent apply <plan-file>
beautyfree-dotagent sync [--pull] [--dry-run]
beautyfree-dotagent status [--json]
beautyfree-dotagent doctor [--json]
beautyfree-dotagent dependency add|update|remove
```

DX requirements:

- zero-write discovery and JSON output work without prompts;
- `--dry-run` and `--json` are composable;
- non-interactive mode never falls back to a destructive default;
- error output always says what failed, why it matters, and the next safe action;
- first useful local-library setup is under five minutes;
- package API and CLI use the same stable identifiers and issue codes.

## 9. Skiller boundary and migration map

Move to dotagent in this order:

| Skiller area | Destination | Migration rule |
| --- | --- | --- |
| manifest schemas and source unions | `schema` | dotagent reads existing Skiller manifest versions through an adapter |
| `skills.sh` lock parsing | `adapters/skills-cli` | preserve defensive versioned parsing; unknown versions remain unsupported |
| secret scanning | `audit` | keep findings value-free and source-relative |
| external Git identity/pin/integrity | `sources` | Skiller delegates resolve and verification |
| inventory/source classification | `library` | UI-specific JSON remains in Skiller mapper |
| agent descriptors and capability paths | `agents` | migrate configs only after parity tests for every existing slug |
| materialization and conflicts | `materialize` | preserve journal/ledger safety before deleting Skiller code |
| Git workspace operations | `library`/`sources` | provider authentication remains in Skiller |

Remain in Skiller:

- Electron lifecycle and platform UI;
- React views and navigation;
- tRPC transport and toast/error presentation;
- GitHub login/repository creation UX;
- app settings, updates, telemetry, marketplace, and release notes;
- background scheduling and user notifications.

During migration, Skiller may use adapter modules that re-export dotagent types. Delete the original implementation only after golden tests prove identical plans for the same fixture.

## 10. Prior art decisions

### Adopt from `yourconscience/dotagents`

- one Git-backed `~/.agents` source of truth;
- native/shared reading when supported and per-skill links otherwise;
- capability-based agent integrations;
- setup import review and preview before removals;
- managed markers and refusal to overwrite unmanaged content;
- portable config plus Git-ignored local overlay;
- pinned external dependencies, deliberate updates, audits, and optional materialization;
- `status` and `doctor` as first-class operations.

### Improve for dotagent

- cross-platform Node runtime including Windows;
- reusable typed library API instead of CLI-owned core;
- deterministic serializable plans used by both CLI and Skiller;
- complete three-way ledger and transaction journal;
- compatibility adapters for Agent Skills RFC and Skills CLI;
- broader agent catalog with verified per-capability support;
- clear public/private library model and explicit vendoring policy;
- issue codes and remediation suitable for both GUI and terminal;
- fixture-driven compatibility and migration tests.

### Do not copy blindly

- Go-specific process and path behavior;
- a fixed list of harnesses without capability/version evidence;
- whole-config replacement where a minimal managed patch is possible;
- assumptions limited to macOS/Linux;
- external repository naming based only on basename;
- any data format that mixes machine paths with portable state.

If source code is copied rather than independently reimplemented, retain MIT attribution and document the exact upstream commit and modified files. The preferred approach is an original TypeScript implementation informed by behavior and tests.

## 11. Agent Skills RFC compatibility

Use discussion #210 as directional input:

- `SKILL.md` remains agent-facing and unchanged;
- distribution metadata stays separate;
- Git URLs provide decentralized package identity;
- tags/branches resolve to immutable commits;
- lockfiles carry integrity and are committed;
- packages export a flat set of skill directories;
- transitive dependency cycles and name collisions are explicit errors.

Do not freeze unresolved RFC choices into an irreversible v1 API:

- per-repository versus per-skill manifest;
- monorepo subpath syntax;
- exact version-resolution algorithm;
- Git versus OCI transport;
- signatures and provenance format;
- final manifest filename.

The compatibility layer is versioned. dotagent's internal model must be richer than any one proposal and losslessly map the subset it claims to support.

## 12. Delivery phases

### Phase 0 — contract and fixtures

- [x] Research dotagents and Agent Skills RFC #210.
- [x] Define package/CLI/repository naming and collision policy.
- [x] Define portable versus local boundaries.
- [ ] Capture golden fixtures from current Skiller manifest v1/v2/v3, Skills CLI lock v3, shared `.agents`, linked agent folders, external Git sources, secret findings, and conflicts.
- [ ] Write JSON/YAML examples and JSON Schemas before publishing package APIs.

Exit: fixtures explain every current Skiller source kind and expected no-write plan.

### Phase 1 — TypeScript foundation

- [x] Create local `beautyfree/dotagent` repository and scoped package metadata (`@beautyfree/dotagent`); remote publication remains intentionally deferred.
- [ ] Establish Node 20+ ESM TypeScript build, Bun tests, lint/format, and release workflow.
- [ ] Implement branded paths/IDs, typed issues, `Result`, filesystem/Git ports, and schema version helpers.
- [x] Implement `skills.json`, `skills.lock`, `dotagent.yaml`, and local-overlay parsing/validation.
- [ ] Publish no package and create no remote until naming and fixtures are reviewed.

Exit: package builds on macOS/Linux/Windows CI and validates fixtures without touching user files.

### Phase 2 — inventory, source resolution, and audit

- [x] Implement bounded canonical library scan and deterministic hashes without following symlinks.
- [ ] Implement Git source normalization, clone/fetch cache, immutable resolution, and integrity. (Isolated clone/fetch, commit pinning, bounded scan, integrity, concurrent deterministic resolution, and stale-plan-safe lock writes are implemented; persistent cache remains.)
- [x] Implement read-only Skills CLI v3 lock adapter with explicit unknown-version refusal.
- [ ] Port value-free secret scanning and safe export rules. (Scanner is shared; complete export-policy extraction remains.)
- [ ] Implement external skill audit without executing content. (Structural/path/size/link audit is implemented; provenance/license reporting remains.)
- [ ] Implement `inspect`, `resolve`, and `doctor` JSON/CLI surfaces. (`inspect` and preview-by-default `resolve` are implemented; `doctor` remains.)

Exit: a public fixture repository resolves reproducibly; tampered content, moving pins, unsafe links, and unsupported schemas fail safely.

### Phase 3 — agent catalog and materialization

- [ ] Define capability descriptors and migrate agent definitions incrementally. (Typed capability contract is implemented; Skiller catalog migration remains.)
- [ ] Implement native-shared, per-skill symlink, Windows junction, config-path, and reviewed copy strategies.
- [ ] Implement machine scan without treating `.agents/skills` as installation evidence.
- [ ] Implement import/materialization plans and managed ownership markers. (Deterministic conflict-safe materialization plan is implemented; machine scan and markers remain.)
- [ ] Implement journaled apply and rollback.
- [ ] Implement `plan`, `apply`, `status`, and first `sync` command.

Exit: clean-machine fixtures materialize to representative agents on all three OSes; unmanaged targets survive every failure case.

### Phase 4 — Skiller extraction and integration

- [x] Add `@beautyfree/dotagent` as an explicit dependency through a reviewed local/workspace source first.
- [x] Replace Skiller manifest parsing with adapter-backed dotagent parsing while preserving v1/v2/v3 behavior.
- [ ] Replace secret/source/integrity logic in vertical slices, one subsystem at a time. (Secret scanning and three-way classification are shared; source resolution and export policy remain.)
- [ ] Map dotagent plans/issues to existing tRPC JSON without exposing internal classes.
- [ ] Compare old/new outputs on golden fixtures and retain a kill switch during migration.
- [ ] Remove duplicated Skiller implementations only after parity and live UX checks.

Exit: CLI and Skiller produce the same plan hash for the same library/machine fixture.

Current integration evidence (2026-08-03): dotagent owns the legacy Skiller schemas, migrations, portable-path checks, duplicate detection, and credential-free remote validation. Skiller retains a compatibility facade so existing imports and repositories do not change. The focused Skiller sync suite passes through the package adapter; full release/platform gates remain open.

### Phase 5 — public/private library UX

- [ ] Create/connect a public or private library repository.
- [ ] Explain exact repository contents before creation.
- [ ] Preview included files, dependency references, exclusions, visibility, and commit.
- [ ] Import an existing public library and choose local agents.
- [ ] Show update/audit diffs for external dependencies.
- [ ] Support explicit owned/dependency/vendored/local-only transitions.
- [ ] Complete three-way conflict and adopt-local UX.

Exit: a user can publish a curated public library, install it on a clean machine, modify an owned skill, and reconcile without losing unmanaged work.

### Phase 6 — ecosystem and stable release

- [ ] Document RFC compatibility and deviations.
- [ ] Add conformance fixtures for third-party skill packages.
- [ ] Publish package provenance, checksums, SBOM, changelog, and migration guide.
- [ ] Add public extension points for new agent descriptors without arbitrary code execution.
- [ ] Consider MCP/roles/hooks only after skills reach the stable acceptance bar.

Exit: v1 format and APIs have documented compatibility guarantees and release evidence for all supported platforms.

## 13. Test strategy

### Unit

- schema versioning and unknown-field behavior;
- Git identity normalization, ref classification, and path selection;
- deterministic integrity across separators and file ordering;
- local overlay merge provenance;
- collision, cycle, traversal, case-fold, and Windows reserved-name detection;
- typed issue serialization without secrets;
- plan determinism and stale-plan rejection.

### Integration

- local bare Git remote for publish/fetch/update;
- exact commit restore on an isolated home;
- unavailable remote with valid committed vendored fallback;
- interrupted apply with journal recovery;
- Skills CLI lock import;
- current Skiller manifest migration fixtures;
- shared `.agents` and independent agent-local copies;
- symlink/junction/copy behavior per platform.

### End-to-end

- initialize private library, inspect, and materialize;
- clone a public library on a clean machine;
- add an external dependency, lock it, update deliberately, inspect audit delta;
- attempt to overwrite unmanaged content and confirm no write;
- local-only, secret, invalid link, unavailable source, and conflict flows;
- CLI JSON plan equals Skiller-rendered plan.

### Release gates

- clean dependency install with scripts disabled where possible;
- test, typecheck, lint, build, package dry-run, and API extractor/diff;
- macOS, Linux, and Windows CI;
- npm package contents inspection;
- signed/provenance-aware publication;
- live Skiller verification on a packaged application, not only dev/HMR.

## 14. Failure modes registry

| Failure | Required behavior |
| --- | --- |
| Remote unavailable | no target writes; use verified vendored content only when lock/integrity match |
| Tag moved | retain locked commit and warn; update only explicitly |
| Manifest newer than parser | stop with supported versions and upgrade action |
| Two skills normalize to same name | block plan and identify both sources |
| Local target unmanaged | offer import/rename/skip; never overwrite |
| Local and canonical both changed | conflict with hashes/diff; no automatic winner |
| Symlink escapes skill root | exclude from copy and show source-reference option |
| Secret candidate | block portable write; show file/line/rule without value |
| Process interrupted | recover or roll back from journal on next start |
| Windows symlink unavailable | plan junction/copy fallback explicitly |
| Private dependency auth missing | explain required Git credential path; never capture token |
| Public library vendors incompatible license | block or require explicit policy acknowledgement |
| CLI and Skiller package versions differ | schema/API compatibility check before apply |

## 15. Scope controls

In v1:

- skills and their portable distribution;
- Git and local filesystem sources;
- public/private repositories;
- CLI plus reusable TypeScript API;
- import, resolve, audit, plan, apply, status, doctor;
- Skiller integration;
- macOS, Linux, Windows.

Deferred until skills are stable:

- automatic execution of hooks;
- MCP configuration synchronization;
- role/agent rendering;
- central registry or hosted account service;
- OCI transport;
- cryptographic publisher identity beyond available Git/npm provenance;
- real-time background merge;
- team policy server.

The schemas reserve no fake fields for deferred surfaces. Add them through explicit future schema versions.

## 16. Acceptance criteria

- [ ] `@beautyfree/dotagent` can be imported by Skiller without Electron or UI dependencies.
- [ ] CLI and Skiller generate byte-equivalent serialized plans from the same fixtures.
- [ ] A repository with owned skills can be public and cloned without exposing local state.
- [ ] External dependencies are pinned to immutable commits and verified by content integrity.
- [ ] A clean machine restores selected skills to supported agents without manual path editing.
- [ ] `.agents/skills` is never used as proof that a specific agent is installed.
- [ ] Unmanaged targets and unresolved conflicts are never overwritten.
- [ ] Secret values, credentials, and absolute user paths cannot enter portable outputs.
- [ ] Windows, Linux, and macOS behavior is tested before stable release.
- [ ] Existing Skiller libraries migrate through versioned adapters without silent format rewriting.
- [ ] Existing Skills CLI locks are input adapters, not dotagent's source of truth.
- [ ] Public library authors can choose dependency references or explicit vendoring with origin/license visibility.
- [ ] Every mutating UI and CLI flow has a no-write preview and actionable failure state.

## 17. Decision log

| Date | Decision | Rationale |
| --- | --- | --- |
| 2026-08-03 | Repository is `beautyfree/dotagent`; npm is `@beautyfree/dotagent` | preserves requested product name while avoiding occupied unscoped npm name |
| 2026-08-03 | TypeScript/JavaScript implementation, Node 20+ runtime | reusable from Electron, CLI, CI, and all supported desktop platforms |
| 2026-08-03 | One package with subpath exports before considering a monorepo | keeps API/core/CLI coherent and avoids premature package choreography |
| 2026-08-03 | Skiller imports core APIs; it does not shell out for product behavior | shared types and plans remain exact; CLI is only another adapter |
| 2026-08-03 | Canonical Git library; agent folders are materialized views | enables public curated libraries and safe multi-agent delivery |
| 2026-08-03 | Follow RFC #210 through a versioned compatibility adapter | uses community direction without treating an open discussion as final law |
| 2026-08-03 | Portable manifest, local overlay, and local ledger are separate | prevents machine paths, secrets, and personal decisions from leaking publicly |
| 2026-08-03 | References are default; vendoring is explicit | preserves provenance and avoids accidental redistribution/license problems |
| 2026-08-03 | Build from behavior and tests; attribute any literal upstream code | uses dotagents as prior art while keeping a maintainable TypeScript architecture |

## 18. Immediate implementation checklist

- [ ] Create the local `beautyfree/dotagent` repository workspace.
- [ ] Add package metadata, TypeScript build, Bun tests, and collision-free CLI binary.
- [ ] Add schema/types for manifest, lock, portable config, local overlay, issues, and plans.
- [ ] Add parsers with fixtures for valid, future-version, unsafe-path, and duplicate-name cases.
- [ ] Add deterministic integrity hashing for an in-memory fixture tree.
- [ ] Add README explaining library versus local state and public/private use.
- [ ] Add an attribution/prior-art section referencing dotagents and Agent Skills RFC #210.
- [ ] Add a Skiller local dependency only after the first package tests pass.
- [ ] Migrate one low-risk vertical slice first: manifest/source schemas and parsing.
- [ ] Verify Skiller tests and typecheck before moving further logic.
