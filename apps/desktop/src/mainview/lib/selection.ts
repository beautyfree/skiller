/** Bulk actions may act only on visible, selectable rows. */
export function visibleSkillSelection(selected: Set<string>, visibleIds: Iterable<string>): Set<string> {
  const visible = new Set(visibleIds)
  const next = new Set([...selected].filter(id => visible.has(id)))
  return next.size === selected.size ? selected : next
}

/** Retain the selected result when possible; fall back when the results change. */
export function visibleResultSelection(selected: string | null, visibleIds: string[]): string | null {
  return selected !== null && visibleIds.includes(selected) ? selected : visibleIds[0] ?? null
}
