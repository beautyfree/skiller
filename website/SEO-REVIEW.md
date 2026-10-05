# Skiller blog and SEO review — 2026-10-04

## What was inspected

- `https://seoskill.dev/` and its CLI documentation: evidence-led page/crawl
  audits, explicit separation of crawl checks from Search Console measurements,
  saved before/after reports and follow-up measurement.
- `https://nudgefocus.app/blog/` and the website-blocker comparison article:
  a featured guide, topic filters, readable articles, a short answer, structured
  sections, sources, related links and a product CTA.
- Nudge's live robots.txt, sitemap.xml, llms.txt and JSON-LD: an ordinary sitemap
  of canonical URLs, genuine modification dates and Blog/BlogPosting,
  BreadcrumbList and ItemList descriptions.
- The live Skiller homepage and its GitHub Pages publication workflow. The
  local checkout was one commit behind its existing origin/main snapshot;
  production already had a canonical homepage URL. The existing local footer
  badge change was preserved.
- Current official Agent Skills, Claude Code, Codex, Cursor and MCP docs,
  together with Skiller's README and relevant agent configurations.

Direct requests to Nudge without a browser user agent initially returned 403.
Browser inspection and subsequent requests with a browser user agent succeeded.
This is not evidence that ordinary search crawlers are blocked.

## Verified live baseline

| Observation | Meaning |
| --- | --- |
| Skiller homepage returns 200 | Landing page is reachable |
| Skiller robots.txt returns 404 | No published crawler-rules/sitemap discovery file |
| Skiller sitemap.xml returns 404 | No published sitemap at the standard location |
| Production title, description, canonical and OG image exist | Basic metadata was already present |
| Homepage has no blog navigation or catalog | New guides need crawlable entry points |
| Pages uploads the entire docs directory | Internal technical Markdown is part of the artifact |

## Implemented locally

Eight indexable HTML pages: homepage, blog catalog and six original guides.
Articles are complete HTML in the response, without client-side content fetches.
Each has an author link, date, calculated reading time, original illustration,
short answer, table of contents, substantive sections, official sources and
related guides. Installation/synchronization guides also use existing Skiller
product screenshots where useful.

The blog uses a quiet white sticky masthead, a monochrome Skiller brand, centered editorial links and a compact dark download button. The homepage retains its original visual identity. A right-hand sticky table of contents, sidebar product card and readable article column take structural inspiration from Nudge. It uses
Skiller's existing DM Sans / Instrument Serif typography and rabbit identity.
No Nudge prose, artwork or testimonials were copied. Filters work as an optional
enhancement; every guide stays accessible without JavaScript.

The build owns canonical URLs, article metadata, JSON-LD, sitemap, RSS and
llms.txt from one article manifest. Robots allows all crawlers and points at the
sitemap. There is no need for a sitemap index for eight pages. Homepage social
metadata now uses the canonical public host. The custom 404 page is noindex.

Publication now builds a whitelist of public files. It excludes internal
engineering docs instead of depending on robots.txt to hide them. PRs run the
same build gate without deploying. The homepage includes blog navigation and
three guide previews.

Blog fonts are self-hosted WOFF2 with swap and their OFL licenses. Images have
dimensions, meaningful hero alt text and lazy loading below the fold. Long code
and tables scroll within their own containers, with keyboard access.

## Initial topic map

These are intent hypotheses based on the product and official terminology, not
measured search-volume or ranking estimates. No paid research was performed.

| Guide | Reader's question | Role |
| --- | --- | --- |
| What are agent skills? | What is SKILL.md and why use it? | Conceptual entry point |
| How to write SKILL.md | How do I create and test a skill? | Authoring tutorial |
| Install Claude Code skills | Where do files go and how do I invoke one? | Client-specific setup |
| Install Codex skills | How do shared paths and skill selection work? | Client-specific setup |
| Share across agents | How do I avoid different versions in each tool? | Product-aligned workflow |
| Skills vs MCP | Do I need instructions, tool access or both? | Architectural comparison |

Choose subsequent topics from actual Search Console queries and support
questions. Publish genuinely distinct guides when their user task differs;
avoid generating near-identical pages for every agent or padding articles to a
word-count target. Use real product evidence before writing comparative claims.

## Proof and limits

- The build gate passes for eight indexable pages: unique metadata, one H1,
  canonical/social URLs, parseable JSON-LD, local resources, anchors, sitemap
  coverage, RSS count and public-only output.
- Four integration tests pass, including rejection of broken article anchors,
  wrong canonicals and internal source documents in the output.
- The browser was checked at 1440 and 390 pixels. Filters return the expected
  subset, article anchors navigate to the intended section and the page does
  not overflow horizontally. All six catalog entries remain present with
  JavaScript disabled.
- The SEO Skill CLI installation was attempted using its official npm package
  (`seo@0.2.41`, repository `iannuttall/seo`), but npm stopped with ENOSPC before
  the command could run. There is no SEO Skill CLI audit report or Lighthouse
  score for this change. The local publication gate is our own check.
- Nothing was pushed or deployed. No claim is made about Google indexing,
  rankings, traffic, live Core Web Vitals or rich-result eligibility.

## Release verification still required

After authorized publication, check each live URL and its response, robots,
sitemap, RSS, images, JSON-LD and the hosting-level 404. Confirm HTTPS and legacy
hostname redirects. Submit the sitemap in the owner's Search Console property,
inspect representative URLs and observe index coverage.

Then establish query/click and performance baselines and compare meaningful
time windows after release. The SEO Skill workflow becomes most useful at this
stage, with saved crawls and actual Search Console evidence. `llms.txt` is an
optional descriptive index, not a proven ranking boost. Structured data must
describe the page honestly; it does not guarantee a Google rich result.

Typography: self-hosted Geist for prose and licensed Manrope for display headings, with Nudge-inspired 760px article / 280px sidebar proportions. Nudge uses AsideDisplay for headings; its redistribution license was not established. CTA, sources and related guides belong to the article column; the sidebar spans their full height.

Editorial cover update: six original illustrations inspired by the atmospheric product compositions in Nudge. Optimized WebP covers include explicit dimensions and descriptive alt text; BlogPosting schema points to each article’s actual cover.

Download page is indexable and included in the sitemap, with OS-specific installation instructions. It resolves latest stable release assets in the browser rather than embedding a version that can become stale. Download links on the homepage and blog enter this flow.
