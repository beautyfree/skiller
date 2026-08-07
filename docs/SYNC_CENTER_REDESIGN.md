# Sync Center — product and safety specification

## Why this replaces the Settings section

Sync is a stateful workflow: it has a source, a remote revision, local edits,
conflicts, recovery, and a first-time setup path. It is not an application
preference. The existing Settings implementation is therefore an internal
prototype only and must be removed from that screen when Sync Center ships.

Sync Center is a dedicated top-level destination, next to Settings. Its icon
can show a quiet state indicator:

- neutral — protected and up to date;
- dot — changes are ready for review;
- amber — a conflict needs a decision;
- red — a failed background check or failed operation.

The background job is **check-only**. It fetches remote metadata and compares
snapshots; it never applies, commits, pushes, creates a repository, or modifies
an agent directory in the background.

## Mental model shown to a person

> One protected Agent Library, made available to your agents.

There is one Git repository per Sync Center profile, never a Git repository in
every `~/.claude`, `~/.codex`, or other agent directory. The repository stores
the desired portable state. On a machine, Skiller materialises that state into
the canonical library and then links or copies it only to the selected agents.

An agent folder is an installation target, not the source of truth. This is the
same canonical-copy plus symlink model recommended by the Skills CLI. A local
agent-only skill is first classified, then explicitly adopted or left local;
it is never silently absorbed into a backup.

## First-time flow

The primary path must fit one screen at a time:

1. **Protect my setup** — inventory all detected skills. Identical content in
   `.agents` and individual agent folders is grouped once. Divergent skills
   with the same name are called out as decisions, not deduplicated silently.
2. **Choose storage** — `Continue with GitHub` first. It reports the existing
   GitHub CLI/account state or starts a dedicated device-flow login once the
   product owns an OAuth client. `Use another Git server` is an advanced path
   for GitLab, Gitea, SSH, HTTPS, or `file://` remotes.
3. **Review what is protected** — a human description first: skill count,
   agent availability, bundled/reference count, and exclusions. Public mode
   always expands to a file list and secret-scan result before the final action.
4. **Create backup** — one explicit commit/push. Credentials belong to the
   system Git credential helper, SSH agent, or GitHub CLI, never Skiller.

The secondary `Customize` path exposes selections only after the default plan:
which skill, bundle versus immutable Git reference, and which detected agents
receive it. Raw profile IDs and remote URLs live only under `Advanced`.

## Portable profile model

The next manifest revision is a declarative desired state, not a mirror of
home-directory layout:

```yaml
schema_version: 2
library:
  name: Personal agent library
  visibility: private # private | team | public
skills:
  - key: writing-style
    display_name: Writing style
    payload:
      kind: bundled # or reference
      path: skills/writing-style
      sha256: <content hash>
    installations:
      - agent: codex
        mode: link # link | copy
      - agent: claude-code
        mode: link
preferences:
  # only versioned, schema-validated portable settings live here
  agent_policy: managed
```

The working tree contains only bundled skill folders and this manifest. It
never contains absolute paths, machine names, account names, auth state, cache,
logs, raw agent home folders, SSH keys, or a generic copy of an agent config.

### Agent settings

`Agent setup` means portable skill availability, installation method, and
supported declarative preferences. It does **not** mean copying all of
`~/.codex`, `~/.claude`, etc.; those folders routinely contain history,
tokens, machine-specific paths, and application state.

Additional configuration can be supported only as an allowlisted per-agent
schema with an explicit preview. An unknown config file is shown as
`not portable — keep local` by default. A future custom-file feature must
require per-file opt-in, secret scan, platform applicability, and the same
three-way conflict handling; it cannot be a recursive folder backup.

## Inventory and ownership

For every discovered `SKILL.md` directory, Skiller records a content hash,
origin path class (`shared`, `agent-local`, `inherited`), and installation
mapping. Equal hashes are one library item with several installations.

When two direct skills have the same user-facing name but different hashes,
the inventory creates a **collision**. Before the first backup the person must
choose one of: keep both with distinct portable keys, choose a canonical one,
or keep one local-only. Skiller never resolves this by basename.

Each machine maintains a local, non-synced apply ledger containing the last
successfully applied profile revision and each materialised content hash. The
ledger makes it possible to distinguish a user edit from an old installation.

## Change and restore protocol

Every operation starts with a read-only plan from three values: `base` (ledger),
`local` (current on disk), and `remote` (fetched profile revision).

| Base → local | Base → remote | Result |
| --- | --- | --- |
| unchanged | changed | offer **Take remote** |
| changed | unchanged | offer **Publish local** |
| unchanged | unchanged | no action |
| changed | changed, same hash | no action |
| changed | changed, different hash | conflict: **Keep local**, **Take remote**, or **Compare / merge** |

Missing files, untracked local skills, changed symlinks, and different target
types are also explicit plan entries. Apply is allowed only for the entries
selected in that plan and only if their local precondition still matches.

Apply stages all files outside target roots, validates hashes and secret policy,
writes a durable transaction journal, then replaces entries one by one with
recoverable backups. A failure rolls back every applied entry; the journal
remains for recovery if the application or machine stops mid-operation.

## Main Sync Center states

- **Not protected:** “Protect this Mac” plus a short inventory and an optional
  `Customize` link.
- **Healthy:** last successful backup, remote, protected skill count, and a
  single `Review changes` action.
- **Changes found:** grouped sections `Local changes`, `Remote changes`,
  `New local skills`, and `Conflicts`; no destructive primary action.
- **Conflict:** per-item choices and a compare view. `Apply selected` remains
  disabled until every selected conflict has a resolution.
- **Recovery:** an interrupted transaction is detected before normal actions;
  the user can restore the recorded backup or inspect the journal.

## Migration from the prototype

- Existing `~/.skiller/sync/<profile-id>` worktrees remain readable.
- Their manifest is imported as a draft profile, never silently published or
  applied.
- Settings loses the sync form; it may retain only a link to Sync Center if an
  old deep link exists.
- The new screen supplies a friendly library name and repository choice; the
  old profile ID and raw URL are available in `Advanced`.

## Acceptance criteria before merge/release

- A person can create a private GitHub backup without seeing a profile ID or
  remote URL.
- A person can select a custom Git server without GitHub-specific assumptions.
- Inventory explains shared versus agent-local skills and requires an explicit
  decision for a divergent duplicate.
- No local modification is overwritten without a reviewed, per-item decision.
- Interrupted apply is recoverable from a durable journal.
- Background work is notification/status only; it never changes files or Git.
- The public-profile review exposes every included file and blocks detected
  secrets before commit.
- The user completes local UI testing before any branch is merged, pushed, or
  released.
