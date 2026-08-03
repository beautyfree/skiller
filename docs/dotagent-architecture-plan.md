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
    ├── import-journal.json
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

`config-path` is deliberately not part of the shipped v1 union. It can be added
only with a concrete data-only patch schema, a validated agent that requires it,
minimal-write semantics, and round-trip fixtures proving unrelated user config
survives. A placeholder would falsely advertise support that cannot be applied safely.

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
beautyfree-dotagent import [path] --owned skill=path [--candidate-file candidates.json] --out plan.json
beautyfree-dotagent resolve [path] --out plan.json
beautyfree-dotagent plan [--agents ...] [--json]
beautyfree-dotagent apply <plan-file> --yes
beautyfree-dotagent git-init [path] [--remote url] --out plan.json
beautyfree-dotagent clone <url> <path> --out plan.json
beautyfree-dotagent commit [path] --message text --out plan.json
beautyfree-dotagent sync [path] --pull|--push --out plan.json
beautyfree-dotagent status [--json]
beautyfree-dotagent doctor [--json]
beautyfree-dotagent recover [path] --yes
```

DX requirements:

- zero-write discovery and JSON output work without prompts;
- preview commands and `--json` are composable; every write is a separate `apply --yes` operation;
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
- [x] Capture golden fixtures from current Skiller manifest v1/v2/v3, Skills CLI lock v3, shared `.agents`, linked agent folders, external Git sources, secret findings, and conflicts.
- [x] Write JSON/YAML examples and JSON Schemas before publishing package APIs. Generated schemas are committed and checked byte-for-byte for drift.

Exit: fixtures explain every current Skiller source kind and expected no-write plan.

### Phase 1 — TypeScript foundation

- [x] Create local and public `beautyfree/dotagent` source repository with scoped package metadata (`@beautyfree/dotagent`); npm publication remains intentionally deferred.
- [x] Establish Node 20+ ESM TypeScript build, Bun tests, lint/format, package-content verification, and a guarded release workflow.
- [x] Implement normalized portable paths, stable plan IDs, typed issues, `Result`, schema constants, and injectable machine/Git ports.
- [ ] Generalize remaining Node filesystem boundaries only where a real test seam needs substitution; do not add a ceremonial all-purpose filesystem interface to pure planners.
- [x] Implement `skills.json`, `skills.lock`, `dotagent.yaml`, and local-overlay parsing/validation.
- [x] Review naming, then create the public `beautyfree/dotagent` source repository without publishing an npm package or stable release.

Exit: package builds on macOS/Linux/Windows CI and validates fixtures without touching user files.

Current foundation evidence (2026-08-03): the public repository is `https://github.com/beautyfree/dotagent`. The current core commit is `1332dda`; CI run `30817448727` completed the Ubuntu, macOS, and Windows jobs successfully. The same commit passes 107 tests, generated-schema drift checks, a committed API-declaration snapshot for 30 typed exports, and package inspection for 160 files/33 export paths locally. It includes the shared, runtime-validated import-decision contract (`owned`, `dependency`, `vendored`, `local-only`, `excluded`), deterministic transactional reconciliation, atomic multi-file library updates, identified Skiller compatibility publish plans, and generic reviewed Git fast-forward plans. CI uses a frozen install with lifecycle scripts disabled and also runs inspect/audit smoke checks. `release:check` inspects the dry-run npm tarball and all exported package targets; the release-artifact builder produces the exact tarball, SHA-256 checksum, CycloneDX SBOM, and release manifest. A manual OIDC publish workflow exists, but npm publication remains intentionally blocked by `private: true` and the placeholder version until the stable-release gates are complete.

### Phase 2 — inventory, source resolution, and audit

- [x] Implement bounded canonical library scan and deterministic hashes without following symlinks.
- [x] Implement Git source normalization, persistent clone/fetch cache, immutable resolution, and integrity.
- [x] Implement read-only Skills CLI v3 lock adapter with explicit unknown-version refusal.
- [x] Port value-free secret scanning and safe export rules. `planSkillExport` now owns deterministic file selection, limits, exclusions, link refusal, hashes, and value-free findings; Skiller is a compatibility facade.
- [x] Implement external structural and license audit without executing content.
- [x] Implement `inspect`, `resolve`, `audit`, and `doctor` JSON/CLI surfaces.
- [x] Prepare immutable dependency checkouts from the lock/mirror cache and feed them into the same materialization inventory as owned skills.

Exit: a public fixture repository resolves reproducibly; tampered content, moving pins, unsafe links, and unsupported schemas fail safely.

### Phase 3 — agent catalog and materialization

