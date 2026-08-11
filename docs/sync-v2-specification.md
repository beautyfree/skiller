# Sync v2 — portable skill library

> Status: active product specification.  
> Last updated: 2026-08-03

This document is the durable source of truth for Skiller's Sync Center.  It records the product intent, technical decisions, known limitations, and acceptance criteria. Update the relevant checklist and decision log whenever this area changes.

## Working agreement

Before changing Sync Center, its sync protocol, agent detection, or skill materialization, read this document and reconcile the proposed change with the architecture decisions and acceptance criteria below. Do not mark an item complete merely because code compiles: record the evidence from automated checks and, for user-facing flows, live desktop verification. If a new decision changes the model, add it to the decision log in the same change.

## Product intent

People invest time assembling an effective set of agent skills. That set is part of their working knowledge: it should survive a new computer, be available to their chosen agents, and be shareable deliberately without exposing private material.

Skiller must provide a personal skill library that can be backed by a private or public Git remote (GitHub, GitLab, self-hosted Git, or another compatible remote), restored on another machine, and managed without destroying local work.

**Scope boundary:** Agent Library inventories only global skills: the shared
store and supported agents' global skill directories. Project-local skills are
owned by their project repository and are deliberately never scanned, shown,
or published by this feature.

“Protect” is not the primary concept. The product is about carrying, preserving, and optionally sharing a personal skill library.

## What exists today

The current Sync Center is a safe export-and-restore foundation, not yet full bidirectional synchronization.

- Selected local skills can be copied into a managed Git workspace as bundled content.
- Git-backed skills can be represented as a pinned reference (`repository`, `commit/ref`, `skill path`) instead of copied content.
- Manifest v3 has a distinct `skills_sh` dependency type. During initial library creation, a matching Skills CLI lock entry is resolved to an immutable Git commit and stored as provenance instead of copied as a bundle.
- Source-aware entries created from the local inventory also store a content hash. A changed local copy or a mismatched pinned checkout is a conflict, not an implicit replacement.
- Export rejects symlinks, excludes common generated folders, limits file count and size, and scans copied text files for likely secrets.
- Restore is staged and reviewed; it is intended not to overwrite unmanaged files blindly.
- The scanner reads the `skills.sh` lockfile format currently present on the machine and the Sync Center uses matching provenance to choose a source-aware strategy.
- External restore is now conservative: an absent skill can be installed, an already matching pinned origin is left untouched, and any local skill with a different origin or revision is a conflict rather than an overwrite.
- Before either restore route applies bundled skills, selected external Git/`skills.sh` sources are cloned and integrity-checked in temporary directories. A bad pin or unavailable source stops the operation before it changes the managed library.
- The pinned Git restore path has an isolated clean-home integration test: it clones an exact local commit, verifies the reviewed content hash, writes provenance, materializes the selected agent’s skill path, and proves that a mismatched source leaves the new library untouched.

### Current gaps

- The review list identifies local, `skills.sh`, and Git-provenanced skills before selection; known provenance is automatically retained as a source reference. There is not yet an advanced per-skill strategy editor for deliberately changing that choice.
- Bundled skills have three-way base/local/remote review. External pinned skills have safe create/unchanged/conflict states, but no in-app diff or merge workflow yet.
- An unresolved external-source conflict is intentionally blocked instead of being replaced. Review shows the source and pin and can record a machine-local "keep this external local copy" decision. That decision expires if the remote origin or pin changes. An in-app diff/merge and a deliberate "adopt as local" action are still needed.
- The clean-second-device fixture currently covers bundled restore and an isolated local-Git external source. Hosted Git authentication and each supported OS still need live verification.
- A skill present in the shared `.agents/skills` library must not be attributed to every compatible agent. Only actual links or independent copies establish that relationship.
- A direct skill in an agent's global directory remains visible even if that
  directory is the only evidence of the agent. This affects inventory only;
  it does not claim the agent is installed or make it a write target.

## Ecosystem findings

### `skills.sh` / Vercel Skills CLI

`npx skills` is a package manager and installer for agent skills, not a complete multi-device synchronization service.

