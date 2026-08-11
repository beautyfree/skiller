/**
 * Extract markdown body after YAML frontmatter.
 * Only treats `---` as frontmatter delimiters when they appear on their own line.
 */
export function extractMarkdownBody(raw: string): string {
  const normalized = raw.replace(/\r\n/g, "\n");
  const trimmed = normalized.trimStart();
  const lines = trimmed.split("\n");

  if (lines[0]?.trim() !== "---") return trimmed;

  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === "---") {
      return lines.slice(i + 1).join("\n").trim();
    }
  }

  return trimmed;
}
