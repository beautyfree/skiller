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
| [ ] | Protect `main` with a GitHub ruleset | Direct pushes and force-pushes are blocked; pull requests require the `Verify` check and the rule is visible through the GitHub API. |
| [x] | Gate releases on an independent verification job | `verify-release` now runs typecheck, all tests, and Linux packaging before platform uploads or publication. |
| [x] | Minimize and harden privileged Actions use | Actions are pinned to immutable SHA; permissions are job-scoped; `gh release upload` replaces the third-party uploader; build no longer gets `GH_TOKEN`. |
| [x] | Make build inputs reproducible | CI and release use Bun `1.3.14`; package metadata records the same version. |
| [x] | Resolve only the draft made for the exact release commit | Draft lookup now requires the exact triggering SHA. |
| [x] | Add post-release updater smoke checks | Publication is followed by checks for public status, updater manifests, version, and required installers. |
| [x] | Publish only user-facing and updater-required files | Upload uses explicit updater-manifest and distribution patterns; `builder-debug.yml` is excluded. |
| [ ] | Validate the hardened flow end-to-end | Publish one patch release without manual tags or intervention; record workflow URL, release URL, all platform job results, and updater-manifest checks below. |

## Implementation order

1. Protect `main` and add the release verification gate.
2. Harden credentials, action references, and deterministic tool versions.
3. Make release selection and artifact upload exact.
4. Add post-release checks, publish a patch release, and record the evidence.

## Evidence log

| Date | Status | Evidence |
| --- | --- | --- |
| 2026-07-31 | Baseline complete | [`v0.2.24` release](https://github.com/beautyfree/skiller/releases/tag/v0.2.24), [release workflow](https://github.com/beautyfree/skiller/actions/runs/30594750847): three platform jobs and publication succeeded. |

## Scope boundary

This checklist concerns release engineering only. It does not replace the
existing local tRPC transport or change application IPC architecture.
