# Agent Library — product and safety specification

## One home for the library and its sync

Agent Library is a stateful workflow: it has a source, a remote revision,
local edits, conflicts, recovery, and a first-time setup path. It is not an
application preference. The existing Settings implementation is therefore an
internal prototype only and must be removed from that screen.

There is exactly one top-level destination: **Agent Library**. It owns both the
portable collection and its sync state. There is no standalone Sync Center
route, sidebar item, dashboard destination, or post-setup screen. A quiet
indicator on the Agent Library navigation item can show:

- neutral — protected and up to date;
- dot — changes are ready for review;
- amber — a conflict needs a decision;
- red — a failed background check or failed operation.

The Dashboard links to Agent Library. When a library exists, the page checks
its status automatically on entry and when the app regains focus. It shows an
action only when something needs a decision. Background work is **check-only**:
it fetches remote metadata and compares snapshots; it never applies, commits,
pushes, creates a repository, or modifies an agent directory.

## Mental model shown to a person

> One protected Agent Library, made available to your agents.

There is one Git repository per Agent Library profile, never a Git repository in
every `~/.claude`, `~/.codex`, or other agent directory. The repository stores
the desired portable state. On a machine, Skiller materialises that state into
the canonical library and then links or copies it only to the selected agents.

An agent folder is an installation target, not the source of truth. This is the
same canonical-copy plus symlink model recommended by the Skills CLI. A local
agent-only skill is first classified, then explicitly adopted or left local;
it is never silently absorbed into a backup.

## First-time flow

The primary path must fit one screen at a time:

1. **Choose library access** — choose Personal, Public, or Team before any
   source verification. This sets whether external skills are copied or pinned
   to their source.
2. **Choose skills** — inventory all detected skills. Identical content in
   `.agents` and individual agent folders is grouped once. Divergent skills
   with the same name are called out as decisions, not deduplicated silently.
3. **Review the library plan** — one explicit review builds the plan with that
   access already applied. Show what is saved as a complete copy, what stays
   linked to an immutable source, what stays local, every blocking secret, and
   every file that would become public.
4. **Choose storage** — GitHub first. It
   reports the existing GitHub CLI/account state or starts a dedicated
   device-flow login once the product owns an OAuth client. `Use another Git
   server` is an advanced path for GitLab, Gitea, SSH, HTTPS, or `file://`
   remotes.
5. **Review and create** — one explicit commit/push. Credentials belong to the
   system Git credential helper, SSH agent, or GitHub CLI, never Skiller.

The secondary `Customize` path exposes selections only after the default plan:
which skill, bundle versus immutable Git reference, and which detected agents
receive it. Raw profile IDs and remote URLs live only under `Advanced`.

## Agent Library after setup

Agent Library is the day-to-day catalogue for an already connected library; it
is not a permanent onboarding screen. Its default header therefore identifies
the current library without re-explaining the product. Counts live on the
filter controls, where they can be acted on; a quiet plain-language summary
states only the total and whether the library has unreviewed changes.

Sync is an in-page state: it protects, compares, and publishes the library
while the same page curates its contents. The normal interface never asks a
person to compose a device scope, choose folders, or decide how libraries
combine. Agent Library is the sole sidebar destination.

When no library exists, the first-time setup flow renders directly inside
Agent Library. A person must never be redirected away to create the library
they just opened. Every visible product entry points to Agent Library; the new
product has no legacy Sync Center route to maintain.

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

The local comparison reads the shared library plus every readable skill root of
each detected supported agent. A changed direct agent copy is therefore never
lost behind the shared-root reconciliation: in a private library it can be
saved through the same explicit review as a new skill; in a public or team
library it remains a deliberate source decision and is never silently converted
from a pinned dependency into an uploaded copy.

Apply stages all files outside target roots, validates hashes and secret policy,
writes a durable transaction journal, then replaces entries one by one with
recoverable backups. A failure rolls back every applied entry; the journal
remains for recovery if the application or machine stops mid-operation.

## Main Agent Library states

- **No library yet:** the approved indigo landing offers `Create my library`
  and `Use an existing library`, and states that nothing is uploaded before
  final confirmation.
- **Healthy:** active library, portable item count, storage details behind
  progressive disclosure, and a quiet `Up to date` status. Checking is
  automatic; there is no redundant manual action.
