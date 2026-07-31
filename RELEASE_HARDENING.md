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
| [ ] | Gate releases on an independent verification job | The release workflow runs typecheck, all tests, and a Linux packaging smoke before any platform upload or publication. A failed verification keeps the release draft unpublished. |
| [ ] | Minimize and harden privileged Actions use | Every action is pinned to an immutable commit SHA; job permissions are least-privilege; build jobs do not receive a GitHub write token unless uploading; no third-party release uploader has access to macOS signing secrets. |
| [ ] | Make build inputs reproducible | Bun is pinned to an explicit version used by both CI and release; the version and lockfile are recorded in the repository. |
| [ ] | Resolve only the draft made for the exact release commit | The release workflow matches `target_commitish` to the triggering SHA and fails safely rather than selecting an unrelated draft. |
| [ ] | Add post-release updater smoke checks | Before publishing, validate every `latest*.yml` manifest against the target version and attached assets; after publishing, verify the release is public and has all expected updater manifests and platform installers. |
| [ ] | Publish only user-facing and updater-required files | Upload explicit `latest*.yml`, installers, archives, and blockmaps; exclude `builder-debug.yml` and other internal build files. |
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