- It supports many agents, including Codex and Claude Code, global and project scopes, GitHub/GitLab/any Git URL sources, and canonical-copy plus per-agent symlink installation.
- Its recommended symlink mode establishes one source copy and links each selected agent to it; per-skill links are safer than replacing an entire `skills/` directory.
- It tracks installed provenance in a lockfile, but a clean-machine restore command from that lockfile is not a stable, completed capability. Its own issue tracker documents this gap.
- The lockfile schema should be treated as an import adapter, not as Skiller's authoritative domain model: it may evolve independently.

### Relevant prior art

- `dotagents` is the closest product reference: one private `~/.agents` Git repository, detected harnesses, managed materialization, previews before overwrite, per-machine local overlays, and pinned/audited external skills.
- The Agent Skills ecosystem is converging on an explicit distribution manifest plus a lockfile. `SKILL.md` remains agent-facing content; source, version, integrity, and installation targets belong in tooling metadata.
- There is no mature, stable library that can be embedded to solve Skiller's full product problem. Existing tools are whole competing managers or narrow installer CLIs. Skiller should integrate compatible tooling and formats, not outsource its source of truth.

### Research sources

- Vercel Skills CLI: <https://github.com/vercel-labs/skills>
- Vercel issue documenting the missing clean-machine restore from lockfile: <https://github.com/vercel-labs/skills/issues/549>
- `dotagents` architecture and safety model: <https://github.com/yourconscience/dotagents>
- Agent Skills manifest/lockfile RFC: <https://github.com/agentskills/agentskills/discussions/210>

## Architecture decisions

### 1. Canonical model: library, not agent folders

The canonical object is a **skill library**. Agent-specific folders are materialized views.

- `.agents/skills` is a shared library location where agents support it.
- Agent folders are shown only when Skiller observes a real symlink or an independent copy.
- Do not duplicate a shared skill per agent in inventory, statistics, or the remote library.

### 2. Source kinds

Every managed skill has exactly one source kind.

| Kind | Stored remotely | Restore strategy |
| --- | --- | --- |
| `bundle` | Skill files and file hashes | Stage then materialize a managed copy/link |
| `skills_sh` | `skills.sh` source/provenance, pinned revision/path, integrity when available | Reinstall or materialize from the pinned source using a compatible adapter |
| `git_reference` | Git URL, immutable commit, skill path, integrity | Fetch the pinned source; never flatten a repository bundle by default |
| `local_only` | Nothing | Clearly explain that it stays on this device |
| `excluded` | Nothing | Explain why: possible secret, unreadable path, unsupported file type, or user choice |

Changing kind is an explicit reviewed operation. A `skills.sh` or Git source must never silently become an opaque copy merely because it appeared in an agent directory.

### 3. Manifest and state separation

The remote library contains:

- a versioned, human-readable Skiller manifest describing selected skills, origin, immutable revision/path, hashes, and intended materialization;
- bundled skill files only for author-owned/local content explicitly chosen for backup;
- no machine-specific absolute paths, tokens, user names, credentials, caches, or agent-generated system folders.

Machine-local state contains:

- the last successfully applied manifest revision and per-skill base hashes;
- local selection/materialization choices and non-shareable local overrides;
- credentials and authentication state.

Machine-local state is never pushed to the library remote.

### 4. Sync is a reviewed three-way operation

For every managed skill compare: last applied base, local state, and remote state.

| Situation | Default action |
| --- | --- |
| Remote changed only | Offer to apply after preview |
| Local changed only | Offer to publish after preview |
| Both changed identically | Mark clean |
| Both changed differently | Block automatic application; show diff and let the user choose/merge |
| Local unmanaged skill conflicts with managed target | Never overwrite; require an explicit import, rename, replace, or skip decision |

All writes must stage into a temporary sibling directory, validate content and hashes, then perform an atomic replacement where the platform allows it.

### 5. Secret and trust boundary

- Scan bundles before export and show exact skill, relative file path, line, and matched rule before any publish.
- Do not auto-upload a detected possible secret.
- External skills are prompt/code supply-chain inputs. Show origin and immutable revision before first installation and on every update.
- A detected symlink escaping a skill root is not a broken user skill; it is a reason not to copy that directory. Offer a Git-reference route when provenance is known.

## User flow

