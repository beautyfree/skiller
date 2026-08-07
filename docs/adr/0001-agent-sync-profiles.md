# ADR-0001: Agent sync uses portable Git profiles, not home-directory backup

## Status

Accepted for Phase 0 and Phase 1 implementation.

## Context

Skiller owns a canonical skills directory at `~/.agents/skills`, while agents,
Git tooling, and user settings live in different machine-specific locations.
Copying those locations would include absolute paths, detection state, caches,
credentials, and unrelated agent configuration. It would be unsafe to publish
and unreliable to restore.

Users need private backup, public sharing, team collaboration, and enterprise
Git remotes without Skiller becoming a credential store or a GitHub-only
product.

## Decision

Skiller will sync an explicit, versioned profile in a managed Git workspace.

- `skiller-sync.yaml` is the portable source of truth. It contains only stable
  IDs, relative paths, selected agent policy, bundled skill hashes, and pinned
  external source references.
- A profile can be `private`, `team`, or `public`. Public sharing is a distinct
  profile, never a visibility toggle on a private backup.
- GitHub, GitLab, Gitea, SSH, HTTPS, and `file://` are remote adapters behind
  one Git workspace interface. A GitHub setup flow may be added later without
  changing profile semantics.
- Credentials remain in the operating system Git credential helper, SSH agent,
  or user-configured GitHub CLI. The manifest rejects URLs with embedded
  credentials and Skiller does not persist access tokens.
- Every publish/pull produces a read-only plan before it can change the Git
  worktree or canonical skills. Apply is transactional and conflict resolution
  is explicit.
- Content is allowlisted by manifest before staging and scanned locally for
  likely secrets. Remote secret scanning is supplemental, not relied upon.

## Consequences

The sync module has a small deep interface: plan, publish, pull-preview, and
apply. UI and provider-specific setup remain adapters at its seam.

This deliberately does not sync raw agent configuration in the first release.
The first portable agent setting is a selected-agent policy; future safe config
fragments need their own schema and allowlist rather than a copy of agent home
directories.
