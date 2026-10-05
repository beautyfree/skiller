#!/usr/bin/env python3
"""Exercise the publication gate against actual generated HTML."""
import contextlib
import importlib.util
import io
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("site_builder", Path(__file__).with_name("build-site.py"))
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


class PublicSiteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory(prefix="skiller-site-test-")
        cls.output = Path(cls.temporary.name) / "public"
        builder.build(cls.output)

    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()

    def test_complete_public_artifact(self):
        with contextlib.redirect_stdout(io.StringIO()):
            builder.check(self.output)
        self.assertTrue((self.output / "CNAME").is_file())
        self.assertFalse((self.output / "DEVELOPMENT.md").exists())
        self.assertIn("noindex", (self.output / "404.html").read_text())

    def test_shared_footer_links_to_published_comparisons(self):
        footer = builder.footer_nav()
        for page in ("index.html", "download/index.html", "blog/index.html", "blog/skiller-vs-openskills/index.html"):
            self.assertIn(footer, (self.output / page).read_text())
        for slug in ("skiller-vs-skills-cli", "skiller-vs-openskills", "skiller-vs-skills-manager", "skiller-vs-jiwei-skills-manager", "skiller-vs-skills-hub", "skiller-vs-skillhub-desktop"):
            self.assertIn(f'href="/blog/{slug}/"', footer)
            self.assertTrue((self.output / "blog" / slug / "index.html").is_file())
            self.assertIn(builder.SITE + f"/blog/{slug}/", (self.output / "sitemap.xml").read_text())

    def test_landing_critical_resources(self):
        home = (self.output / "index.html").read_text()
        self.assertNotIn('rel="stylesheet"', home)
        self.assertNotIn('fonts.googleapis.com', home)
        self.assertNotIn('href="/assets/fonts/geist-variable.ttf"', home)
        self.assertIn('as="image" fetchpriority="high"', home)
        for image in builder.Document(home).images:
            if '/screenshots/' in image.get('src', ''):
                self.assertIn('400w', image['srcset'])
                if image.get('loading') == 'eager':
                    self.assertEqual(image['fetchpriority'], 'high')

    def test_broken_editorial_anchor_blocks_publication(self):
        target = self.output / "blog/what-are-agent-skills/index.html"
        original = target.read_text()
        try:
            target.write_text(original.replace('href="#inside-skill-md"', 'href="#missing-section"'))
            with self.assertRaisesRegex(ValueError, "missing anchor #missing-section"):
                builder.check(self.output)
        finally:
            target.write_text(original)

    def test_internal_document_blocks_publication(self):
        target = self.output / "internal-notes.md"
        try:
            target.write_text("Internal notes must never be published")
            with self.assertRaisesRegex(ValueError, "Internal source documents leaked"):
                builder.check(self.output)
        finally:
            target.unlink()

    def test_wrong_canonical_blocks_publication(self):
        target = self.output / "blog/install-skills-codex/index.html"
        original = target.read_text()
        try:
            target.write_text(original.replace('rel="canonical" href="https://skiller.download/blog/install-skills-codex/"', 'rel="canonical" href="https://skiller.download/"'))
            with self.assertRaisesRegex(ValueError, "incorrect canonical"):
                builder.check(self.output)
        finally:
            target.write_text(original)

    def test_article_previews_and_responsive_screenshots(self):
        for article in builder.load_articles():
            page = self.output / builder.url(article).lstrip("/") / "index.html"
            doc = builder.Document(page.read_text())
            expected = builder.SITE + article["image"]
            self.assertEqual(doc.meta["og:image"], expected)
            self.assertEqual(doc.meta["twitter:image"], expected)
            self.assertEqual(doc.meta["og:image:alt"], article["imageAlt"])
        for page in self.output.rglob("*.html"):
            for image in builder.Document(page.read_text()).images:
                if "/screenshots/" not in image.get("src", ""):
                    continue
                self.assertTrue(image["src"].endswith(".webp"))
                self.assertEqual(image["width"], "1600")
                for candidate in image["srcset"].split(","):
                    path = candidate.strip().split()[0]
                    self.assertTrue((self.output / path.lstrip("/")).is_file())

    def test_structured_faq_and_comparison_match_visible_content(self):
        for article in builder.load_articles():
            doc = builder.Document((self.output / builder.url(article).lstrip("/") / "index.html").read_text())
            graph = doc.schemas[0]["@graph"]
            faq = next(node for node in graph if node["@type"] == "FAQPage")
            self.assertEqual(len(faq["mainEntity"]), len(article["faq"]))
            text = " ".join(doc.text)
            for question in faq["mainEntity"]:
                self.assertIn(question["name"], text)
                self.assertIn(question["acceptedAnswer"]["text"], text)
            if article.get("comparisonCount"):
                tools = next(node for node in graph if node["@type"] == "ItemList")["itemListElement"]
                self.assertEqual(len(tools), article["comparisonCount"])
                for tool in tools:
                    self.assertIn(tool["url"].split("#")[1], doc.ids)

    def test_missing_social_image_blocks_publication(self):
        target = self.output / "blog/what-are-agent-skills/index.html"
        original = target.read_text()
        try:
            target.write_text(original.replace('property="og:image" content="https://skiller.download/images/', 'property="og:image" content="https://skiller.download/missing/'))
            with self.assertRaisesRegex(ValueError, "invalid social image"):
                builder.check(self.output)
        finally:
            target.write_text(original)


if __name__ == "__main__":
    unittest.main()
