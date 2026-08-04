# dotagents platform evolution RFC

> Status: active implementation contract  
> Created: 2026-08-03  
> Applies to: `beautyfree/dotagents` and the Skiller Sync Center  
> Supersedes: no existing safety contract; extends `dotagents-architecture-plan.md`

## 1. Goal

Evolve dotagents and Skiller from a safe skill-library synchronizer into a
portable agent-environment platform without weakening the existing immutable,
reviewed, and transactional core.

The implementation is informed by the current published code and packages for
`dotagents`, `dotagents-pack`, `@iannuttall/dotagents`,
`@sitaggart/dotagents`, `@sentry/dotagents`, and `@sentry/skillet`. Prior art
is input, not a compatibility mandate. A feature is adopted only when it can be
expressed through dotagents's stronger safety boundary.

## 2. Non-negotiable invariants

Every phase must retain these properties:

- remote dependency content is selected from an immutable Git commit;
- locked content is verified with deterministic SHA-256 integrity;
- secret and license audits run before portable publication;
- secret values and absolute user paths never enter portable output;
- every mutation is bound to a deterministic reviewed plan ID;
- apply rejects stale source, target, policy, and remote preconditions;
- unmanaged targets are never overwritten implicitly;
- multi-file changes use staging, durable journals, rollback, and recovery;
- Git authentication remains provider-neutral and outside portable files;
- `.agents/skills` alone never proves that an agent is installed;
- background work is inspect-only and never mutates files or remotes.

The following prior-art behavior is explicitly rejected:

- informational-only locks or moving-ref installs without review;
- automatic destructive repair or whole-directory replacement;
- privacy inferred only from filenames;
- automatic execution of downloaded hooks or scripts;
- portable backups stored inside a public library;
- a manifest author granting trust on behalf of the consuming device.

## 3. State and scope model

Three scopes are separate and composable:

| Scope | Purpose | Portable | Authority |
| --- | --- | --- | --- |
| Personal | A person's reusable library | public or private Git | library owner |
| Project | Team/repository requirements | committed with project | project maintainers |
| Device | Trust, credentials, paths, selections, history | never | local user |

Effective state is an intersection, not last-writer-wins:

1. Personal and Project declare desired portable resources.
2. Device policy decides which sources may be contacted and which projections
   may be written.
3. Agent detection limits delivery to verified capabilities.
4. A reviewed plan explains the provenance of every effective decision.

A portable repository may narrow acceptable sources for a team but cannot
expand the local device trust policy.

## 4. Phase A: source trust and stabilization

### 4.1 Device trust policy

Trust is evaluated before clone, fetch, HTTP discovery, or any other network
access. The first implementation supports:

- exact normalized Git repository identities;
- explicitly allowed Git hosts;
- explicitly allowed GitHub organizations as a convenience rule;
- an explicit `allow-all` escape hatch;
- local `file:` sources only after a separate explicit opt-in.

Absence of a policy is deny-by-default for network sources. Backward
compatibility belongs in a migration adapter or an explicit one-time user
decision, never in the resolver.

Trust policy is Device state. A reviewed plan contains a value-redacted policy
snapshot and the rule that authorized each source. Portable `skills.json` and
`dotagents.yaml` do not contain device trust grants.

### 4.2 Minimum release age

An optional minimum age applies when a ref is resolved to a commit. The plan
records the immutable commit and its Git committer timestamp. A too-new commit
blocks resolution unless its exact normalized repository is explicitly
excluded by the device policy.

Git timestamps are author-controlled and therefore provide stabilization, not
publisher identity or malware proof. The UI must describe the feature as a
cooling-off period, not a security guarantee. dotagents never silently selects
an older commit: changing the resolved commit requires another reviewed plan.

### 4.3 Acceptance

- [x] An untrusted source is rejected before the Git runner receives a clone or
  fetch command.
- [x] GitHub shorthand or transport spelling cannot bypass normalized trust.
- [x] Credentials, query strings, and fragments are rejected before policy
  comparison.
- [x] Local sources require an independent `allowLocal` decision.
- [x] Commit age and any exclusion rule are deterministic plan data.
- [x] A changed policy produces a different plan ID.
- [x] CLI and Skiller serialize byte-equivalent policy decisions.
- [x] Existing immutable lock and integrity behavior remains covered.
- [x] Library clone, fetch, pull, fast-forward and push all require Device trust
  before Git can contact the remote.
