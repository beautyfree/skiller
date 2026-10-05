# Skiller website

The homepage is authored in `docs/index.html`. Blog content lives in `website/`.
The site is plain static HTML. Python 3 (standard library only) builds the public
artifact; there is no client-side content fetch, CMS or package installation.

## Build and preview

```sh
python3 scripts/test-site.py
python3 scripts/build-site.py
python3 -m http.server 4318 --bind 127.0.0.1 --directory .site
```

Open `http://127.0.0.1:4318/blog/`. Always serve `.site`, not the repository or
`docs/`: the latter contains internal engineering documents. `.site` is disposable
and ignored by Git. The build removes only that generated directory before a
rebuild, so deleted articles do not survive. An external `--output` directory
must be empty.

## Add or edit a guide

1. Add a record to `website/articles.json`: slug, title, description, category,
   date, image, imageAlt, answer, related slugs and official sources.
2. Write `website/articles/<slug>.html` as an HTML fragment. Use `h2` sections
   with unique IDs. The builder derives the table of contents and reading time.
   Do not include a second `h1`. Escape code examples as HTML.
3. Add an original illustration under `docs/images/blog/`. Do not copy a
   reference site's text, artwork, testimonials or unsupported claims.
4. Link to relevant guides in the prose. Related links, the catalog, sitemap,
   RSS and llms.txt are derived from the manifest.
5. Build and inspect desktop and mobile. Confirm target-client behavior when
   changing setup advice; file placement alone is not a discovery test.

The first manifest entry is the featured guide. The first three entries appear
on the homepage. Category buttons are progressive enhancement: the complete
catalog and every article are readable without JavaScript.

Dates represent the guide's publication/revision date, not the build time. Keep
them truthful when publishing. The initial guides were authored on 2026-10-04;
if publication happens later, update their dates before release. For later edits,
keep `date` as the publication date and add `modified` for the revision date.
Do not mass-refresh dates to make unchanged content look new.

## Public artifact and checks

The build copies only the homepage, explicit public assets and the custom 404
page. It generates blog pages, `robots.txt`, `sitemap.xml`, `/blog/feed.xml`,
`llms.txt`, `CNAME` and `.nojekyll`. The manifest owns article metadata and
BlogPosting/BreadcrumbList data. The homepage describes the actual application;
there are no invented ratings, reviews, prices or traffic statistics.

Build checks cover unique titles/descriptions, one H1, canonical and social
URLs, JSON-LD parsing, image alt attributes, local resources and anchors, exact
sitemap coverage, RSS item count and exclusion of internal source documents.
The integration tests exercise rejection of broken anchors, wrong canonicals
and leaked internal documents.

The Pages workflow validates pull requests and builds a Pages artifact. Deployment
runs only for the existing main-branch push or manual dispatch paths, using the
generated `.site` directory. A local build does not publish the website.

## Fonts and images

The blog uses locally served DM Sans (variable 400–700) and Instrument Serif
(regular/italic), with `font-display: swap`. WOFF2 Latin and Latin Extended subsets
were obtained from Google Fonts; their OFL licenses are alongside the files in
`docs/assets/fonts/`. Illustrations are original repository-owned SVGs. Social
previews use the existing 1200×630 Skiller image.

## After an authorized publication

1. Verify the Pages workflow and fetch the live homepage, blog, all article URLs,
   robots, sitemap, RSS, llms.txt and a nonexistent URL (must return HTTP 404).
2. Confirm the live canonical domain, social images and structured data. Check
   HTTPS and any legacy-host redirects at the hosting layer.
3. In the owner's Google Search Console property, submit
   `https://skiller.download/sitemap.xml` and inspect a sample of URLs. Set up
   Bing Webmaster Tools if used. Verification requires owner access.
4. Measure real indexing, queries, clicks and Core Web Vitals after release.
   Do not infer rankings from a build passing or a sitemap being reachable.
5. Use the SEO Skill CLI for saved before/after crawl reports when disk space
   permits: `seo report --url https://skiller.download/` and focused page audits.
   Search Console and paid research-provider data are separate from crawl checks.

`llms.txt` is a convenient descriptive directory for AI tools, not a Google
indexing requirement or an established ranking signal. Robots allows all
crawlers; crawler-specific copies of that allow rule are unnecessary.

Blog typography uses self-hosted Geist and Manrope variable fonts from Google Fonts, with their OFL license files in docs/assets/fonts. The homepage retains its original fonts.

Editorial covers: six original AI-generated illustrations, optimized as WebP (1200px wide); image dimensions and alt text live in articles.json. The earlier SVG covers are retained as source history.

Download flow: /download/ resolves GitHub’s latest stable release at runtime, selects only exact installer assets and includes platform-specific installation steps. Site Download links use ?start=1 to request auto-start only after reliable platform detection. Mac chip detection is manual when the browser provides no architecture hints. Mobile users choose their target desktop. Without JavaScript or GitHub API access, the page offers the latest release on GitHub. Check logic with node --test scripts/test-download.mjs.
