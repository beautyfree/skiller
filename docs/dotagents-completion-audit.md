# dotagents and Skiller completion audit

> Status: active acceptance record
> Last verified: 2026-08-04
> Rule: a checkbox means that the named evidence was executed or inspected in
> the current worktree. Implementation presence alone is not completion.

## Outcome matrix

| Requirement | State | Authoritative evidence |
| --- | --- | --- |
| Comparative audit of dotagents prior art | Complete | Decisions and rejected weak patterns are recorded in `dotagents-platform-evolution-rfc.md`; the implementation remains an original TypeScript core consumed by Skiller. |
| Portable manifest, immutable lock, SHA-256, license and secret audit | Complete locally | Current dotagents `ci`: 164 tests, lint, format, typecheck, four generated schema checks, API snapshot and package closure verification. |
| Trust before every remote clone, fetch, pull, push, resolver or HTTPS discovery | Complete locally | `test/source-policy.test.ts`, `test/git-resolver.test.ts`, `test/git-workspace.test.ts`, `test/git-fast-forward.test.ts`, and Skiller `sync-profile.test.ts`, `install-git.test.ts`, and `source-trust-boundaries.test.ts`. |
| Immutable remote checkout across legacy Skiller paths | Complete locally | Marketplace, Projects, Repos and skill restore/update route through `git-transport.ts`; branch, tag, SHA and HEAD resolve to a reviewed exact commit before checkout, while persistent repositories use reviewed fast-forward plans. |
| Old Skiller profile migration | Complete locally | A profile without Device policy remains deny-by-default. `Review remote access` creates a network-free deterministic preview, apply stores only the exact remote locally, and a changed `origin` invalidates it. |
| Personal, Project and Device scope separation | Complete locally and live QA | `test/scope.test.ts`, `scope-composition.test.ts`, exact-path v10/v14 QA: explicit portable scope review, private `0600` overlay/history, deterministic exclusion of `command:ship-demo`, reviewed Undo and crash recovery. |
| Reviewed history, Undo, Repair and Adopt | Complete locally | dotagents history/repair/adopt tests plus Skiller Agent Library and Sync Center integration tests. Both core and Device scope history are bounded by record count and bytes, and oversized Device overlay/history files are rejected before parsing; the exact-path v9 app completed a path-free health review, deterministic Doctor Repair, separate Undo preview, and successful Undo. |
| Wildcard/exclude and well-known HTTPS discovery | Complete in core | `test/selection.test.ts` and `test/well-known.test.ts`; redirects and untrusted indexes are rejected before contact. |
| Versioned skills/instructions/commands/subagents model | Complete locally | `test/resource-model.test.ts`, `test/resource-apply.test.ts`, Skiller `resource-library.test.ts`; MCP and hooks remain intentionally deferred until execution-safety is designed. |
| Skill Quality Center | Complete locally | Structural, dry and measured-run suites; real immutable Docker dry run with network off, no credentials and resumable plan-bound output. |
| macOS current-worktree gates | Complete locally | Current Skiller source passes 163/163, typecheck and production build. The signed arm64 v15 package in `artifacts-goal-scope-v15` passes deep/strict verification; the prior v14 exact-path runtime review remains the visible UI evidence because the v15 change is a non-UI Device-size guard. |
| Linux current-worktree gates | Complete locally | A clean current `linux/arm64` run copied both worktrees, passed dotagents 164/164 plus all package gates and Skiller 163/163, typecheck and production build. |
| Windows current-worktree gates | Cross-build complete; runtime pending | Current v15 produced an x64 NSIS installer, blockmap, updater manifest and unpacked PE application on macOS. A live Windows runtime still requires a VM or hosted CI. |
| Immutable Skiller dependency pin | Pending permission | Skiller still pins published dotagents commit `96ef6eee92133364f773141657be5ab0cfc4a806`; local verification uses the current checkout symlink/package contents. |
| User-visible approval of every new state | Partial | Agent Library empty/error/Repair states and Skill Quality were reviewed live in exact-path packages. v9 remains open on its reviewed Repair preview in an isolated canonical fixture; technical runtime evidence is complete, but user approval is not inferred. |
| Commit, push, npm publication and release | Not authorized | No external publication action is allowed until the user explicitly approves it. |

## Current safety closure

