#!/usr/bin/env python3
"""Build and validate the public site with the Python standard library."""
import argparse
from datetime import date, datetime, timezone
from email.utils import format_datetime
from html import escape
from html.parser import HTMLParser
import json
import math
from pathlib import Path
import re
import shutil
from string import Template
import sys
from urllib.parse import unquote, urlsplit
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
SITE = "https://skiller.download"
AUTHOR = {"@type": "Person", "@id": SITE + "/#author", "name": "beautyfree", "url": "https://github.com/beautyfree"}
PUBLISHER = {"@type": "Organization", "@id": SITE + "/#publisher", "name": "Skiller", "url": SITE + "/", "logo": {"@type": "ImageObject", "url": SITE + "/images/skiller-mark.png"}}


class Document(HTMLParser):
    def __init__(self, source):
        super().__init__(convert_charrefs=True)
        self.headings, self.links, self.images = [], [], []
        self.ids, self.duplicates = set(), []
        self.meta, self.canonicals, self.titles, self.schemas = {}, [], [], []
        self.text, self.current, self.skip = [], None, 0
        self.feed(source)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if "id" in attrs:
            identity = attrs["id"]
            if identity in self.ids:
                self.duplicates.append(identity)
            self.ids.add(identity)
        if tag in ("h1", "h2", "h3", "title"):
            self.current = [tag, attrs.get("id"), ""]
        if tag == "meta":
            self.meta[attrs.get("name", attrs.get("property"))] = attrs.get("content", "")
        if tag in ("a", "link") and attrs.get("href"):
            self.links.append(attrs["href"])
            if tag == "link" and attrs.get("rel") == "canonical":
                self.canonicals.append(attrs["href"])
        if tag == "img":
            self.images.append(attrs)
        if tag == "script" and attrs.get("type") == "application/ld+json":
            self.current = ["schema", None, ""]
        if tag == "script" and attrs.get("src"):
            self.links.append(attrs["src"])
        if tag in ("script", "style"):
            self.skip += 1

    def handle_endtag(self, tag):
        if self.current and (self.current[0] == tag or self.current[0] == "schema" and tag == "script"):
            kind, identity, text = self.current
            if kind in ("h1", "h2", "h3"):
                self.headings.append((kind, identity, text.strip()))
            elif kind == "title":
                self.titles.append(text.strip())
            else:
                self.schemas.append(json.loads(text))
            self.current = None
        if tag in ("script", "style"):
            self.skip -= 1

    def handle_data(self, data):
        if self.current:
            self.current[2] += data
        if not self.skip:
            self.text.append(data)


def jsonld(graph):
    return json.dumps({"@context": "https://schema.org", "@graph": graph}, ensure_ascii=False).replace("<", "\\u003c")


def url(article):
    return "/blog/" + article["slug"] + "/"


def label(value):
    return date.fromisoformat(value).strftime("%b %d, %Y")


def load_articles():
    articles = json.loads((ROOT / "website/articles.json").read_text())
    slugs = [a["slug"] for a in articles]
    if len(set(slugs)) != len(slugs):
        raise ValueError("Duplicate article slug")
    for article in articles:
        slug = article["slug"]
        if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", slug):
            raise ValueError("Invalid article slug: " + slug)
        date.fromisoformat(article["date"])
        article["modified"] = article.get("modified", article["date"])
        if date.fromisoformat(article["modified"]) < date.fromisoformat(article["date"]):
            raise ValueError("Modification date precedes publication: " + slug)
        body = (ROOT / "website/articles" / (slug + ".html")).read_text()
        doc = Document(body)
        headings = [h for h in doc.headings if h[0] == "h2"]
        if not headings or any(not identity for _, identity, _ in headings) or doc.duplicates:
            raise ValueError("Every article section needs a unique h2 id: " + slug)
        if any(h[0] == "h1" for h in doc.headings):
            raise ValueError("Article body must not add a second h1: " + slug)
        if any(target not in slugs or target == slug for target in article["related"]):
            raise ValueError("Invalid related article: " + slug)
        if not article["image"].startswith("/images/") or not (ROOT / "docs" / article["image"].lstrip("/")).is_file():
            raise ValueError("Missing local article illustration: " + slug)
        for _, source in article["sources"]:
            if urlsplit(source).scheme != "https":
                raise ValueError("Sources must use HTTPS: " + slug)
        article["body"], article["headings"] = body.replace("<pre>", '<pre tabindex="0" aria-label="Code example">'), headings
        faq_text = " ".join(item["question"] + " " + item["answer"] for item in article["faq"])
        article["words"] = len(re.findall(r"\b[\w'-]+\b", " ".join(doc.text) + " " + article["answer"] + " " + faq_text))
        article["minutes"] = max(1, math.ceil(article["words"] / 200))
    return articles