- **Checking:** a focused comparison state explains that nothing changes,
  shows progress where available, and always offers `Stop checking`.
- **Check failed:** a persistent safe explanation replaces `In sync` and offers
  `Try again` without exposing raw Git output or credentials.
- **Changes found:** an in-page, grouped review for `Local changes`, `Remote
  changes`, `New local skills`, and `Conflicts`; no destructive primary action.
- **Conflict:** per-item choices and a compare view. `Apply selected` remains
  disabled until every selected conflict has a resolution.
- **Recovery:** an interrupted transaction is detected before normal actions;
  the user sees whether restore or library saving was interrupted, how many
  items are in the checkpoint, and what rollback will and will not touch before
  explicitly undoing the interrupted change. Machine paths and file contents
  never enter renderer data.

## Migration from the prototype

- Existing `~/.skiller/sync/<profile-id>` worktrees remain readable.
- Their manifest is imported as a draft profile, never silently published or
  applied.
- Settings loses the sync form; it may retain only a link to Agent Library if an
  old deep link exists.
- Agent Library supplies a friendly library name and repository choice; the
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

Agent Library has two in-page modes, never two destinations:

| Mode | Its job | Default view | Actions it owns |
| --- | --- | --- | --- |
| **Contents** | Understand the saved collection | skills, origin, availability, local edits | inspect a skill, switch library, manage libraries |
| **Changes** | Review and move detected changes safely | connection health and the next required action | create/connect, save reviewed changes, restore, resolve conflict |

The dashboard shows only a small status such as `Library connected · 3 local
changes` and one action, `Review changes`. It always opens Agent Library; it
never embeds another setup flow.

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

1. Agent Library fetches metadata automatically on entry and when the app
   regains focus. A visible action appears only when a non-mutating review plan
   is needed.
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
* Agent Library is the only destination: its title, purpose, current state,
  and primary action are obvious on first view.

### Implementation status — 2026-08-09

- [x] The approved indigo Sync Center landing remains the entry point, with a
  separate path for creating a library and using an existing one.
- [x] Creation is a four-step flow: choose skills, review outcomes, choose and
  configure storage, then explicitly create and upload.
- [x] GitHub and GitLab repository creation is deferred to the final confirmed
  action. Provider setup and custom Git use the same `Continue to final review`
  boundary.
- [x] GitHub and GitLab readiness is checked before final review. A missing CLI,
  disconnected account, or unavailable provider is handled on the setup screen;
  the final review names the verified account and destination, and the check is
  cancellable.
- [x] Team libraries require an explicit GitHub organization or GitLab group
  path instead of silently creating a nominally team library in a personal
  account.
- [x] Personal libraries save complete reviewed copies by default. Public and
  team libraries expose source problems and require an explicit save-current or
  keep-local decision, so omissions are never silent.
- [x] Public review expands every copied filename before storage selection.
  Divergent same-name skills require an explicit keep-all or deselection
  decision, and unsafe linked/deep/unreadable collections are surfaced rather
  than traversed or silently omitted.
- [x] Long source reviews have focused progress, cancellation, bounded Git
  commands, concurrent resolution, and a short-lived successful-result cache.
- [x] Existing-library preview, reviewed clone, post-connect comparison,
  provider browsing, and GitHub/GitLab sign-in are cancellable. Cancelling a
  clone removes its partial workspace; cancelling a later comparison keeps the
  clean local connection and restores nothing.
- [x] GitHub and GitLab failures retain a safe typed cause across the RPC
  boundary. Authentication, missing CLI, temporary availability, permissions,
  name conflicts, and a created repository whose address could not be resolved
  each lead to a truthful next action instead of the same sign-in prompt.
- [x] An existing library can be connected without remembering a profile ID or
  local folder; provider pickers and generic Git remain separate equal paths.
- [x] A new personal or public library carries Personal scope, while a team
  library carries Project scope, so Agent Library does not ask the same intent
  question again. dotagents validates this descriptor before commit and pull.
- [x] A newly created repository has a standalone dotagents README with its
  included skills and guided setup command. Later syncs preserve a README the
  owner has customized instead of replacing its public-facing documentation.