1. **Library overview** — explain in one sentence that a selected library can be stored on the user’s chosen Git remote and restored elsewhere. Nothing is uploaded at this point.
2. **Review** — present a performant inventory grouped by source kind, not by every nominally compatible agent. Skill details are readable in place. Skipped entries state the reason and the available action.
3. **Choose strategy** — sensible default: include all safe, locally authored/shared-library skills; keep known external `skills.sh`/Git skills as references. Advanced controls allow per-skill changes.
4. **Choose destination** — GitHub uses an existing `gh` sign-in to create a private repository; Skiller never receives or stores its token. A custom Git URL is an explicit alternative for GitLab, enterprise, or self-hosted remotes, whose own visibility and access rules apply. State this before creation.
5. **Publish preview** — list created/updated files and references, secret findings, and the exact commit message before Git writes.
6. **Sync status** — show clear states: up to date, local changes ready to publish, remote changes ready to review, conflict needs decision, and excluded/not managed.
7. **Restore on a new device** — clone/connect, inspect the plan, materialize only selected managed skills to detected agents, and leave all unmanaged folders untouched.

## Delivery plan

- [x] Create a safe bundled export path with limits, secret detection, and staged restore.
- [x] Detect `skills.sh` lockfile provenance as input data.
- [x] Support a lower-level pinned Git reference representation.
- [ ] Audit and normalize all agent definitions against the `skills.sh` supported-agent/path model.
- [~] Define and version Skiller’s manifest schema plus machine-local state schema and migration rules. Manifest v3 and v1/v2 read migration exist; durable machine-local source/state migration remains.
- [~] Make source classification (`bundle`, `skills_sh`, `git_reference`, `local_only`, `excluded`) first-class in scanner, UI, preview, and publish. Local, `skills_sh`, Git references, and safe scanner exclusions are covered; `local_only` and an explicit user-managed exclusion choice remain.
- [~] Import existing `skills.sh` locks defensively, with versioned adapters and clear fallback when a lock entry cannot be resolved. A non-mutating v3 adapter is implemented; an unknown schema is deliberately ignored rather than guessed. UI disclosure and future adapters remain.
- [ ] Implement `skills.sh`-compatible materialization for references without requiring a global CLI installation where possible.
- [x] Make recognized Git-reference publishing/restoration available in the main Sync Center flow.
- [~] Implement pull/push planning from base/local/remote hashes and a conflict-resolution UI. Bundles have reviewed three-way decisions; external references are safely blocked on a mismatch until an interactive resolution is built.
- [x] Persist a local managed-object ledger so bundled restores can distinguish Skiller-owned artifacts from user files.
- [x] Add a guided GitHub/GitLab repository path without giving Skiller an OAuth
  token: after explicit user intent, the provider's own `gh`/`glab` session can
  list writable repositories or create one reviewed private destination. Keep
  credential-free custom Git remotes first-class for self-hosted servers.
- [~] Add end-to-end tests for macOS, Linux, and Windows path/link behavior, including a clean second-device restore fixture. The local-Git clean-home fixture covers bundle and pinned-source safety; OS-specific path/link behaviour remains.
- [ ] Perform live UX verification for new library, publish, pull, conflict, secret finding, invalid symlinked repo, `skills.sh` reference, and shared `.agents` cases.

## Acceptance criteria

Sync v2 is not complete until all are true:

1. A user can identify what will be uploaded, where it will be uploaded, and whether it is private/public before creating a remote library.
2. A clean second device can reproduce selected skills and their intended agent availability from the manifest without manual path surgery.
3. A skill installed via `skills.sh` preserves provenance and is not unnecessarily duplicated as a bundle.
4. A shared `.agents/skills` skill is counted once and is not falsely attributed to multiple agents.
5. A local modification, a remote modification, and a conflict have distinct, understandable UI states.
6. No managed operation silently overwrites an unmanaged file or an unresolved conflict.
7. Possible secrets, escaped symlinks, unreadable folders, and unsupported artifacts state whether they are dangerous, skipped, or actionable — with a concrete next step.
8. The solution works with GitHub, another hosted Git provider, and a self-hosted Git remote without storing credentials in the library.
9. Build/tests and live desktop-path verification pass on each supported OS before release.

## Acceptance evidence (2026-08-03)

