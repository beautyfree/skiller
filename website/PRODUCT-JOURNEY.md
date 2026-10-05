# Skiller: customer journey and screen contracts

Date: 2026-10-05. Scope: discovery through ongoing use, with a detailed review of skill sets and agent assignment.

## Evidence and limits

This map uses the current application source, the competitor's interface source, the user's feedback in this conversation, and isolated desktop walkthroughs. It is a product design hypothesis, not interview research or funnel analytics. Feelings and drop-off risks below are hypotheses; conversion rates and time savings have not been measured. Working code and passing tests alone do not establish usability.

## Person and job

A developer already uses Codex and Cursor and has several SKILL.md packages. They want to see what they have, make the right skills available to a new agent or project, and reuse a Frontend selection without managing directories manually. They do not arrive with a goal of operating a preset database or understanding Skiller's storage implementation.

## Mental model

- A skill is a package with instructions and supporting files.
- My skills is the inventory of packages I already have. Discovering a new package belongs to Marketplace or import.
- An agent or project is a destination where a package becomes available.
- A skill set is a saved selection. Creating or editing a set does not add, remove or update installed files.
- Updating content, adding availability and removing availability are separate operations.

## End-to-end map

| Stage | Touchpoint | Action and question | Likely emotion | Friction / risk | Desired outcome |
|---|---|---|---|---|---|
| Awareness | Landing, GitHub, comparison | “Is this a skills manager for my agents?” | Curious | Category obscured by vague copy | Product category and supported agents are immediately clear |
| Consideration | Screenshots, README, comparisons | Compare concrete workflows | Cautious | A feature list does not explain the benefit; stars are not proof of usability | Demonstrate inventory → choose destination → useful result |
| Acquisition | Download page | Get the build for this computer | Expectant | Architecture guessing, unnecessary build choices | Correct build and understandable installation instructions |
| First use | Onboarding, Dashboard | Find existing skills and detected agents | Uncertain | Empty state, treating a skills folder as proof an agent is installed | Correct inventory and detection, without writing files automatically |
| Inspect | All Skills, detail view | “What is this skill and where is it available?” | Oriented if clear | Calling already-owned packages “installable”; unclear source versus destination | Read contents and see agent availability |
| Put to use | Selection in inventory / agent page | Add existing skills to a destination | Focused | Asking for the destination again on its own page; long filesystem tables | Explicit destination, concise change summary, existing edits preserved |
| Reuse | Save as set, persistent set list | Save Frontend and use it in another context | Confident | Mixing editing and application in one dialog; hidden sets | Name + membership only when saving; separate add action |
| Maintain | Agent detail, update review, set editing | Remove availability, revise membership or update content | Cautious | Removing a set unexpectedly removes files; one agent's action affects all agents | Explicit action and scope, local work preserved |
| Return / recommend | Subsequent session, README demo | Repeat the workflow or show it to a colleague | Trusting if predictable | Different meanings for the same button; overstated “perfect” claims | Stable vocabulary, accurate state and a reproducible demonstration |

## Screen ownership and allowed actions

| Context | User intent | Main action | Forbidden ambiguity |
|---|---|---|---|
| Marketplace / import | Acquire a package I do not have | Install / import | Do not imply a package is installed merely because it is listed |
| All Skills, selection | Distribute packages I already have | Add to…; Save as set | No “Install selected” for an already-owned inventory |
| Agent page, selection | Organize this agent's available packages | Save as set; existing per-skill controls | No redundant add-to-current-agent action; no batch removal from all agents |
| All Skills, saved set | Reuse a named selection elsewhere | Add to…; Edit | Editing the set must not apply it |
| Agent page, complete set | Understand current availability | Added state; Edit | No Install / Add action that does nothing; clicking Added must not deactivate it |
| Agent page, incomplete set | Fill available missing members | Add missing to this agent | Destination is fixed to the open agent; no new destination wizard |
| Set with unavailable sources | Understand why it cannot be completed | Source unavailable; Edit | Do not promise an action when there is no available member to add |
| Set editor | Change saved membership | Save set | No installation options in this form; deleting a set preserves files |
| Add review | Understand imminent effects | Add missing skills | Show additions, unchanged entries and actual conflicts; expand locations on request |

## Critical moments

- **First value:** an existing package becomes available to the intended additional agent and the screen shows the new availability.
- **Commitment point:** the user confirms additions after seeing the affected destination and conflicts. The source must still match that reviewed plan.
- **Trust failures:** Install on an installed inventory; Added becoming Remove on a second click; a current-agent action changing other agents; an unavailable source being silently replaced by a different package with the same name.
- **Repeat value:** a saved selection remains accessible next session and can be applied to a new context without rebuilding it.

## Immediate corrections

1. Use Add to… for distribution from the inventory; reserve Install for acquisition.
2. Complete sets in an agent context have a noninteractive Added state. Incomplete sets offer Add missing only when sources are available.
3. Fix the current agent as the destination when adding its missing set members. Do not ask the user to choose it again.
4. Keep set editing separate from adding packages. Preserve explicit preview and partial-failure reporting.
5. Clear selection when switching between agents or the inventory; never carry a hidden selection across destination contexts.
6. Remove the all-agents batch-removal control from scoped agent pages. Do not invent scoped bulk deletion by reusing a global operation. Existing single-skill removal needs its own shared-root safety audit before broadening it.

## Remaining product issues, not claimed complete

- All Skills currently merges installed inventory with repository-only entries. Source browsing versus owned inventory needs a clear screen/filter contract; this change does not redesign repository navigation.
- Project creation/discovery should be assessed separately. Adding a set to a registered project works, but project registration and the initial project journey have not been fully observed with real users.
- Shared roots complicate removal for one agent. A safe scoped batch-removal operation requires explicit ownership rules and tests proving other agents retain their files.
- Set presence is an availability indicator, not a content-version or quality verdict. Updates and content conflicts remain the reviewed backend's responsibility.
- Native runtime checks use an isolated profile. Real-profile usability and Windows/Linux desktop interaction have not been verified here.

## Acceptance walkthroughs

1. Inventory: select two existing skills → Add to… → choose another agent → concise summary → confirm → both available there, with no extra saved set.
2. Save: selection → Save as set → name and membership → save → persistent list. No destination questions or filesystem writes beyond set metadata.
3. Current agent with a complete set: Added, no add/install action, and no global batch-removal control.
4. Current agent with an incomplete set: Add missing → fixed destination → actual changes → confirm. Existing packages and edits stay untouched.
5. Missing source / same-name substitute: source is unavailable, not silently reassigned; when nothing can be added, no actionable add button.
6. Review becomes stale: fail before overwriting any existing package and offer an explicit new check.
7. Keyboard: focus enters the name field for saving; dialogs trap focus, Escape closes when idle, and focus returns to the initiating control.

Before a release, ask a developer unfamiliar with these changes to perform walkthroughs 1–4 without explanation. Record misclicks, uncertainty, backtracking and completion; do not substitute a developer-run test for that usability evidence.

## Desktop observations for these corrections

In the isolated development profile, the completed Frontend set on Cursor showed `2/2 present` and `Added`, with no add/install control. Selecting both packages on that page exposed Save as set, without a global batch-removal control. Switching to Cline cleared the selection and showed `0/2 present`; Add missing opened a review fixed to Cline, showing two additions and no destination selector. No Cline files were changed during this review. These are developer-run observations, not independent usability acceptance.
