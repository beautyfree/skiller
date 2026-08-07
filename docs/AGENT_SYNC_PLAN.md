# Agent Sync plan

## Intent

Make Skiller the portable, user-owned source of truth for agent skills. A sync
profile must let a person restore a curated setup on a new machine, or share a
deliberately public/team-safe subset, without copying an entire home directory.

Git is the transport, not the product identity: a profile works with GitHub,
GitLab, Gitea, an enterprise Git server, SSH remotes, and a local `file://`
remote. GitHub gets a setup shortcut because it is the most common case.

## Non-goals

- Back up `~/.skiller/config.toml`, whole agent home directories, caches,
  logs, credentials, or authentication state.
- Store a PAT, OAuth refresh token, or SSH private key in Skiller settings or
  a sync repository.
- Automatically push local changes, overwrite a local skill, or resolve a Git
  conflict without an explicit user decision.
- Make a public profile from a private profile by changing only repository
  visibility. Public sharing is a separately reviewed profile.

## Data contract

Each profile owns a small Git working tree in
`~/.skiller/sync/<profile-id>/`:

```text
skiller-sync.yaml        # schema version, profile mode, selected agent policy
skills/<stable-id>/...   # explicitly bundled, user-owned skill directories
```

The manifest contains stable IDs, relative paths, content hashes, and target
agent slugs. It never contains an absolute home path, hostname, user name,
detected-agent marker, token, or local project list.

There are two portable kinds of skill:

1. **Reference** — repository URL, commit SHA, and relative skill path. On a
   new device Skiller installs the same immutable source.
2. **Bundled** — a reviewed copy of a user-owned skill directory under
   `skills/`. This is the only way edited/local skills travel between devices.

The import screen must classify every selected item before its first commit.
It must not infer that every installed skill should be backed up.

## Privacy and safety model

Profiles have three modes:

| Mode | Intended remote | Default contents | Extra guard |
| --- | --- | --- | --- |
| Private backup | private GitHub/GitLab/self-hosted Git | selected bundled skills and references | secret scan blocks push until fixed |
| Team | organisation remote | reviewed shared skills and portable policy | collaborators review normal Git changes |
| Public share | public remote | explicitly selected bundled skills only | strict scan and a final public-file review |

Safety is allowlist-first, then scanner-assisted:

- Only entries materialised by the manifest can be staged. `.git`, symlinks
  escaping the selected skill root, executable build output, credential files,
  and files matched by the generated ignore rules are rejected.
- Before every commit and push, Skiller scans staged text for private keys,
  common token/connection-string forms, and user-configured patterns. A scan
  warning explains the exact file and rule; public mode has no silent bypass.
- GitHub push protection is an additional remote defence, never the only
  privacy control. Other Git hosts may not provide it.
- HTTPS and SSH credentials are delegated to the existing Git credential
  helper, OS keychain, SSH agent, or the user's `gh`/Git installation.

## Architecture

Use one deep `SyncProfile` module behind the existing
`shared RPC schema → request handlers → tRPC → renderer` seam.

```text
Sync UI
  → SyncPlanner (read-only inventory, policy, diff, secret findings)
  → SyncProfile (manifest validation, staging, transaction, history)
  → GitWorkspace adapter (clone/fetch/status/commit/push)
  → native Git credentials / remote
```

- `SyncPlanner` has no write capability. It turns the local inventory plus a
  profile into a plan: additions, updates, removals, conflicts, and blocked
  files. This gives preview and testable locality.
- `SyncProfile` validates all paths and schema versions, writes only to a
  staging tree, and applies an accepted plan transactionally to the canonical
  `~/.agents/skills` directory. Failed applies restore the previous state.
- `GitWorkspace` is provider-neutral. It is the only module using
  `simple-git`; it accepts a remote URL and never interprets GitHub-specific
  credentials.
- A later `GitHubSetup` adapter may create/select a repository through a
  narrowly scoped GitHub App flow. It outputs a remote URL and hands control
  back to `GitWorkspace`; GitLab/Gitea/self-hosted setup remains a URL/SSH
  form, not a second sync implementation.

`bundled_path` in existing provenance is migration input, not the sync source
of truth. The new manifest owns identity and collision handling because the
current scanner deduplicates by directory basename.

## Sync lifecycle