- [x] Define capability descriptors and migrate bundled agent definitions. dotagent owns the provider-neutral catalog for all 49 bundled slugs; Skiller TOML retains install/docs/UI metadata and has exact capability parity coverage. Explicit custom TOML entries use the compatibility adapter.
- [x] Implement native-shared, per-skill symlink, Windows junction, and reviewed copy strategies.
- [x] Refuse to advertise `config-path` until a real agent integration supplies a validated minimal-patch contract and round-trip fixtures.
- [x] Implement machine scan without treating `.agents/skills` or a skills-only marker as installation evidence.
- [x] Implement import/materialization plans and managed ownership markers. Canonical import distinguishes owned, dependency, local-only, and excluded candidates; apply rechecks secrets, hashes, and unmanaged targets through a durable journal.
- [x] Implement journaled apply, rollback, stale-source/target validation, and interrupted-run recovery.
- [x] Implement `plan`, `apply`, `status`, and first `sync` command. Git clone/commit/pull/push use serialized, stale-checked plans and the same confirmed `apply` boundary; clone validates in staging before an atomic destination rename.

Exit: clean-machine fixtures materialize to representative agents on all three OSes; unmanaged targets survive every failure case.

### Phase 4 — Skiller extraction and integration

- [x] Add `@beautyfree/dotagent` as an explicit dependency, first locally and then as an immutable Git commit with committed build artifacts until npm publication.
- [x] Replace Skiller manifest parsing with adapter-backed dotagent parsing while preserving v1/v2/v3 behavior.
- [x] Replace secret/source/integrity logic in vertical slices, one subsystem at a time. Secret scanning, safe export policy, three-way classification, immutable dependency resolution, canonical Git workspace operations, publish-manifest planning/merge, bundled restore reconciliation, and atomic publish writes are shared; Skiller retains product discovery and provider/UI mapping.
- [x] Map dotagent plans/issues to existing tRPC JSON without exposing internal classes. Machine inventory, doctor, audit, shared discovery suggestions, managed status, import, publish, connection, and reconciliation use explicit renderer JSON contracts; tests cover path redaction, and remote review exposes only safe identities plus deterministic plan IDs, never core paths, secret values, or journal internals.
- [ ] Compare old/new outputs on golden fixtures and retain a kill switch during migration. (All configured slugs project uniquely, the skills-only detector invariant has parity coverage, canonical owned/dependency publish-clone-restore fixtures pass, and bundled restore create/conflict/unchanged outputs are compared directly against the legacy implementation. `SKILLER_SYNC_RECONCILE_ENGINE=legacy` remains the temporary rollback switch; the full legacy source/conflict matrix and live telemetry period remain.)
- [ ] Remove duplicated Skiller implementations only after parity and live UX checks.

Exit: CLI and Skiller produce the same plan hash for the same library/machine fixture.

Current integration evidence (2026-08-03): dotagent owns the legacy Skiller schemas, migrations, portable-path checks, duplicate detection, credential-free remote validation, identified publish-manifest planning/merge, bundled-library reconciliation, the multi-target publish transaction, and generic Git clone/fast-forward review/apply. Skiller retains compatibility facades so existing imports and repositories do not change. Restore maps the local ledger into the shared three-way plan and retains an isolated legacy engine behind an environment kill switch. Publish maps local discovery into shared candidates, then delegates source inspection, manifest construction, reviewed granular merge, atomic writes, rollback, and durable recovery to dotagent. Remote review now fetches metadata but inspects the exact remote commit in a disposable detached worktree: the managed library remains byte-for-byte on its current commit until the user applies both the reviewed Git workspace plan and the path-redacted reconciliation plan. Repository connection and GitHub creation also have separate no-write review contracts; changing the remote, local destination, selected agents, repository name, or visibility invalidates confirmation. The hidden Settings-era sync UI and its parallel publish/clone/pull/restore RPC routes have been removed, leaving Sync Center as the single product flow. Every remaining Sync Center publish, restore, conflict, adoption, keep-local, connection, and repository-creation mutation must present the exact reviewed ID or explicit recovery journal state. Focused parity, deterministic-plan, ledger-conflict, stale-preview, no-write clone/remote review, atomic publish, and old/new journal recovery tests pass; live packaged-app gates remain open.