- [x] Generic and self-hosted Git never claim that a repository is private;
  final review says that access is managed by the chosen Git server.
- [x] When more than one library is connected, the active library is a
  device-local choice shared by Sync Center, Agent Library, and Dashboard, and
  the choice survives an application restart.
- [x] A clean library connection can be disconnected from one computer through
  a reviewed, recoverable Trash action. Local changes, pending uploads, and
  interrupted operations block it; installed skills and the remote repository
  remain untouched.
- [x] Agent Library compares every readable supported agent folder with the
  active library on entry and focus. It groups new, changed, and missing
  material in one in-page review; no manual folder picker is part of the flow.
- [x] The same new-material review works for private, public, and team
  libraries. Private libraries store reviewed copies; shared libraries pin
  verified external material to its source and leave unverifiable material on
  the computer with a clear reason.
- [x] Multiple private, public, and team libraries can be created or connected
  independently, switched without moving content, and removed from Skiller
  through a reviewed local Trash action that never removes the remote.
- [x] Background checks are fetch-and-compare only. They may light the sidebar
  indicator but never apply files, commit, push, or create a repository.
- [x] Background status checks use bounded parallelism across libraries, so one
  slow remote cannot serially delay every other library.
- [x] A failed background check persists across read-only profile refreshes and
  is never presented as `In sync`. The dashboard shows a safe typed explanation
  and `Try again`; a successful retry clears the failure immediately.
- [x] A fresh-machine restore was exercised in an isolated home. It reviewed
  target agents before materialising the selected skill. The restore is now
  recorded in device-local Activity even though the canonical skill target
  lives outside the Git workspace.
- [x] Remote-only updates and concurrent local/remote edits were exercised in
  an isolated profile. The check screen hides stale actions, conflicts default
  to keeping both, and the comparison is path-free and bounded.
- [x] Missing or non-directory local targets have truthful conflict actions.
  A removed skill can be restored or kept removed only on that device; a file
  or symlink can be replaced or left untouched. The reviewed choice is stored
  locally and is requested again when the saved library version changes.
- [x] The healthy dashboard distinguishes exact matches from reviewed
  per-device choices instead of calling both states identical.
- [x] Reviewed per-device choices are reversible. The dashboard opens a focused
  review showing what differs only here, and a person can restore the saved
  library version without waiting for the remote to change.
- [x] Recent activity explains why Undo is unavailable when potentially
  sensitive previous content was deliberately not retained. A successful Undo
  is marked `Undone`, cannot run twice, refreshes every skill inventory, and an
  undone restore becomes an explicit per-device choice instead of a hidden
  mismatch.
- [x] The first-library review was simplified in the live dev app: it now
  answers the primary question first (what travels and what stays on this
  computer), keeps file/source details behind disclosure, and labels its
  non-writing transition `Review my library`. Personal-library skill details
  no longer present redistribution and licensing choices that only matter for
  public or team sharing. A quiet inline result confirms when copied files had
  no possible secrets; a real finding remains a blocking grouped review.
- [x] Agent Library reuses the same safe, readable library labels as Sync
  Center. A local Git remote is never exposed as a machine path in its library
  switcher, including Windows drive and UNC paths.
- [x] Interrupted apply recovery, operation history, and reviewed Undo are
  covered by transactional tests. Recovery previews expose only the operation
  kind and bounded item counts; secret values and machine paths remain outside
  renderer data.
- [x] Full automated verification matrix rerun after the lifecycle changes:
  Skiller typecheck and 218 tests pass; dotagents lint, format, typecheck, 188
  tests, four JSON schemas, and the 37-export public API snapshot pass. The
  isolated live journey also covered connect, restore, immediate Activity
  refresh, reviewed Undo, durable Undone state, a settled per-device choice,
  restoring that choice later, cancellable library checking, typed provider
  failure before final review, account-qualified personal and team GitHub final
  reviews, public-file and license gating, the live concurrent-conflict screen,
  and the interrupted-recovery dashboard. All temporary live fixtures were
  removed afterward and the isolated library returned to `In sync`.
- [ ] Product owner visual review and wording adjustments in the running dev
  build.
- [ ] Commit, publish, release, and installed-app update. These stay blocked
  until the product owner explicitly approves the reviewed dev build.
