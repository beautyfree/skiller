# Release hardening

This is the implementation checklist for Skiller's release pipeline. It is the
source of truth for this work: update the status and evidence in this file in
the same change that implements an item.

## Goal

Every published version must come from reviewed code, pass verification before
publication, produce reproducible artifacts, and leave machine-checkable
evidence that electron-updater can consume the release.

## Current baseline

- [x] `v0.2.24` completed the current pipeline: Release Please created a draft,
  the release workflow built macOS, Windows, and Linux artifacts, and the draft
  was published with 15 assets.
- [x] The pipeline has a normal CI workflow for pull requests and pushes to
  `main` (`typecheck`, all Bun tests, and the Electron Vite build).
- [x] The release hand-off does not rely on a personal access token: the build
  starts from `workflow_run` after release finalization.

## Implementation checklist

| Status | Work item | Acceptance evidence |
| --- | --- | --- |
| [x] | Protect `main` with a GitHub ruleset | Ruleset `15362511` is active for the default branch: direct and force pushes are blocked; pull requests require the `Verify` check. |
| [x] | Gate releases on an independent verification job | `verify-release` now runs typecheck, all tests, and Linux packaging before platform uploads or publication. |
| [x] | Minimize and harden privileged Actions use | Actions are pinned to immutable SHA; permissions are job-scoped; `gh release upload` replaces the third-party uploader; build no longer gets `GH_TOKEN`. |
| [x] | Make build inputs reproducible | CI and release use Bun `1.3.14`; package metadata records the same version. |
| [x] | Resolve only the draft made for the exact release commit | Draft lookup now requires the exact triggering SHA. |
| [x] | Add post-release updater smoke checks | Publication is followed by checks for public status, updater manifests, version, and required installers. |
| [x] | Publish only user-facing and updater-required files | Upload uses explicit updater-manifest and distribution patterns; `builder-debug.yml` is excluded. |
| [x] | Validate the hardened flow end-to-end | `v0.2.25` passed the exact-commit preflight, macOS/Windows/Linux packaging, controlled publication, and public updater-manifest/installers checks. |

## Implementation order

1. Protect `main` and add the release verification gate.
2. Harden credentials, action references, and deterministic tool versions.
3. Make release selection and artifact upload exact.
4. Add post-release checks, publish a patch release, and record the evidence.

## Evidence log

| Date | Status | Evidence |
| --- | --- | --- |
| 2026-07-31 | Baseline complete | [`v0.2.24` release](https://github.com/beautyfree/skiller/releases/tag/v0.2.24), [release workflow](https://github.com/beautyfree/skiller/actions/runs/30594750847): three platform jobs and publication succeeded. |
| 2026-07-31 | `main` protected | Ruleset `15362511` is active for the default branch. It blocks deletion and non-fast-forward changes, requires pull requests with the GitHub Actions `Verify` check, and has no bypass actors. PRs [#41](https://github.com/beautyfree/skiller/pull/41), [#42](https://github.com/beautyfree/skiller/pull/42), [#43](https://github.com/beautyfree/skiller/pull/43), [#44](https://github.com/beautyfree/skiller/pull/44), and [#45](https://github.com/beautyfree/skiller/pull/45) passed that gate before merge. |
| 2026-07-31 | Hardened release verified | [`v0.2.25` release](https://github.com/beautyfree/skiller/releases/tag/v0.2.25), [release workflow](https://github.com/beautyfree/skiller/actions/runs/30629437519): exact SHA `32d512172d39bfae8650947d8c16f873282245a9` passed typecheck, tests, and Linux packaging preflight; Windows and Linux artifacts uploaded successfully before controlled publication. Public `latest.yml`, `latest-linux.yml`, and `latest-mac.yml` each declare `0.2.25`; Windows EXE, Linux AppImage, and both macOS DMGs are reachable. `builder-debug.yml` returns 404. |

## Scope boundary

This checklist concerns release engineering only. It does not replace the
existing local tRPC transport or change application IPC architecture.