- [x] HEAD, branch, tag and immutable SHA checkouts resolve to an exact commit,
  bind that commit and its age evidence into the plan, and never apply a moving
  ref directly.
- [x] Marketplace, Projects, Repos and legacy skill restore/update paths share
  the same dotagents checkout or fast-forward transport rather than maintaining
  weaker product-local `clone` and `pull` implementations.
- [x] Legacy profiles without stored policy remain deny-by-default and require
  a separate network-free remote preview plus exact-plan confirmation.

## 5. Phase B: scopes and migration

Introduce a versioned scope descriptor without rewriting current libraries in
place:

- current `~/.agents` libraries import as `personal`;
- a repository-level declaration imports as `project`;
- current `dotagents.local.yaml`, ledgers, credentials, and caches become
  `device` state;
- ambiguous legacy files produce a migration plan rather than a guessed scope;
- project and personal resources with the same identity become an explicit
  conflict unless their immutable content is equal.

Acceptance:

- [x] A clean device can combine one Personal and one Project source.
- [x] Device paths and trust decisions cannot serialize into either source.
- [x] Removing a Project scope leaves Personal resources intact.
- [x] Migration is preview-only until the exact plan is confirmed.

## 6. Phase C: operation history, Undo, repair, and adopt

Successful operations receive a local history record under ignored device
state. Each record contains the reviewed plan, postconditions, and a bounded
inverse payload sufficient to restore replaced managed content. It contains no
secret values and is never portable.

Undo is itself a new reviewed transaction. It refuses to apply when targets
have changed since the recorded operation. History retention is bounded by
count and bytes.

`doctor` remains read-only. `Repair` converts selected findings into a plan;
`Adopt` converts explicitly selected unmanaged content into a canonical
resource only after export, secret, license, and collision review.

Acceptance:

- [x] A completed materialization or library update can be previewed and undone.
- [x] Undo never removes content that appeared after the original operation.
- [x] Repair cannot mutate directly from a diagnostic finding.
- [x] History is local, bounded, value-redacted, and gitignored.

Adopt is also implemented as a distinct no-write review followed by an exact
plan confirmation. It accepts only explicitly selected data resources, blocks
identity/path collisions, possible secrets, and unlicensed shared content,
revalidates the source and library after review, and uses the same transactional
library update and local history layer as normal managed changes.

## 7. Phase D: source discovery convenience

Add wildcard selection with explicit exclusions and a well-known HTTPS index.
Discovery output is always a no-write plan containing every selected skill,
path, source, immutable revision where applicable, and exclusion reason.

Well-known transport is HTTPS-only, bounded by size/count/time, protected by
the same Device trust policy, and cannot declare executable behavior.

Acceptance:

- [x] Wildcards cannot escape their declared source subtree.
- [x] Exclusions are stable identifiers and visible in review.
- [x] An index change invalidates the reviewed plan.
- [x] HTTP redirects cannot cross to an untrusted host.

## 8. Phase E: resource model v2

Resource kinds are explicit and independently versioned:

1. `skill`
2. `instruction` or conditional `rule`
3. `command`
4. `subagent`

Agent descriptors gain a capability matrix per resource kind. Adapters preserve
native source when round-trip-safe and otherwise expose a documented lossy
conversion in preview. Whole-directory symlinks are not a resource model.

MCP declarations and hooks remain deferred until an execution-safety RFC
defines ownership-aware config patching, environment references, command
review, sandboxing, and revocation. Merely parsing them does not authorize
execution.

Acceptance:

- [x] A resource collision is keyed by kind, stable identity, and content.
- [x] Agent projection support is data-driven and tested per adapter.
- [x] Unmanaged native files survive install, repair, update, and uninstall.
- [x] Lossy conversion is explicit before apply.
- [x] No hook or script can execute as a side effect of discovery or install.

## 9. Phase F: Skill Quality Center

Quality is a separate Skiller surface and does not become a synchronization
side effect. It recognizes the Skillet artifact lifecycle:

- `spec.md` intent, triggers, behaviors, scenarios, and constraints;
- `SKILL.md` plus a `spec_hash` staleness link;
- behavior-to-eval coverage from `evals/cases/*.yaml`;
- deterministic dry checks;
- opt-in trials with and without the skill and reported lift;
- resumable, inspectable reports.

Agent and judge execution is disabled until the user explicitly starts an eval.
Untrusted eval setup and shell checks require a disposable sandbox; network is
off by default and environment passthrough is allowlisted by variable name.

Acceptance:

- [x] Browsing or syncing a skill never starts an eval or model session.
- [x] Structural status works without an agent CLI or credentials.
- [x] Stale spec linkage and missing behavior coverage are visible.
- [x] Direct host execution is never the default for downloaded evals.
- [x] Baseline/lift reports identify harness, model, trials, and sandbox policy.
- [x] A real dry plan executes and resumes in the reviewed immutable Docker
  image with network off, no credential passthrough, and no host fallback.

## 10. Cross-platform and product verification

Every completed phase requires:

- focused unit and integration tests;
- full dotagents typecheck, lint, test, schema, API, and package gates;
- Skiller test, typecheck, and production build gates;
- macOS, Linux, and Windows CI for filesystem and Git behavior;
- an exact-path Skiller dev review of every new screen and state;
- a packaged-app review before release;
- no npm publication, push, tag, or GitHub Release without explicit approval.

## 11. Delivery checklist

- [x] Comparative package/source audit completed.
- [x] Architecture, migration direction, and acceptance matrix recorded.
- [x] Phase A source trust and stabilization.
- [x] Phase B Personal, Project, and Device scopes.
- [x] Phase C history, Undo, repair, and adopt.
- [x] Phase D wildcard and well-known sources.
- [x] Phase E resource model v2.
- [x] Phase F Skill Quality Center.
- [ ] Full cross-platform and live-product completion audit.

## 12. Acceptance evidence

The checkboxes above are backed by executable tests, not implementation
presence alone:

- Phase A: `test/source-policy.test.ts`, `test/git-resolver.test.ts`,
  `test/git-workspace.test.ts`, `test/git-fast-forward.test.ts`, and Skiller's
  `src/main/install-git.test.ts`, `src/main/sync-dotagents.test.ts`, and
  `src/main/sync-profile.test.ts`. The Skiller migration tests remove the
  Device-only policy from a real legacy Git fixture, prove that fetch is
  rejected, confirm the exact remote, and reject a stale confirmation after
  `origin` changes.
- Phase B: `test/scope.test.ts`.
- Phase C: `test/history.test.ts`, `test/repair.test.ts`, and
  `test/adopt.test.ts`. Skiller's `src/main/resource-library.test.ts` additionally
  proves that health/repair JSON contains no native path, preview does not
  mutate, apply is bound to the unchanged target, and the successful repair is
  retained in the same durable history used by reviewed Undo.
- Phase D: `test/selection.test.ts` and `test/well-known.test.ts`; redirects are
  disabled at the HTTP port, which is stricter than accepting a cross-host
  redirect and checking it after contact.
- Phase E: `test/resource-model.test.ts` and `test/resource-apply.test.ts`.
- Phase E product integration: Skiller's Agent Library surface and
  `src/main/resource-library.test.ts` keep native paths behind opaque selection
  IDs, expose a value-free adoption preview, and apply through dotagents's
  reviewed transaction. `test/git-workspace.test.ts` proves that
  `resources.json` plus declared `instructions/`, `commands/`, and `subagents/`
  content can be committed/pulled while unlisted or secret-bearing content is
  blocked.
- Phase F: Skiller's `src/main/skill-quality*.test.ts`, the full 143-test,
  typecheck, production-build, and Biome gates, plus an exact-path review of the
  structural, blocked-plan, independent network/credential grant, and both
  revocation states. The reviewed arm64 image
  `sha256:a35036c6cbd729e4de904ada6d05cfe469f8ac982a440f8c92313b651c45eb24`
  contains pinned Codex 0.146.0 and Claude Code 2.1.220. A real Skiller dry plan
  completed inside that image, resumed from its plan-bound cache, kept network
  off, passed no credential variables, used no direct-host fallback, and
  returned no absolute skill or report paths. This live run also exposed and
  fixed invalid Docker bind-mount syntax in both dry and measured executors;
  regression tests now cover the generated mount arguments.

Package and product integration were also exercised rather than inferred:

- `bun run package:check` verified 198 dotagents package files and 43 export
  paths. The produced tarball was installed into an isolated consumer, which
  imported the public Adopt, resource-model, and source-policy exports and
  completed a reviewed instruction adoption plus resource-manifest parse.
- A macOS arm64 Skiller app and ZIP were built under
  `artifacts-goal-smoke/`. Strict deep code-sign verification passed, the ZIP
  contained updater metadata, and its exact app path was used for review.