Latest runtime evidence (2026-08-03): Skiller pins dotagent commit `1332dda`, including the authoritative 49-agent catalog, versioned schemas/fixtures, dependency audit deltas, shared portable-plus-local agent routing, reviewed clone/init/resolve/reconcile/library-update/Git-fast-forward plans, shared owned-skill export policy, identified Skiller publish planning/merge, shared import decisions, third-party conformance fixtures, and the public API snapshot gate. Newly created Sync Center repositories use canonical `skills.json`, `skills.lock`, `dotagent.yaml`, and `skills/` content and delegate canonical Git operations, atomic publish writes, publish-manifest planning, bundled restore reconciliation, and remote clone/fast-forward review to dotagent; existing `skiller-sync.yaml` repositories remain readable and writable through versioned adapters. The Skiller adapter tests prove serialized import-plan equality, restore-preview parity against the legacy engine, deterministic publish and remote-workspace plan mapping, stable path-redacted reconciliation IDs, preservation of untouched remote skills during granular updates, and no managed-worktree change before explicit apply, stale clone refusal, and reviewed GitHub name/visibility. The full 109-test suite with 392 assertions, typecheck, and production Electron/Vite build pass after the current pin. A fresh live renderer review confirmed the three-step Sync Center, per-skill outcome controls, vendored-license disclosure, and license-gated continuation; native backend preview remains covered by integration tests because the standalone browser renderer has no Electron RPC bridge. Packaged-app verification remains a separate release gate.

### Phase 5 — public/private library UX

- [x] Create/connect a private-by-default GitHub or custom Git library repository; custom remotes remain provider-neutral.
- [x] Explain the repository model and exact owned/reference/excluded outcomes before creation.
- [x] Preview included files, immutable dependency references, exclusions, secret blockers, and destination before commit/push.
- [x] Import an existing public or private canonical library from Sync Center and choose detected agents through a private `dotagent.local.yaml` overlay. The managed clone is reviewed before any agent folder changes.
- [x] Show immutable dependency update/audit diffs, including old/new commit, license change, and selected skills added or removed.
- [x] Support explicit owned/dependency/vendored/local-only transitions. The per-skill review defaults to owned for local skills and immutable dependencies for external skills, while exposing deliberate vendoring, ownership conversion, and local-only outcomes; vendoring requires upstream license metadata and preserves commit/integrity provenance.
- [x] Complete three-way conflict and adopt-local UX. Conflicts start without a selected winner and offer explicit use-library, publish/adopt-local, or keep-local actions; converting an external dependency to owned requires the dedicated adopt-local mutation and cannot happen through the normal publish path.

Exit: a user can publish a curated public library, install it on a clean machine, modify an owned skill, and reconcile without losing unmanaged work.

### Phase 6 — ecosystem and stable release

- [x] Document RFC compatibility and deviations.
- [x] Add conformance fixtures for third-party repository-root and multi-skill package layouts.
- [ ] Publish package provenance, checksums, SBOM, changelog, and migration guide. (All artifacts and docs are generated and release-gated; registry publication remains intentionally disabled.)
- [x] Add public data-only extension points for new agent descriptors without arbitrary code execution.
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
- test, typecheck, lint, build, package dry-run, and committed public-declaration snapshot/diff;
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