def breadcrumbs(items):
    return {"@type": "BreadcrumbList", "itemListElement": [{"@type": "ListItem", "position": i, "name": name, "item": SITE + path} for i, (name, path) in enumerate(items, 1)]}


def footer_nav():
    return (ROOT / "website/templates/footer-nav.html").read_text()


def render_page(title, description, path, content, graph, article_meta="", og_type="website", page_styles="", image=None):
    template = Template((ROOT / "website/templates/base.html").read_text())
    image = image or {"image": "/images/og-skiller.png", "imageWidth": 1200, "imageHeight": 630, "imageAlt": "Skiller — your skills HQ"}
    image_type = {".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg"}[Path(image["image"]).suffix]
    return template.substitute(footer_nav=footer_nav(), title=escape(title), description=escape(description, quote=True), canonical=SITE + path, content=content, schema=jsonld(graph), article_meta=article_meta, og_type=og_type, page_styles=page_styles, og_image=SITE + image["image"], og_image_width=image["imageWidth"], og_image_height=image["imageHeight"], og_image_type=image_type, og_image_alt=escape(image["imageAlt"], quote=True), blog_nav='' if path.startswith("/blog/") else '<a class="nav-cta" href="/blog/">Blog</a>')


def card(article, level="h2"):
    path = url(article)
    return f'''<article class="article-card" data-category="{escape(article['category'])}">
      <a class="card-art" href="{path}" aria-label="Read {escape(article['title'], quote=True)}"><img src="{article['image']}" srcset="{article['imageSmall']} 800w, {article['image']} 1200w" sizes="(max-width: 600px) calc(100vw - 32px), (max-width: 1000px) 45vw, 380px" alt="" width="{article.get('imageWidth',960)}" height="{article.get('imageHeight',600)}" loading="lazy" decoding="async"><span class="reading-badge">{article['minutes']} min read</span></a>
      <div class="card-content">
        <p class="category-chip">{escape(article['category'])}</p>
        <{level}><a href="{path}">{escape(article['title'])}</a></{level}>
        <p class="card-description">{escape(article['description'])}</p>
        <div class="card-meta"><time datetime="{article['modified']}">Updated {label(article['modified'])}</time></div>
      </div>
    </article>'''