1. **Create/import profile** — choose mode and remote; select individual
   skills; classify each as reference or bundled; review files and secret scan.
2. **Publish** — initialise/clone the managed workspace, create a normal Git
   commit, and push only after an explicit confirmation.
3. **Pull preview** — fetch without applying; compare remote manifest against
   the local inventory and show a three-way plan.
4. **Apply** — user chooses per-conflict behaviour: keep local, take remote,
   or open the skill for manual merge. No force overwrite.
5. **Restore** — clone/import a profile on a new machine, inspect the same
   plan, then materialise selected skills only for detected/selected agents.

MVP has manual `Pull preview` and `Publish` only. Scheduling can be added only
after the preview, conflict, and recovery paths are proven.

## Delivery phases

### Delivery status (2026-07-31)

- [x] Phase 0 — ADR, versioned manifest, portable-path and URL validation,
  duplicate-ID checks, secret-location reporting, and symlink rejection.
- [x] Phase 1 — selected bundled skills, private/team/public profile metadata,
  generic Git worktree (SSH, HTTPS, `file://`, GitHub/GitLab/Gitea/self-hosted),
  review-before-commit/push, connect-existing-remote, pull/fast-forward review,
  selected transactional restore, and re-installation for detected agents.
- [~] Phase 2 — GitHub create-repository shortcut through the user's existing
  `gh` session is implemented; offline/auth/branch-protection diagnostics,
  persistent restore journal, and a guided fresh-machine flow remain.
- [~] Phase 3 — pinned source-reference authoring and a per-agent-policy
  editor are implemented; explicit three-way conflict choices, public-file
  review, and team-oriented templates remain.
- [ ] Phase 4 — opt-in background checks, organisation policy/custom patterns,
  audit events, and an optional least-privilege GitHub App.

The UI can export a selected skill either as a reviewed **bundle** or as a
pinned Git **reference** only when existing provenance contains a repository,
full commit SHA, and portable skill path. References are never silently
upgraded to a branch tip. The portable agent setting is an explicit list of
target agent slugs (or the safe default: all detected agents); raw agent
configuration remains deliberately out of scope.

### Phase 0 — contract and threat-model

- ADR for profile ownership, allowlist and credential delegation.
- Versioned manifest schema, fixtures, and migration rule for existing
  provenance.
- Tests for secret findings, path traversal, escaping symlinks, and duplicate
  skill IDs.

### Phase 1 — private local/Git backup MVP

- Create one private-backup profile from selected skills.
- Support a generic Git remote and local bare/file remote.
- Build/push preview, pull preview, commit history, and restore into a
  temporary staging area.
- No GitHub account login and no automatic scheduling.

### Phase 2 — GitHub and recovery UX

- GitHub repository setup shortcut; use external Git credentials first.
- Clear state for unauthenticated Git, branch protection, offline remote, and
  rejected secret scan.
- Restore wizard for a fresh machine and a rollback journal for apply.

### Phase 3 — shareable profiles and teams

- Separate public/team profile creation flow and public-file review.
- Reference-versus-bundled editing workflow, per-agent installation policy,
  conflict UI, and collaborator-friendly commits.
- Generic GitLab/Gitea/self-hosted URL templates and SSH diagnostics.

### Phase 4 — automation and enterprise controls

- Opt-in background fetch with a notification-only default.
- Organisation policy file, custom secret patterns, audit-friendly events, and
  optional GitHub App integration with least-privilege repository access.

## MVP acceptance criteria

- Two isolated temporary homes can publish, restore, edit, preview and resolve
  a conflict without any absolute path or token entering the repository.
- A staged `.env`, private key, escaped symlink, or path traversal is blocked
  before Git commit; the user sees why.
- A failed filesystem apply leaves canonical skills byte-for-byte unchanged.
- A generic SSH/HTTPS/local Git remote works without provider-specific code.
- Existing single-machine installs and Skills CLI's lock remain untouched.

## Decisions needed before Phase 0 implementation

1. Is the first shipped profile strictly **skills only**, or should it include
   a portable selected-agent policy from day one?
2. For GitHub setup, should the first release rely on the user's existing
   GitHub CLI/Git credential helper, or should Skiller register a GitHub App
   and offer sign-in?
3. Should a private profile permit an informed, per-push scanner override, or
   should all findings block until removed/ignored by a committed policy file?
