# Skiller Marketplace Gateway

This Vercel Function fetches skills.sh catalog, search, and preview data on
behalf of Skiller desktop. It uses Vercel's per-request OIDC token server-side.
Catalog/search responses cache for 15 minutes (one day stale-while-revalidate);
individual file snapshots cache for 24 hours (seven days stale-while-revalidate).

It intentionally has no relationship to `dotagents`: dotagents manages a
portable agent library, while Marketplace discovery belongs to Skiller.

## Local verification

`VERCEL_OIDC_TOKEN` must be a valid Vercel OIDC token when running locally.
Run `bun run marketplace:dev`, then request:

`/api/v1/skills/vercel-labs/skills/find-skills`

Set `SKILLER_MARKETPLACE_PROXY_URL` in the desktop environment only after this
gateway has a deployed URL. Until then Skiller retains its legacy fallbacks.
