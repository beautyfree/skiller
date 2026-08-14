/**
 * Shared shell spacing (Linear-style window inset, scrollbar gutter).
 * Single source of truth so layout and scroll regions stay aligned.
 */

/** Gap from the right window edge to app chrome (Linear-style). */
export const WINDOW_EDGE_INSET_RIGHT = "pr-2.5";

/** Space before the vertical scrollbar so it does not hug the panel edge. */
export const SCROLLBAR_EDGE_INSET = "pr-1.5";

/** Shared master-pane geometry for All Skills, Marketplace, and Agent Library. */
export const SKILL_LIST_PANE = {
  initial: 340,
  min: 240,
  max: 560,
  storageKey: "shared-skill-list-width",
} as const;
