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

---

## Experience direction — Agent Library and Sync Center

### Design thesis

**A calm personal archive, not a Git control panel.**

Skiller should make a person feel that their working knowledge is safe, legible,
and portable. Git is present only where it gives a useful choice. The interface
must never make a manager, designer, or first-time developer learn Git terms in
order to protect a skill collection.

The existing dark desktop system remains the visual foundation: compact,
precise, and high-trust. Indigo remains the one intentional accent. Sync setup
gets a distinct entry moment, but its working screens return to the normal app
canvas rather than becoming a marketing funnel inside the product.

### Product language

Use the person’s mental model consistently:

| Say | Do not lead with | Reason |
| --- | --- | --- |
| Agent Library | profile, workspace, managed worktree | it is the person’s collection |
| Save in library | bundle, materialize, stage | describes the result |
| Keep linked to source | immutable dependency | explains why files are not copied |
| Keep on this computer | excluded external skill | says the safe outcome without implying failure |
| Choose where to keep it | choose a Git home | storage is the decision; Git is the implementation |
| Review and create | publish plan, commit preview | names the visible next screen |
| Check for changes | pull preview | makes the action non-destructive by name |

Technical terms such as commit SHA, repository URL, lock file, provenance,
branch, or installation mode live in `Details` and `Advanced`, never in the
first reading pass.

### Information architecture

The two top-level areas have a strict ownership boundary.

| Area | Its job | Default view | Actions it owns |
| --- | --- | --- | --- |
| **Agent Library** | Understand and curate the collection | skills, origin, availability, local edits | add, remove, inspect, classify a skill |
| **Sync Center** | Connect, review, and move changes safely | connection health and next change | create/connect, check, publish, restore, resolve conflict |

The dashboard shows only a small status such as `Library connected · 3 local
changes` and one action, `Review changes`. It never embeds another setup flow.

### The complete journey

#### A. First visit: make the promise precise

**Page purpose:** answer “What is this, and will it upload anything?” before
asking the person to act.

```text
Build your portable Agent Library
Your skills stay yours: review what travels, choose where to keep it, and
confirm before anything is uploaded.

[ Review my library ]        [ Connect an existing library ]

261 skills found   ·   Private by default   ·   Works with GitHub, GitLab, and your own Git server
```

Rules:

* `Review my library` is the primary action. `Create my library` is too early:
  it hides the review and publication boundary.
* The privacy promise sits beside the action, not below a scroll boundary.
* Counts are supporting evidence, never a second focal point.
* The indigo entry surface may be more expressive, but it must contain no
  feature-card grid, decorative statistics, or extra calls to action.

#### B. Review: one inventory, three possible outcomes

**Page purpose:** answer “What will happen to every skill?” in five seconds.

The whole primary canvas is one grouped inventory, not four competing cards:

```text
Review your library                         2 of 4
Here is what will happen. Nothing has changed yet.

  ✓ 68  Saved in your library
       Your own and reviewed skills will travel with you.
       View skills

  ↗ 34  Kept linked to their source
       Skiller records their exact version without copying the files.
       View sources

  • 159 Stays on this computer
       Their source could not be safely included yet. Nothing is deleted or changed.
       See why

  Safety check complete · No secrets found

                                             [ Choose where to keep it ]
```

Requirements:

* The three counts are mutually exclusive and add up to the scanned total.
* The `Stays on this computer` group appears once. Reasons are grouped under
  the row only after `See why`; no repeated amber panel with the same number.
* Success safety status is a quiet inline line. A real secret finding replaces
  it with a blocking alert grouped by file, showing rule names and a `Show
  file` action. It must say both what happened and what to do next.
* Cooling-off and reviewed-source policy are advanced safety controls. They are
  never a fourth primary card, and the control always explains its effect.
* This screen does not expose `skills.lock`, `dotagents.yaml`, source allowlist,
  or a SHA unless the person opens details.

#### C. Destination: privacy first, provider second

**Page purpose:** answer “Who can see this, and where will it live?”

```text
Choose where to keep your library            3 of 4

Visibility
  ● Private  Only you and people you invite can read this library.
  ○ Shared   People in this workspace can read and contribute.
  ○ Public   Anyone can read it. You will review every included file first.

Where
  [ GitHub ]  [ GitLab ]  [ Another Git server ]

GitHub
  Sign in to GitHub to choose or create a private repository.
  [ Continue with GitHub ]

[ Back ]                                       [ Review and create ]
```

Rules:

* Private is preselected. A change to public needs a visible consequence and
  a separate public-file review. This matches GitHub’s own treatment of
  repository visibility as a consequential change requiring explicit
  acknowledgement.
* Provider authentication happens only after a provider is selected. The person
  never has to remember URLs or folders after initial setup.
* `Another Git server` is an advanced but equal path for GitLab, Gitea,
  self-hosted Git, SSH, HTTPS, and local remotes. It starts with a provider
  template and plain labels, then exposes URL details.
* The app delegates credentials to the system credential helper, SSH agent, or
  provider CLI. It never asks the person to paste a token into the library.

#### D. Final confirmation: separate authorization from upload

**Page purpose:** make the first write irreversible only in the user’s mind,
not by surprise.

```text
Ready to create your private library          4 of 4

GitHub · alex/agent-library · Private

68 skills will be saved
34 skills will stay linked to their original source
159 skills will stay on this computer

No secrets found in the files that will be uploaded.

[ Back ]                 [ Create private library and upload 68 skills ]
```

This is the only screen with a write CTA. Account authorization is not an
upload. `Create` and `upload` must occur together in the final label, along
with visibility and a concrete count.

#### E. Healthy state: one quiet status, not a dashboard mosaic

**Page purpose:** make the next useful action obvious.

```text
Agent Library
Private · GitHub · last updated 12 minutes ago

261 skills available across 14 agents
3 local changes are ready to review

[ Review changes ]       [ Open library ]
```

The page does not repeat provider setup, source policy, and library content.
These are inspectable details. The primary action reflects the only current
work: review changes.

#### F. Check, resolve, then apply

**Page purpose:** keep a second computer or a local edit safe.

1. `Check for changes` fetches metadata and builds a non-mutating plan.
2. The result groups items by human outcome: `Only on this computer`, `Only in
   library`, `Changed in both`, `Already the same`.
3. `Changed in both` has no destructive default. The default resolution is
   `Keep both`; taking remote or replacing local is a deliberate per-item
   choice.
4. Before `Apply`, a final summary names target agents, folders, and affected
   skills. Apply is transactional and recoverable.
5. Completion confirms what was changed and exposes a short activity record.

This follows the useful safety lesson from backup and vault products: selection
is visible early, recovery is understandable, and the product explains what
will remain local rather than implying that everything is a remote mirror.

### Visual rules for this flow

* One screen, one question, one primary action. Supporting actions never use
  primary indigo.
* Use rows and dividers for outcome summaries. A card is reserved for a true
  interaction, such as a provider choice or a blocking security event.
* Semantic colour is scarce: indigo for the next action, green for completed,
  amber only for an actionable caution, red only for a block. Do not colour
  normal provenance information.
* Section labels are utility labels, not marketing copy. Do not write `Your
  new repository will contain` above every review.
* The setup footer is sticky only for the navigation actions. It must not
  contain a second summary or a different background that competes with the
  page.
* Every expansion is optional. The initial scan answers the core decision
  without requiring hover, popovers, or scrolling through a long skill list.
* All actions use direct verbs: `Review`, `Choose`, `Check`, `Create`, `Apply`,
  `Restore`. Avoid `Continue` unless the next destination is named alongside it.

### Why this is the right direction

The research supports three non-negotiable patterns:

1. Backup products foreground folder selection and allow later modification;
   they also warn users about conflicting backup sources. Skiller must make
   selection and “stay local” first-class, rather than treating exclusions as
   error residue. [Dropbox Backup](https://help.dropbox.com/organize/how-to-use-dropbox-backup)
2. Products handling sensitive collections make scope explicit and make
   restoration understandable. Skiller’s counterpart is a transparent
   library-vs-local classification and an explicit restore plan. [1Password
   Travel Mode](https://1password.com/features/travel-mode)
3. Repository visibility has meaningful consequences. Private must be the
   default and public sharing needs a separate, explicit acknowledgement.
   [GitHub visibility guidance](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility)

### Acceptance criteria for the experience

* In five seconds on the review screen, a person can answer: how many skills
  will be saved, linked, and left local.
* No screen says or implies that an account login uploads data.
* A person can create a private GitHub library without typing a remote URL,
  profile ID, or filesystem path.
* A person can choose GitLab or self-hosted Git without being sent through a
  GitHub-shaped flow.
* No normal operation overwrites a local skill. A conflict starts with a plan,
  not an apply action.
* Agent Library and Sync Center can each pass the trunk test independently:
  their title, purpose, current state, and primary action are obvious on first
  view.