| Criterion | Current evidence | Status |
| --- | --- | --- |
| Destination and visibility are explained before creation | Sync Center destination step distinguishes private GitHub creation, existing `gh` sign-in, and custom-server visibility. | Needs installed-app review |
| Clean-device restore reproduces skills and routing | Isolated-home integration test restores a pinned local Git skill, validates its hash and provenance, and materializes an agent path. | Automated coverage; other OSes pending |
| `skills.sh` provenance is retained | v3 lock adapter plus live read-only preview of an installed skill produces a pinned `skills_sh` manifest entry without bundled files. | Verified locally; installed-app review pending |
| Shared `.agents/skills` is counted once | Scanner/inventory tests cover shared paths and explicit aliases. | Automated coverage |
| Local/remote/conflict states are distinct | Three-way ledger tests, external conflict policy, and source-aware review data cover the states. | Automated coverage; UX review pending |
| Unmanaged content is never overwritten | Restore journal, bundle conflict tests, external conflict blocking, and staged external-source verification. | Automated coverage |
| Unsafe folders/secrets are actionable | Secret locations and safe skipped-folder instructions are rendered in review. | UX review pending |
| Portable remotes do not carry credentials | Manifest URL validation and generic local Git remote tests pass. | Hosted/self-hosted live remotes pending |
| Supported OS release path | macOS development checks pass. | Linux/Windows and installed release verification pending |

### Verification addendum (2026-08-07)

- The exact-path Sync Center review shows GitHub, GitLab, and another Git server
  as distinct destination choices. Selecting a provider is required before any
  repository-list request; the live review did not authenticate, create, push,
  or publish anything.
- `dotagents@0.2.0` adds an equivalent guided CLI route and saves only the
  credential-free selected remote in an OS-native Device profile. Subsequent
  `sync` and `status` invocations do not ask the user to remember a library path
  or remote URL. Its 173-test check, package-content validation, and packed
  consumer smoke pass.
- A clean isolated Skiller copy using that exact packed `dotagents@0.2.0`
  tarball passed fresh dependency installation, TypeScript checks, all 178
  tests, and production build. The public Skiller pin is deliberately still
  marked blocked until this candidate is published as an immutable dependency.
- Native Ubuntu and Windows runtime verification, an authenticated provider
  creation, and complete visible state coverage remain open release gates; none
  is inferred from local package or cross-build checks.

## Decision log

| Date | Decision | Why |
| --- | --- | --- |
| 2026-08-03 | Do not present current export as complete synchronization | It is a safe backup/export foundation but lacks source-aware reconciliation and cross-device conflict handling. |
| 2026-08-03 | Treat `skills.sh` as a first-class provenance/import and materialization adapter | It already owns wide agent mapping and install semantics, but is not a complete restore/sync engine. |
| 2026-08-03 | Keep Skiller’s own manifest and local state | External lockfile formats and whole-manager tools are not stable product boundaries for Skiller. |
| 2026-08-03 | Use Git references for repository-like/symlink-heavy sources | Copying can flatten unsafe links, lose provenance, and create drift. |
| 2026-08-03 | Keep a failed pinned-source installation non-destructive and remove its temporary clone | A ref or integrity failure must not write a local skill or leave a long-lived copy of upstream material in a temporary directory. |
| 2026-08-03 | Keep Sync Center read operations as tRPC queries | The renderer uses GET for query procedures; misclassifying a read endpoint as a mutation causes a visible 405 error instead of a skill preview. |
| 2026-08-03 | Verify an external restore in an isolated home, not the developer’s real library | A clean-device test must prove both successful materialization and the no-write guarantee for a mismatched pinned source. |
| 2026-08-03 | Store “keep local” for an external conflict in local state only | It must not rewrite a shared manifest or silently hide a future source change; repository and pinned commit scope the decision. |
| 2026-08-03 | Parse only the tested skills.sh lockfile version | An upstream lockfile is input data, not Skiller’s schema. Unknown versions must fall back safely instead of producing incorrect Git provenance. |
| 2026-08-03 | Explain visibility and GitHub authentication before creating a library | A private GitHub repository is the default; a custom server controls its own access. Skiller delegates GitHub authentication to the existing `gh` session and never stores its token. |