- [x] Missing Device policy denies remote access.
- [x] Canonical libraries keep source policy in gitignored
  `dotagents.local.yaml`.
- [x] Legacy profiles keep the policy in
  `.git/skiller-source-policy.json`, outside portable repository content.
- [x] Remote review reads local Git config only and performs no fetch.
- [x] Confirmation is bound to the normalized remote and deterministic plan ID.
- [x] A changed remote invalidates confirmation before local policy is written.
- [x] `Check now` and `Review changes` remain unavailable until confirmation.
- [x] Confirmation itself does not fetch, merge, install, commit or push.
- [x] Legacy marketplace, project, repository and skill-update Git helpers deny
  by default before clone/pull; RPC actions pass only the exact source selected
  by the user or already recorded in local provenance.
- [x] Those legacy helpers no longer run moving `clone` or `pull`: all remote
  checkouts resolve branch, tag, SHA or HEAD to a plan-bound commit, and all
  persistent updates use the reviewed fast-forward transport.
- [x] An Electron renderer resolves its owning main process's loopback tRPC
  endpoint through IPC before the first HTTP request. It never silently falls
  back to another Skiller process occupying the preferred port.
- [x] Library health exposes no native path or secret value. Repair is a
  separate deterministic no-write preview, revalidates its target before the
  transactional apply, records its operation in Device-local history, and is
  reversible only through a second reviewed Undo.

## Verification log

### dotagents, macOS arm64

- [x] `bun run ci` — 164 tests, 0 failures; lint, format, typecheck, four schemas and typed API snapshot.
- [x] Four JSON schemas and the 39-export typed API snapshot verified.
- [x] `bun run package:check` — 198 package files and 43 export paths.

### Skiller, macOS arm64

- [x] `bun test` — 163 tests, 0 failures.
- [x] `bun run typecheck`.
- [x] `bun run build`.
- [x] Fresh `artifacts-goal-scope-v15/mac-arm64/Skiller.app` passes
  deep/strict codesign verification and is an arm64 Mach-O bundle.
- [x] Packaged `app.asar` contains the isolated data-root override, exact
  resolved-commit fields, minimum-release-age policy, unified branch/tag/SHA
  resolver, remote-review UI, resource model, Quality Center and owned-endpoint
  IPC handshake.
- [x] Runtime PID 98646 resolves to the exact v9 artifact, with CDP on localhost
  and all browser/application state isolated under the canonical Repair fixture.
- [x] With an existing dev process listening on `127.0.0.1:17888`, v9 bound its
  own server to `127.0.0.1:17889`; the renderer resolved `17889` before its first
  query. `lsof`, the renderer cache and successful canonical overview agreed.
- [x] Agent Library live review showed only the page as active after navigating
  away from an agent, one central empty-state action, focus on the first resource
  kind, Escape dismissal, and a specific retry state for legacy/incompatible
  libraries instead of falsely reporting an empty library.
- [x] Agent Library live Repair review named the exact two ignore entries and
  promised only the reviewed `.gitignore` change. Apply made the library
  healthy, Sync Center labeled the history entry `Doctor Repair`, Undo preview
  named only `.gitignore`, and reviewed Undo restored the original unhealthy
  fixture. v9 was left open on the reproducible Repair preview.
- [x] Skill Quality live review showed `Waiting for spec` rather than the
  misleading `Link missing` when no `spec.md` exists, while retaining the
  structural-only safety boundary and virtualized skill list.
- [x] Before confirmation no policy file existed; the live UI showed the exact
  remote, no-network explanation, and 7-day recommended cooling-off choice.
- [x] Confirmation wrote only Device-local policy with
  `minimum_release_age_minutes: 10080`, left the Git worktree clean, and moved
  the UI to `In sync`. No remote check was triggered.

### Linux arm64

- [x] Current v15 clean `linux/arm64` run exited `0`: dotagents 164/164 with
  lint, format, typecheck, schema/API/package gates, then Skiller 163/163,
  typecheck and production build against that container-built core.

- [x] Fresh `oven/bun:1.3.14-debian` `linux/arm64` container copied both
  worktrees without host `node_modules`, installed Git/npm/native build tools,
  and exited `0`.
- [x] Current dotagents passed 164/164 tests plus lint, format, typecheck, four
  schema checks, typed API snapshot and 198-file/43-export package closure.
