# Skill Quality sandbox

Skiller never pulls or builds evaluation images automatically. To create the
default local image after reviewing this Dockerfile, run:

```sh
bun run quality:sandbox:build
```

The build context is restricted to this directory, so repository files and
local skill libraries are not sent to Docker. The resulting local image is
resolved to its immutable `sha256:` image ID in every evaluation plan. A
rebuild therefore invalidates any earlier review.

Both agent packages are pinned. Codex is installed with lifecycle scripts
disabled. Claude Code's pinned package is installed with its required
postinstall enabled so that npm can fetch the matching platform-native binary;
review this file before rebuilding when either version changes.

Codex and Claude credentials are not copied into the image. A measured plan
can mount exactly one matching local profile read-only after explicit review.
Dry checks mount no credentials, pass no host environment values, and always
use `--network none`.
