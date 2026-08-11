# All Skills evolution plan

## Product decision

`All Skills` is the single catalog and starting point for skills on this
computer. It shows provenance, recent arrivals, and actions appropriate to the
person's relationship with a skill.

The standalone `Quality` destination will be removed. Its useful authoring
capabilities move into the detail view of a skill the person owns or has
explicitly forked. Imported and linked skills are never labelled as deficient
merely because they do not contain authoring artifacts.

## Skill relationships

dotagents is the source of truth for these facts:

- `external`: an upstream skill whose source is known;
- `linked`: a skill used directly from a shared/upstream location;
- `owned`: a local skill explicitly claimed or created by the person;
- `forked`: an editable local copy with preserved upstream provenance;
- `unknown`: a local skill whose origin cannot safely be inferred.

The local registry also records `first_seen_at` and `reviewed_at`. `New` means
first seen since the person last reviewed the catalog; it is not a quality
judgement. `Created locally` is shown only for an explicitly owned skill.

## All Skills experience

1. A compact `Recently added` group shows unreviewed skills first.
2. Each detail view makes the source and ownership clear.
3. External and linked skills offer source/update actions.
4. External skills can be copied through `Fork to my library`; the fork keeps
   its upstream URL, revision, and licence information.
5. Owned and forked skills offer `Improve skill`.

## Improve skill

The first release is a non-technical loop:

1. Capture one real scenario: prompt or context, observed result, and expected
   result.
2. Save a private improvement note against the owned/forked skill.
3. Create and review a draft change.
4. Save it into the user's Agent Library.

The model is compatible with Skillet's useful `prompt`, `actual`, and
`expected` evaluation concepts, but does not require Skillet, Claude Code,
Docker, provider credentials, or a global `~/.skillet` directory.

## Later evaluation workspace

Explicit opt-in can export/import compatible YAML scenarios and run a selected
agent before/after a draft. It must show provider, cost, network, credentials,
and the exact plan before execution. Raw chats are never captured
automatically; scenarios are reviewed and secret-scanned before sync or share.

## Delivery order

1. dotagents provenance, ownership, first-seen, review, and fork lineage.
2. All Skills incoming group and source/ownership UI.
3. Fork and private improvement notes.
4. Safe lint in owned/forked details only.
5. Remove the Quality sidebar destination and migrate useful data.
6. Add the optional evaluation workspace.