- The packaged app connected a generic empty library created by dotagents's
  public initialization API and pushed to a local Git remote. Generic
  libraries no longer require Skiller-only metadata or an empty `skills.lock`;
  a manifest with dependencies still requires its reviewed lock.
- In that packaged app, an instruction was adopted through Agent Library,
  appeared in durable Sync Center history, and was removed through the
  separately reviewed Undo flow. The temporary device profile was then moved
  recoverably to Trash; no portable repository content was published.
- A later exact-path v9 package exercised the complementary Repair path on an
  isolated canonical library: Agent Library exposed the read-only finding,
  preview named only two `.gitignore` additions, apply produced a `Doctor
  Repair` history entry, and a separate Undo preview restored the fixture. No
  commit, push, remote access, native path, or secret value crossed that flow.

The source-trust closure was reverified after those earlier product checks:

- macOS arm64: dotagents's full gate passed 161 tests plus lint, format,
  typecheck, four JSON schemas, the typed API snapshot, and package verification
  of 198 files/43 export paths. Skiller passed 143 tests, typecheck, and its
  production Electron build.
- Linux arm64: a clean `oven/bun:1.3.14-debian` container passed the same
  dotagents 161-test/schema/API/package gates. A second clean container passed
  Skiller's 143 tests, typecheck, and production build after replacing only the
  installed package contents with the current local dotagents build to model the
  future immutable pin.
- A fresh signed arm64 app and ZIP were built under `artifacts-goal-trust/`.
  Deep/strict codesign verification passed; direct `app.asar` inspection found
  the remote-trust RPC, stale-plan guard, CTA, and no-fetch explanation. The
  running process was resolved to that exact app path rather than the installed
  application.
- After the legacy marketplace/project/repository/update source guards were
  added, the current worktree was packaged again as
  `artifacts-goal-current/mac-arm64/Skiller.app`. Deep/strict codesign passed,
  its `app.asar` contained both the Sync Center trust flow and legacy source
  guards, and the launched process was resolved to this exact executable. A
  live screenshot proved the real shell rendered; the device showed onboarding
  rather than the legacy-remote state, so that branch still awaits visual
  confirmation.
- No functional Windows VM is available on this machine: the discovered
  VirtualBox shim points to a missing application. Windows remains a hosted-CI
  gate and is intentionally not marked complete from platform-neutral tests.

The final source-boundary pass also covered the pre-dotagents Skiller surfaces.
Marketplace installation, project Git installation, repository add/sync, and
single/bulk skill update helpers now default to a deny policy before clone or
pull. Their RPC actions provide an exact allowlist derived only from the source
the user selected or the locally recorded provenance. The regression in
`src/main/source-trust-boundaries.test.ts` points every low-level helper at an
unreachable domain and proves that each returns the Device trust error before
network-specific failure is possible.

The checked-in CI definitions now run the dotagents and Skiller verification
gates on Ubuntu, macOS, and Windows. This is configuration evidence only; the
final cross-platform checkbox remains open until those jobs run on a pushed
commit and their artifacts/statuses are inspected.

Verification addendum (2026-08-04): the v14 source passed
dotagents 164/164 (including lint, format, schemas, API snapshot and package
closure) and Skiller 162/162, TypeScript checks and production build. A clean
`linux/arm64` container copied both worktrees without host dependencies and
repeated those same gates. The exact signed arm64 v14 app was launched from
`artifacts-goal-scope-v14`, with isolated data roots; its live Agent Library
review made the Device-Undo outcome concrete (the number restored and local
exclusions kept) before its final action. A Windows x64 NSIS package, blockmap,
updater manifest and unpacked PE application were cross-built from that same
source. The last item is packaging evidence only: no local Windows VM exists,
so installer, tRPC, Repair and updater runtime behavior still require a real
Windows environment or hosted CI after the reviewed commits are pushed.

The current post-v14 Device-overlay size guard is covered by Skiller 163/163,
typecheck and production build on macOS. Its fresh Linux and Windows package
gates remain explicitly pending rather than inferred from the previous v14
artifacts.

There is also an intentional cross-repository release gate: Skiller still pins
dotagents commit `96ef6eee92133364f773141657be5ab0cfc4a806`, while the new Adopt
and resource-v2 Git support currently exists only in the uncommitted dotagents
working tree. Local Skiller verification uses that checkout through the
workspace symlink. Before clean CI can be treated as evidence, dotagents must be
reviewed and committed, its immutable commit must be pushed, and Skiller must
update and verify the dependency pin. None of those publication steps may be
performed without explicit approval.