- [x] Current Skiller, with that freshly built dotagents copied into its
  container-only dependency slot, passed 163/163 tests, typecheck and
  production build.

### Device composition Undo, macOS arm64

- [x] Exact-path v15 was launched with isolated Device and Electron data roots;
  no installed Skiller bundle was launched or modified.
- [x] A reviewed Personal+Project composition excluded `command:ship-demo` and
  kept the other four typed resources available.
- [x] `Review Undo` returned a deterministic, non-conflicting plan; apply
  restored the prior empty Device toolkit and wrote only the private
  `scope-composition.local.json` and `scope-composition.local.json.history.json`.
- [x] Both local files were mode `0600`; their records contain only stable
  profile IDs, resource keys and plan IDs, never an absolute path or secret.
- [x] The visible final review explains its concrete effect before the CTA:
  `Restore previous Device toolkit`, `Restores 4 resources on this device and
  keeps 1 local exclusion`, then `Restore reviewed toolkit`.
- [x] v14 exact-path QA also opened the real empty Agent Library and Sync
  Center. The former names the portable-library prerequisite and promises not
  to change original local files; the latter explains that nothing is created
  or uploaded before a destination is chosen. The same running package listed
  Codex and Claude Code from CLI state while skills-folder-only entries stayed
  explicitly not installed.

- [x] Clean dependency installation in `oven/bun:1.3.14-debian`.
- [x] Fresh disposable `linux/arm64` container installed system Git/npm, then
  passed dotagents 162/162, four schemas, 39-export API snapshot, 198-file/43-path
  package verification, and packed the current checkout.
- [x] The same container replaced Skiller's old dependency contents only inside
  the disposable filesystem, then passed Skiller 146/146, typecheck and
  production build.
- [x] After the final annotated-tag resolver consolidation, a fresh Skiller-only
  Linux container repeated all 146 tests, typecheck and production build with
  the current packed dotagents contents and explicit native build toolchain.
- [x] After the owned-endpoint IPC and final Agent Library/Quality Center UX
  changes, a fresh Skiller-only Linux container passed 152/152
  tests, typecheck and production build. SHA-256 of `dist/index.js` in the local
  dotagents build and the copy injected into Skiller both equalled
  `bbc779345342c38bac2d74d3c786c68ef0fdf5148bc33043a6ec1d4c67b3e90f`.
- [x] After reviewed Repair integration and explicit history origins, a fresh
  combined Linux arm64 container passed dotagents 162/162 plus lint, format,
  schema, API and 198-file/43-export package verification, then Skiller 154/154,
  typecheck and production build with the freshly built local core injected.

### Windows x64 cross-package

- [x] `electron-builder --win --x64` completed from the current v15 worktree and
  produced `Skiller-0.2.26-win-x64.exe`, its blockmap, `latest.yml`, and an
  unpacked x64 PE application in `artifacts-goal-windows-scope-v15`.
- [x] Cross-packaging rebuilt `better-sqlite3` back to a verified arm64 Mach-O
  bundle after packaging.

- [x] `electron-builder --win --x64` completed from the current v9 worktree and
  produced `Skiller-0.2.26-win-x64.exe`, its blockmap, `latest.yml`, and an
  unpacked x64 PE application.
- [x] The current v15 NSIS installer is 115.0 MB with SHA-256
  `9f323b24bd350d0dcfd14a960809717cf339ca1d26784f75848b5d01821ebc75`.
- [x] Cross-packaging temporarily rebuilt `better-sqlite3` for x64; the local
  development dependency was explicitly rebuilt back to a verified arm64
  Mach-O bundle afterward.
- [ ] A real Windows launch, installer, tRPC, resource Repair, and updater smoke
  still require `windows-latest` or a Windows VM and cannot be inferred from a
  successful cross-package.

## Remaining release gates

1. Receive user visual approval or correction for the exact-path app currently
   open on the reviewed Sync Center state.
2. After explicit permission, review and commit dotagents, push it, and replace
   Skiller's dependency with the resulting immutable commit.
3. Run and inspect Ubuntu, macOS and Windows hosted CI for both repositories.
4. Repeat the clean package and exact-path product smoke against that immutable
   pin.
5. Only after separate release permission, publish the npm package and Skiller
   release artifacts through the reviewed release workflow.
