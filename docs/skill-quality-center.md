# Skill Quality Center

The Skill Quality Center is a separate, read-only product surface for understanding whether a local skill has a reviewable behavioral contract and evidence for that contract. Opening it, browsing skills, installing a skill, or synchronizing a library never starts an agent, a model API call, a shell command, or a network request.

## Structural review

The current structural analyzer recognizes the public `@sentry/skillet` 1.7 artifact lifecycle:

- lowercase `spec.md` with Intent, Triggers, Behaviors, Scenarios, and optional Constraints;
- a 12-character SHA-256 `spec_hash` in `SKILL.md` frontmatter;
- `evals/cases/*.yaml` with behavior, prompt, fixture, setup, checks, trials, and timeout;
- `file_exists`, `shell`, and `judge` check declarations;
- behavior-to-case coverage and fixture references.

The implementation is an original TypeScript reader informed by the public MIT-licensed Skillet format and documentation. Skiller does not invoke the Skillet CLI during browsing and does not depend on it being installed.

All files are bounded before reading. Linked specs, linked eval directories, and linked case files are rejected instead of followed. Renderer output contains relative artifact paths only; canonical machine paths remain in the main process.

## Evaluation boundary

Structural validation and evaluation are different permissions. Every evaluation run has a separate reviewed plan that names:

- skill and immutable artifact snapshot;
- harness and model;
- baseline enabled or disabled;
- trial count and concurrency;
- disposable sandbox implementation;
- network policy, defaulting to off;
- environment variable names, with no values in the plan or report;
- setup commands and shell checks;
- expected report destination and resume identifier.

Direct host execution is not a fallback. If a suitable disposable sandbox is unavailable, evaluation remains unavailable. Agent and judge sessions start only from an explicit user action after this review.

Reports must preserve case/behavior pass rates, baseline rates, lift, harness, model, trial count, sandbox policy, artifact hashes, and interruption/resume state. They must not include environment values or absolute user paths.

## Implemented execution model

- The review snapshots all regular skill content, including bundled references,
  fixtures, and eval cases. Linked content is rejected and a changed byte or
  Docker image ID invalidates the plan.
- Dry checks run setup and deterministic checks in Docker with no network,
  credentials, or environment passthrough. A case that already passes is
  reported as vacuous; judge-only cases remain indeterminate.
- Measured runs support Codex and Claude, repeated trials, optional baseline,
  per-behavior pass rates, and lift. Network and the matching credential
  profile are separate explicit decisions. The profile is mounted read-only.
- Setup and shell checks stay network-off and credential-free even during a
  measured run. Agent and judge calls run only inside the reviewed image.
- Completed case/trial files are written atomically to local Skiller device
  data and reused only for the same plan ID, so an interrupted run resumes
  without re-measuring completed work.
- Outputs that match secret patterns are redacted before report persistence or
  renderer delivery. Reports use opaque local destinations and relative
  artifact paths only.

Skiller never pulls or builds an image in the background. Source users can
review `build-resources/skill-quality/Dockerfile` and run
`bun run quality:sandbox:build`; the build context is restricted to that
directory. Any compatible local image can instead be entered in the Quality
Center. The resulting immutable Docker image ID, rather than the mutable tag,
is bound into the reviewed plan.