- [x] `@beautyfree/dotagent` can be imported by Skiller without Electron or UI dependencies.
- [x] CLI core and Skiller generate byte-equivalent serialized import plans and plan IDs from the same discovery fixture.
- [x] A repository with owned skills can be public and cloned without exposing local state.
- [x] External dependencies are pinned to immutable commits and verified by content integrity.
- [x] A clean machine restores selected skills to supported agents without manual path editing.
- [x] `.agents/skills` is never used as proof that a specific agent is installed.
- [x] Unmanaged targets and unresolved conflicts are never overwritten.
- [x] Secret values, credentials, and absolute user paths cannot enter portable outputs.
- [x] Windows, Linux, and macOS behavior is tested before stable release.
- [x] Existing Skiller libraries migrate through versioned adapters without silent format rewriting.
- [x] Existing Skills CLI locks are input adapters, not dotagent's source of truth.
- [x] Public library authors can choose dependency references or explicit vendoring with origin/license visibility.
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
| 2026-08-03 | Canonical import is a reviewed journaled plan, not folder copying | preserves source provenance, keeps local-only content local, and makes crashes and stale previews recoverable |
| 2026-08-03 | New Sync Center repositories are canonical dotagent; legacy Skiller repositories use a versioned compatibility path | stops producing a second portable format without silently rewriting existing user repositories |
| 2026-08-03 | Git workspace/authentication are separate layers | dotagent owns provider-neutral reviewed Git plans; Skiller retains GitHub CLI sign-in and repository-creation UX without receiving tokens |
| 2026-08-03 | Bundled capability data is authoritative in dotagent | CLI and Skiller now share 49 agent roots, detection markers, shared-reader declarations, and project paths; Skiller keeps only product install/docs/UI metadata and explicit custom extensions |
| 2026-08-03 | Portable per-skill routes and private machine selection are intersected in dotagent | a public library can express intended routing while each computer restricts it without publishing local preferences or inventing unsupported targets |
| 2026-08-03 | Public library creation requires an explicit license | public audit remains enforceable and Skiller never silently licenses a user's work |
| 2026-08-03 | Clone is a serialized preview/apply operation | connecting an existing library cannot mutate a managed destination before the reviewed plan is revalidated |
| 2026-08-03 | Owned-skill export policy lives in dotagent | Skiller and future CLI/UI consumers cannot diverge on excluded files, content limits, links, hashes, or secret locations |
| 2026-08-03 | Agent delivery descriptors expose only verified roots | an unimplemented `config-path` variant would advertise unsafe behavior; it remains absent until backed by a real minimal-patch contract and round-trip fixture |
| 2026-08-03 | Git identity normalization is a dependency-free leaf module | config, resolution, and workspace plans share one credential-free identity without importing higher-level source logic |
| 2026-08-03 | Third-party layouts and public declarations are committed release fixtures | root-skill/multi-skill compatibility and package API changes now fail CI unless deliberately reviewed |
| 2026-08-03 | Import outcomes are a shared dotagent contract | Skiller and the CLI/core use the same runtime-validated owned/dependency/vendored/local-only/excluded decisions instead of UI-only booleans |
| 2026-08-03 | Dependency-to-owned conversion is an explicit conflict action | normal publish rejects source conversion; only the reviewed adopt-local operation may turn an external skill into an owned canonical copy |
| 2026-08-03 | Bundled restore reconciliation is a dotagent plan/apply transaction | Skiller and the CLI/core share deterministic three-way classification, stale-plan protection, explicit remote decisions, and durable recovery; Skiller retains only tRPC/UI mapping and a temporary legacy kill switch |
| 2026-08-03 | Portable publish writes are one dotagent library-update transaction | every reviewed bundle and root file is staged before replacement, the complete set rolls back on failure, file bodies stay outside the serializable plan, and Skiller recovery covers both restore and publish journals |
| 2026-08-03 | Skiller compatibility publish policy lives in dotagent | candidate normalization, source inspection, manifest construction, and reviewed granular merge are shared; Skiller retains only discovery, provider, tRPC, and UI mapping |
| 2026-08-03 | Every Sync Center decision carries its reviewed plan ID | publish, restore, conflict, adopt, and keep-local actions reject stale source/target/remote state instead of silently rebuilding a different plan at mutation time |
| 2026-08-03 | Remote review uses a disposable exact-commit checkout | fetching may update Git metadata, but preview never advances the managed library; apply requires both the reviewed fast-forward plan and the resulting reconciliation plan |
| 2026-08-03 | Sync Center is the only library setup surface | the hidden Settings-era flow and its duplicate RPC routes were removed so new safety rules cannot be bypassed by stale product code |
| 2026-08-03 | Repository creation and connection are separately reviewed | GitHub name/visibility and Git remote/destination/agent selection receive deterministic IDs and are revalidated before any repository or managed checkout is created |

## 18. Immediate implementation checklist

- [x] Create the local and public `beautyfree/dotagent` repository workspace.
- [x] Add package metadata, TypeScript build, Bun tests, and collision-free CLI binary.
- [x] Add schema/types for manifest, lock, portable config, local overlay, issues, and current plans.
- [x] Add parsers with coverage for valid, future-version, unsafe-path, duplicate-name, and root-skill cases.
- [x] Add deterministic integrity hashing for bounded skill trees.
- [x] Add README explaining library versus local state and public/private use.
- [x] Add an attribution/prior-art section referencing dotagents and Agent Skills RFC #210.
- [x] Add a Skiller immutable Git dependency only after the first package tests pass.
- [x] Migrate the first vertical slices: manifest/source schemas, secret scanning, reconciliation, diagnostics, and discovery.
- [x] Verify full Skiller tests, typecheck, and production build after each pinned runtime slice.
- [x] Add explicit dependency/vendored/owned/local-only review outcomes and preserve vendored origin, integrity, and license in canonical repositories.
- [x] Add explicit three-way conflict choices, including guarded dependency-to-owned adoption, without a default conflict winner.
- [x] Migrate bundled restore preview/apply/recovery to the shared dotagent reconciliation contract with parity fixtures and a temporary kill switch.
- [x] Migrate portable publish staging/replacement/recovery to the shared dotagent library-update contract.
- [x] Migrate Skiller compatibility publish planning and granular manifest merge to the shared adapter.
- [x] Bind Sync Center publish and reconciliation mutations to the exact reviewed plan ID.
- [x] Keep remote review out of the managed worktree and reject apply when either the reviewed Git commit or reconciliation changes.
- [x] Remove the hidden Settings-era sync implementation and require reviewed plans for GitHub repository creation and existing-library connection.