def blog_index(articles):
    featured = articles[0]
    feature_cta = "Read the comparison" if featured.get("comparisonCount") else "Read the guide"
    feature_count = f'<p class="comparison-count">{featured["comparisonCount"]} tools compared</p>' if featured.get("comparisonCount") else ""
    categories = list(dict.fromkeys(a["category"] for a in articles))
    filters = f'<button type="button" aria-pressed="true" data-filter="all">All <span>{len(articles)}</span></button>' + "".join(f'<button type="button" aria-pressed="false" data-filter="{escape(c)}">{escape(c)} <span>{sum(a['category'] == c for a in articles)}</span></button>' for c in categories)
    content = f'''<main id="main" class="blog-index">
      <header class="blog-intro"><div><p class="blog-label"><img src="/images/skiller-mark.png" width="18" height="18" alt="">Skiller Blog</p><h1>Agent skills,<br>made practical.</h1></div><p class="blog-lede">Guides to writing, installing and sharing skills across Claude Code, Codex and Cursor. Understand how they work, set them up, and build workflows you can reuse.</p></header>
      <article class="feature"><a class="feature-visual" href="{url(featured)}" aria-label="Read {escape(featured['title'], quote=True)}"><img src="{featured['image']}" srcset="{featured['imageSmall']} 800w, {featured['image']} 1200w" sizes="(max-width: 720px) calc(100vw - 32px), 600px" width="{featured.get('imageWidth',960)}" height="{featured.get('imageHeight',600)}" alt="{escape(featured['imageAlt'])}" fetchpriority="high"><span class="reading-badge">{featured['minutes']} min read</span></a><div class="feature-copy"><p class="category-chip">{escape(featured['category'])}</p><h2><a href="{url(featured)}">{escape(featured['title'])}</a></h2><p>{escape(featured['description'])}</p>{feature_count}<div class="card-meta">Updated {label(featured['modified'])}</div><a class="feature-read" href="{url(featured)}">{feature_cta} <span aria-hidden="true">→</span></a></div></article>
      <div class="filter-bar" role="group" aria-label="Filter articles by topic" hidden>{filters}<span class="article-count sr-only" role="status" aria-live="polite">{len(articles)} guides</span></div>
      <section class="article-grid" aria-label="All guides">{''.join(card(a) for a in articles)}</section>
      <p class="blog-end">Written by the maker of Skiller, with links to the original documentation. Follow new guides via <a href="/blog/feed.xml">RSS</a>.</p>
    </main>'''
    graph = [PUBLISHER, AUTHOR, {"@type": "Blog", "@id": SITE + "/blog/#blog", "name": "Skiller Blog", "url": SITE + "/blog/", "description": "Practical guides to writing, installing and sharing agent skills.", "inLanguage": "en", "publisher": {"@id": PUBLISHER["@id"]}}, {"@type": "ItemList", "itemListElement": [{"@type": "ListItem", "position": i, "url": SITE + url(a), "name": a["title"]} for i, a in enumerate(articles, 1)]}, breadcrumbs([("Home", "/"), ("Blog", "/blog/")])]
    return render_page("Agent skills guides & workflows | Skiller Blog", "Practical guides to SKILL.md, Claude Code and Codex skills, multi-agent synchronization, and the difference between skills and MCP.", "/blog/", content, graph)


def article_page(article, by_slug):
    template = Template((ROOT / "website/templates/article.html").read_text())
    hero = f'<figure class="article-hero"><img src="{article["image"]}" srcset="{article["imageSmall"]} 800w, {article["image"]} 1200w" sizes="(max-width: 792px) calc(100vw - 32px), 760px" alt="{escape(article["imageAlt"], quote=True)}" width="{article.get('imageWidth',960)}" height="{article.get('imageHeight',600)}" fetchpriority="high" decoding="async"></figure>'
    visible_date = ("Updated " if article["modified"] != article["date"] else "Published ") + label(article["modified"])
    faq = '<section class="article-faq" aria-labelledby="faq"><h2 id="faq">FAQ</h2>' + "".join('<div><h3>' + escape(item["question"]) + '</h3><p>' + escape(item["answer"]) + '</p></div>' for item in article["faq"]) + '</section>'
    content = template.substitute(faq=faq, category=escape(article["category"]), headline=escape(article["title"]), description=escape(article["description"]), date=article["modified"], date_label=visible_date, reading_time=article["minutes"], comparison_meta=(f'<span aria-hidden="true">·</span><span>{article["comparisonCount"]} tools compared</span>' if article.get("comparisonCount") else ""), hero=hero, answer=escape(article["answer"]), body=article["body"], toc="".join(f'<li><a href="#{identity}">{escape({"comparison-table": "Comparison", "which-tool": "Quick picks", "tools-in-detail": "The tools in detail"}.get(identity, title))}</a></li>' for _, identity, title in article["headings"]), sources="".join(f'<li><a href="{escape(source, quote=True)}" target="_blank" rel="noopener noreferrer">{escape(name)}</a></li>' for name, source in article["sources"]), related="".join(card(by_slug[slug], "h3") for slug in article["related"]))
    path = url(article)
    graph = [AUTHOR, PUBLISHER, {"@type": "BlogPosting", "@id": SITE + path + "#article", "mainEntityOfPage": SITE + path, "url": SITE + path, "headline": article["title"], "description": article["description"], "image": SITE + article["image"], "datePublished": article["date"], "dateModified": article["modified"], "author": {"@id": AUTHOR["@id"]}, "publisher": {"@id": PUBLISHER["@id"]}, "articleSection": article["category"], "wordCount": article["words"], "inLanguage": "en", "isPartOf": {"@id": SITE + "/blog/#blog"}}, breadcrumbs([("Blog", "/blog/"), (article["title"], path)])]
    graph.append({"@type": "FAQPage", "@id": SITE + path + "#faq", "mainEntity": [{"@type": "Question", "name": item["question"], "acceptedAnswer": {"@type": "Answer", "text": item["answer"]}} for item in article["faq"]]})
    if article.get("comparisonCount"):
        tools = [(identity, name) for kind, identity, name in Document(article["body"]).headings if kind == "h3" and identity]
        if len(tools) != article["comparisonCount"]:
            raise ValueError("Comparison count must match product headings: " + article["slug"])
        graph.append({"@type": "ItemList", "@id": SITE + path + "#tools", "name": article["title"], "itemListElement": [{"@type": "ListItem", "position": i, "name": name, "url": SITE + path + "#" + identity} for i, (identity, name) in enumerate(tools, 1)]})
    metadata = f'<meta property="article:published_time" content="{article["date"]}"><meta property="article:modified_time" content="{article["modified"]}"><meta property="article:author" content="https://github.com/beautyfree"><meta property="article:section" content="{escape(article["category"])}">'
    return render_page(article["title"] + " | Skiller", article["description"], path, content, graph, metadata, "article", image=article)


