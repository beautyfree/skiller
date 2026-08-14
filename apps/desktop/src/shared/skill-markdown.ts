import { parse } from 'yaml'

export type SkillFrontmatter = {
  description?: string
  [key: string]: unknown
}

export type ParsedSkillMarkdown = {
  body: string
  frontmatter: SkillFrontmatter | null
}

/**
 * Parses the optional YAML frontmatter used by SKILL.md files. YAML block
 * scalars (`description: |` / `description: >`) are intentionally delegated
 * to the YAML parser instead of being treated as a one-line regular expression.
 */
export function parseSkillMarkdown(raw: string): ParsedSkillMarkdown {
  const normalized = raw.replace(/\r\n/g, '\n').replace(/^\uFEFF/, '')
  const match = normalized.match(/^---[ \t]*\n([\s\S]*?)\n(?:---|\.\.\.)[ \t]*(?:\n|$)/)
  if (!match) return { body: normalized.trim(), frontmatter: null }

  let frontmatter: SkillFrontmatter | null = null
  try {
    const parsed = parse(match[1])
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      frontmatter = parsed as SkillFrontmatter
    }
  } catch {
    // Keep the body preview useful even if a third-party skill has malformed
    // metadata. The invalid metadata itself must not render as Markdown.
  }

  return { body: normalized.slice(match[0].length).trim(), frontmatter }
}

/** A list-safe summary: YAML's literal and folded multiline styles become one sentence. */
export function skillMarkdownDescription(raw: string): string | null {
  const value = parseSkillMarkdown(raw).frontmatter?.description
  if (typeof value !== 'string') return null
  const summary = value.replace(/\s+/g, ' ').trim()
  return summary || null
}

export function extractSkillMarkdownBody(raw: string): string {
  return parseSkillMarkdown(raw).body
}