def download_page():
    content = (ROOT / "website/templates/download.html").read_text()
    graph = [PUBLISHER, {"@type": "WebPage", "name": "Download Skiller", "url": SITE + "/download/", "description": "Download the latest Skiller release for macOS, Windows or Linux and follow the installation steps."}, breadcrumbs([("Home", "/"), ("Download", "/download/")])]
    return render_page("Download Skiller for macOS, Windows & Linux", "Get the latest Skiller installer for your operating system, choose Apple silicon or Intel, and follow the macOS, Windows or Linux installation guide.", "/download/", content, graph, page_styles='<link rel="stylesheet" href="/assets/download.css?v=4">')


def write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def build(output):
    articles = load_articles()
    output.mkdir(parents=True, exist_ok=True)
    # Internal docs never enter the artifact: copy only explicitly public assets.
    for directory in ("images", "assets"):
        shutil.copytree(ROOT / "docs" / directory, output / directory, dirs_exist_ok=True)
    for filename in ("favicon-16x16.png", "favicon-32x32.png", "apple-touch-icon.png", "CNAME", "404.html"):
        shutil.copy2(ROOT / "docs" / filename, output / filename)
    home = (ROOT / "docs/index.html").read_text()
    # Inline the small landing styles at build time; retain their source ownership.
    # Absolute asset URLs in these files keep the same resolution after inlining.
    def inline_landing_style(match):
        asset = match.group(1).split("?", 1)[0]
        return "<style>\n" + (ROOT / "docs" / asset.lstrip("/")).read_text() + "\n</style>"
    home = re.sub(r'<link rel="stylesheet" href="(/assets/[^"\s]+)"\s*/?>', inline_landing_style, home)
    preview = '<section class="blog-preview" aria-labelledby="guides-title"><h2 class="section-title" id="guides-title">From the notebook</h2><p class="section-sub">Practical guides for a more useful agent skill library.</p><div class="notebook-grid">' + "".join(card(a, level="h3") for a in articles) + '</div><p class="notebook-more"><a class="nav-cta" href="/blog/">Explore the notebook →</a></p></section>'
    if home.count("<!-- BLOG_PREVIEW -->") != 1:
        raise ValueError("Homepage needs exactly one BLOG_PREVIEW marker")
    if home.count("<!-- FOOTER_NAV -->") != 1:
        raise ValueError("Homepage needs exactly one FOOTER_NAV marker")
    write(output / "index.html", home.replace("<!-- BLOG_PREVIEW -->", preview).replace("<!-- FOOTER_NAV -->", footer_nav()))
    write(output / ".nojekyll", "")
    write(output / "blog/index.html", blog_index(articles))
    write(output / "download/index.html", download_page())
    by_slug = {a["slug"]: a for a in articles}
    for article in articles:
        write(output / url(article).lstrip("/") / "index.html", article_page(article, by_slug))
    sitemap = ET.Element("urlset", xmlns="http://www.sitemaps.org/schemas/sitemap/0.9")
    entries = [("/", None), ("/download/", None), ("/blog/", max(a["modified"] for a in articles))] + [(url(a), a["modified"]) for a in articles]
    for path, modified in entries:
        entry = ET.SubElement(sitemap, "url")
        ET.SubElement(entry, "loc").text = SITE + path
        if modified:
            ET.SubElement(entry, "lastmod").text = modified
    write(output / "sitemap.xml", '<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(sitemap, encoding="unicode") + "\n")
    write(output / "robots.txt", "User-agent: *\nAllow: /\n\nSitemap: " + SITE + "/sitemap.xml\n")
    channel = ET.Element("channel")
    feed = ET.Element("rss", version="2.0")
    feed.append(channel)
    ET.register_namespace("atom", "http://www.w3.org/2005/Atom")
    ET.SubElement(channel, "{http://www.w3.org/2005/Atom}link", href=SITE + "/blog/feed.xml", rel="self", type="application/rss+xml")
    for tag, value in [("title", "Skiller Blog"), ("link", SITE + "/blog/"), ("description", "Practical guides to writing, installing and sharing agent skills."), ("language", "en")]:
        ET.SubElement(channel, tag).text = value
    for article in articles:
        item = ET.SubElement(channel, "item")
        stamp = datetime.combine(date.fromisoformat(article["date"]), datetime.min.time(), tzinfo=timezone.utc)
        for tag, value in [("title", article["title"]), ("link", SITE + url(article)), ("guid", SITE + url(article)), ("description", article["description"]), ("pubDate", format_datetime(stamp, usegmt=True))]:
            ET.SubElement(item, tag).text = value
    write(output / "blog/feed.xml", '<?xml version="1.0" encoding="UTF-8"?>\n' + ET.tostring(feed, encoding="unicode") + "\n")
    write(output / "llms.txt", "# Skiller\n\n> Skiller is a desktop app for inspecting, editing, installing and synchronizing agent skills (SKILL.md) across coding agents. It runs on macOS, Windows and Linux.\n\n## Product\n\n- [Official site](" + SITE + "/)\n- [Source and product documentation](https://github.com/beautyfree/skiller)\n- [Downloads](https://skiller.download/download/)\n\n## Guides\n\n" + "\n".join(f'- [{a["title"]}]({SITE}{url(a)}): {a["description"]}' for a in articles) + "\n\n## Scope\n\nSkills provide procedures, not authorization. Agent paths and supported features vary by client version. Installing a skill does not configure its MCP dependencies. Refer to official client documentation linked in each guide.\n")
    return articles


def check(output):
    errors, titles, descriptions = [], set(), set()
    documents = {path: Document(path.read_text()) for path in sorted(output.rglob("*.html"))}
    for path, doc in documents.items():
        relative = path.relative_to(output)
        if doc.duplicates:
            errors.append(f"{relative}: duplicate IDs {doc.duplicates}")
        if relative == Path("404.html"):
            if "noindex" not in doc.meta.get("robots", ""):
                errors.append("404 page must be noindex")
            continue
        page_url = SITE + "/" + str(relative.parent) + "/" if relative.parent != Path(".") else SITE + "/"
        if doc.canonicals != [page_url]:
            errors.append(f"{relative}: incorrect canonical {doc.canonicals}, expected {page_url}")
        if len([h for h in doc.headings if h[0] == "h1"]) != 1:
            errors.append(f"{relative}: expected one h1")
        if len(doc.titles) != 1 or doc.titles[0] in titles:
            errors.append(f"{relative}: missing or duplicate title")
        titles.update(doc.titles)
        description = doc.meta.get("description", "")
        if not description or description in descriptions:
            errors.append(f"{relative}: missing or duplicate description")
        descriptions.add(description)
        for key in ("og:title", "og:description", "og:image", "og:image:alt", "og:image:type", "og:locale", "og:url", "twitter:card", "twitter:title", "twitter:description", "twitter:image", "twitter:image:alt", "theme-color"):
            if not doc.meta.get(key):
                errors.append(f"{relative}: missing {key}")
        if doc.meta.get("og:url") != page_url or "noindex" in doc.meta.get("robots", ""):
            errors.append(f"{relative}: invalid indexability or social URL")
        if not doc.schemas:
            errors.append(f"{relative}: missing structured data")
        if "max-image-preview:large" not in doc.meta.get("robots", ""):
            errors.append(f"{relative}: large image previews must be allowed")
        for reference in (doc.meta.get("og:image", ""), doc.meta.get("twitter:image", "")):
            parsed = urlsplit(reference)
            if parsed.scheme != "https" or parsed.netloc != "skiller.download" or not (output / unquote(parsed.path).lstrip("/")).is_file():
                errors.append(f"{relative}: invalid social image {reference}")
        for image in doc.images:
            if "alt" not in image:
                errors.append(f"{relative}: image without alt")
        for reference in doc.links + [image.get("src", "") for image in doc.images]:
            parsed = urlsplit(reference)
            if (parsed.scheme or parsed.netloc) and parsed.netloc != "skiller.download":
                continue
            target = output / unquote(parsed.path).lstrip("/") if parsed.path.startswith("/") else path.parent / unquote(parsed.path)
            if not parsed.path:
                target = path
            if target.is_dir():
                target /= "index.html"
            if not target.is_file():
                errors.append(f"{relative}: missing local target {reference}")
            elif parsed.fragment and target in documents and parsed.fragment not in documents[target].ids:
                errors.append(f"{relative}: missing anchor {reference}")
    ns = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9"}
    locations = [e.text for e in ET.parse(output / "sitemap.xml").findall("s:url/s:loc", ns)]
    expected = {d.canonicals[0] for p, d in documents.items() if p.name != "404.html" and d.canonicals}
    if set(locations) != expected or len(locations) != len(set(locations)):
        errors.append("Sitemap must include exactly the indexable pages")
    robots = (output / "robots.txt").read_text()
    if "User-agent: *\nAllow: /" not in robots or "Sitemap: " + SITE + "/sitemap.xml" not in robots:
        errors.append("robots.txt must allow crawling and declare the sitemap")
    if len(ET.parse(output / "blog/feed.xml").findall("channel/item")) != len(load_articles()):
        errors.append("RSS item count does not match article count")
    if list(output.rglob("*.md")) or list(output.rglob("*.toml")) or list(output.rglob("*.json")):
        errors.append("Internal source documents leaked into the public artifact")
    if errors:
        raise ValueError("\n".join(errors))
    print(f"Checked {len(documents) - 1} indexable pages: metadata, schemas, local links, anchors, sitemap, RSS and public-only output.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / ".site")
    parser.add_argument("--check", action="store_true", help="Validate an existing generated site")
    args = parser.parse_args()
    if args.output.is_symlink():
        parser.error("Refusing a symlink output directory")
    output = args.output.resolve()
    if output == ROOT or ROOT in output.parents and output != ROOT / ".site":
        parser.error("Use .site or an output directory outside the repository")
    if args.check:
        check(output)
        return
    # Only the default generated directory is disposable. External destinations
    # must be empty, protecting unrelated data and removing stale article output.
    if output == ROOT / ".site" and output.exists():
        shutil.rmtree(output)
    elif output.exists() and any(output.iterdir()):
        parser.error("Custom output directory must be empty")
    articles = build(output)
    check(output)
    print(f"Built {len(articles)} articles into {output}")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, KeyError) as error:
        print(f"Site build failed: {error}", file=sys.stderr)
        sys.exit(1)
