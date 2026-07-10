import { NavLink, Outlet, useSearchParams } from 'react-router-dom'
import { useMemo, useState, useCallback, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'

import { pickFolder, invoke, openUrl } from '@/mainview/lib/native'
import {
  LayoutDashboard,
  Puzzle,
  Store,
  Settings,
  GitBranch,
  FolderOpen,
  FolderKanban,
  Copy,
  Trash2,
  ChevronRight,
} from 'lucide-react'
import { AgentIcon } from '@/mainview/components/AgentIcon'
import { Button } from '@/mainview/components/ui/button'
import ImportWizard from '@/mainview/components/ImportWizard'
import { InsetScrollArea } from '@/mainview/components/InsetScrollArea'
import { WINDOW_EDGE_INSET_RIGHT } from '@/mainview/lib/shell-chrome'
import { useResizable } from '@/mainview/hooks/useResizable'
import ResizeHandle from '@/mainview/components/ResizeHandle'
import { useAgents } from '@/mainview/hooks/useAgents'
import { useSkills, allAgents } from '@/mainview/hooks/useSkills'
import { useProjects } from '@/mainview/hooks/useProjects'

const GITHUB_REPO_URL =
  'https://github.com/beautyfree/skiller-skills-desktop-manager'

// Hoisted outside component — stable reference, no re-creation per render
const NAV_LINK_BASE =
  'flex items-center gap-2 min-h-[28px] rounded-md px-3 py-1.5 text-[13px] font-[510] leading-[18px] border border-transparent outline-none focus-visible:ring-2 focus-visible:ring-ring/50 transition-[color,background-color,border-color,box-shadow,opacity] duration-150'
/** Linear-like active row: muted pill, not indigo fill */
const NAV_LINK_ACTIVE = `${NAV_LINK_BASE} bg-black/[0.05] text-foreground dark:bg-white/[0.09] dark:text-foreground`
const NAV_LINK_INACTIVE = `${NAV_LINK_BASE} text-sidebar-foreground/80 hover:text-foreground hover:bg-black/[0.04] dark:hover:bg-white/[0.05]`

function navLinkClass({ isActive }: { isActive: boolean }) {
  return isActive ? NAV_LINK_ACTIVE : NAV_LINK_INACTIVE
}

const TITLE_BAR_DRAG_HEIGHT = 36
/**
 * Drag band used as the window-move surface above the sidebar + canvas.
 *
 * Uses a host-agnostic class (`app-drag` — see index.css) that works under
 * Electron via the standard `-webkit-app-region: drag` CSS property. The
 * legacy Electrobun class (`electrobun-webkit-app-region-drag`) is kept in
 * parallel so the band also registers as draggable under the old WKWebView
 * build until Phase 5 removes it.
 *
 * On Windows + Linux the band coexists with Electron's native caption-button
 * overlay (configured in src/electron-main/index.ts). The overlay occupies
 * ~135px on the right; `env(titlebar-area-*)` can be consulted by children
 * that need to avoid overlapping the buttons, but the base drag surface is
 * fine as a full-width band because the buttons paint on top with their own
 * hit regions.
 */
const DRAG_CLASSES = 'app-drag electrobun-webkit-app-region-drag'

type LayoutProps = {
  showGithubStarPrompt?: boolean
  onDismissGithubStarPrompt?: () => void
  onGithubStarPromptCta?: () => void
}

export default function Layout(props: LayoutProps) {
  return <LayoutInner {...props} />
}

function LayoutInner({
  showGithubStarPrompt = false,
  onDismissGithubStarPrompt,
  onGithubStarPromptCta,
}: LayoutProps) {
  const { t } = useTranslation()
  const [importMode, setImportMode] = useState<'git' | 'local' | null>(null)
  const [importLocalPath, setImportLocalPath] = useState<string | null>(null)
  const pickingFolder = useRef(false)
  const { data: agents, isLoading: agentsLoading } = useAgents()
  const { data: skills, isLoading: skillsLoading } = useSkills()
  const { data: projects } = useProjects()
  const [searchParams] = useSearchParams()

  const detectedAgents = useMemo(
    () => agents?.filter((a) => a.detected) ?? [],
    [agents]
  )

  const skillCountByAgent = useMemo(() => {
    const counts = new Map<string, number>()
    for (const skill of skills ?? []) {
      for (const slug of allAgents(skill)) {
        counts.set(slug, (counts.get(slug) ?? 0) + 1)
      }
    }
    return counts
  }, [skills])

  // Direct vs inherited breakdown for the sidebar tooltip. The visible number
  // is "everything visible to the agent" (matches user's mental model of
  // "what Claude sees"), but many agents read from the shared ~/.agents
  // library so the breakdown reveals how many are actually owned by the
  // agent vs inherited. Without this the same number on two agents could
  // mean very different things.
  const skillBreakdownByAgent = useMemo(() => {
    const breakdown = new Map<string, { direct: number; inherited: number }>()
    for (const skill of skills ?? []) {
      for (const inst of skill.installations) {
        const prev = breakdown.get(inst.agent_slug) ?? {
          direct: 0,
          inherited: 0,
        }
        if (inst.is_inherited) prev.inherited += 1
        else prev.direct += 1
        breakdown.set(inst.agent_slug, prev)
      }
    }
    return breakdown
  }, [skills])

  const sidebar = useResizable({
    initial: 200,
    min: 200,
    max: 320,
    storageKey: 'sidebar-width',
  })

  const handleImportLocal = useCallback(async () => {
    if (pickingFolder.current) return
    pickingFolder.current = true
    try {
      const selected = await pickFolder()
      if (selected) {
        setImportLocalPath(selected)
        setImportMode('local')
      }
    } finally {
      pickingFolder.current = false
    }
  }, [])

  /** WebKit drag regions often drop `dblclick`; `mousedown` with detail 2 still fires in some builds. */
  const lastTitleBarZoomAt = useRef(0)
  const onTitleBarZoomGesture = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    const now = Date.now()
    if (now - lastTitleBarZoomAt.current < 400) return
    lastTitleBarZoomAt.current = now
    void invoke('window_toggle_maximize')
  }, [])

  const activeAgentSlug = searchParams.get('agent')
  const loading = agentsLoading || skillsLoading

  return (
    <div className="layout-root box-border flex h-screen flex-col overflow-hidden">
      {/* Global drag band as a real layout row (not overlay). */}
      <div
        className={`pointer-events-auto shrink-0 cursor-default select-none ${DRAG_CLASSES}`}
        style={{ height: TITLE_BAR_DRAG_HEIGHT }}
        onMouseDown={(e) => {
          if (e.detail === 2) onTitleBarZoomGesture(e)
        }}
        onDoubleClick={onTitleBarZoomGesture}
        aria-hidden="true"
      />

      <div className={`flex min-h-0 min-w-0 flex-1 overflow-hidden ${WINDOW_EDGE_INSET_RIGHT}`}>
        {/* Sidebar — same plane as canvas */}
        <aside
          aria-label="Sidebar"
          className="layout-sidebar flex h-full shrink-0 flex-col"
          style={{ width: sidebar.width }}
        >
          {loading ? (
            <div className="flex flex-1 flex-col px-3 pb-3 animate-pulse">
              <div className="space-y-1.5 pb-3">
                <div className="h-7 rounded-md bg-muted/50" />
                <div className="h-7 rounded-md bg-muted/50" />
              </div>
              <div className="space-y-1">
                <div className="h-9 rounded-md bg-muted/40" />
                <div className="h-9 rounded-md bg-muted/40" />
                <div className="h-9 rounded-md bg-muted/40" />
              </div>
              <div className="mt-4 space-y-1">
                <div className="mx-3 mb-2 h-3 w-16 rounded bg-muted/30" />
                <div className="h-9 rounded-md bg-muted/30" />
                <div className="h-9 rounded-md bg-muted/30" />
              </div>
              <div className="flex-1" />
            </div>
          ) : (
            <>
              <div className="space-y-1.5 px-3 pb-3">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start gap-2 rounded-md border-dashed"
                  onClick={() => setImportMode('git')}
                >
                  <GitBranch className="size-3.5" aria-hidden="true" />
                  {t('repos.importRepo')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start gap-2 rounded-md border-dashed"
                  onClick={handleImportLocal}
                >
                  <FolderOpen className="size-3.5" aria-hidden="true" />
                  {t('repos.importLocal')}
                </Button>
              </div>

              <InsetScrollArea scroll={false} className="flex-1">
                <nav
                  aria-label="Main navigation"
                  className="sidebar-scrollbar flex h-full min-h-0 flex-col gap-0.5 overflow-y-auto px-3 pb-2"
                >
                  <h2 className="mb-1 px-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50">
                    {t('sidebar.workspace')}
                  </h2>
                  <NavLink to="/" end className={navLinkClass}>
                    <LayoutDashboard className="size-4" aria-hidden="true" />
                    {t('sidebar.dashboard')}
                  </NavLink>

                  <NavLink
                    to="/skills"
                    end
                    className={({ isActive }) => {
                      const reallyActive = isActive && !activeAgentSlug
                      return navLinkClass({ isActive: reallyActive })
                    }}
                  >
                    <Puzzle className="size-4" aria-hidden="true" />
                    {t('sidebar.skills')}
                    {skills && (
                      <span className="ml-auto text-[10px] tabular-nums text-muted-foreground/60">
                        {skills.length}
                      </span>
                    )}
                  </NavLink>

                  <NavLink to="/marketplace" className={navLinkClass}>
                    <Store className="size-4" aria-hidden="true" />
                    {t('sidebar.marketplace')}
                  </NavLink>

                  <NavLink to="/projects" className={navLinkClass}>
                    <FolderKanban className="size-4" aria-hidden="true" />
                    {t('sidebar.projects')}
                    {projects && projects.length > 0 && (
                      <span className="ml-auto text-[10px] tabular-nums text-muted-foreground/60">
                        {projects.length}
                      </span>
                    )}
                  </NavLink>

                  {detectedAgents.length > 0 && (
                    <div className="mt-4">
                      <h2 className="mb-2 px-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50">
                        {t('sidebar.agents')}
                      </h2>
                      <div className="flex flex-col gap-0.5">
                        {detectedAgents.map((agent) => {
                          const count = skillCountByAgent.get(agent.slug) ?? 0
                          const breakdown = skillBreakdownByAgent.get(
                            agent.slug,
                          ) ?? { direct: 0, inherited: 0 }
                          const isActive = activeAgentSlug === agent.slug
                          const tooltip =
                            breakdown.inherited > 0
                              ? t('sidebar.agentSkillsTooltip', {
                                  direct: breakdown.direct,
                                  inherited: breakdown.inherited,
                                  name: agent.name,
                                })
                              : t('sidebar.agentSkillsTooltipDirectOnly', {
                                  count: breakdown.direct,
                                  name: agent.name,
                                })
                          return (
                            <AgentSidebarRow
                              key={agent.slug}
                              agent={agent}
                              allAgents={detectedAgents}
                              directCount={breakdown.direct}
                              totalCount={count}
                              isActive={isActive}
                              tooltip={tooltip}
                              navLinkClass={navLinkClass}
                            />
                          )
                        })}
                      </div>
                    </div>
                  )}

                  <div className="flex-1 min-h-2" />

                  <div className="pt-2">
                    <NavLink to="/settings" className={navLinkClass}>
                      <Settings className="size-4" aria-hidden="true" />
                      {t('sidebar.settings')}
                    </NavLink>
                  </div>
                </nav>
              </InsetScrollArea>
            </>
          )}
        </aside>

        <ResizeHandle onMouseDown={sidebar.onMouseDown} />

        {/* Main column: inset rounded panel — separate from sidebar; footer stays on canvas */}
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <main className="main-workspace-panel relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[12px] border border-border bg-card shadow-(--ds-shadow-layered-subtle) select-none">
            <InsetScrollArea className="min-h-0 flex-1 pr-0">
              {loading ? (
                <div className="space-y-4 px-6 py-6 animate-pulse">
                  <div className="grid grid-cols-3 gap-4">
                    <div className="h-24 rounded-lg bg-muted/30" />
                    <div className="h-24 rounded-lg bg-muted/30" />
                    <div className="h-24 rounded-lg bg-muted/30" />
                  </div>
                  <div className="h-5 w-32 rounded bg-muted/40" />
                  <div className="space-y-2">
                    <div className="h-14 rounded-lg bg-muted/25" />
                    <div className="h-14 rounded-lg bg-muted/25" />
                    <div className="h-14 rounded-lg bg-muted/25" />
                    <div className="h-14 rounded-lg bg-muted/25" />
                  </div>
                </div>
              ) : (
                <Outlet />
              )}
            </InsetScrollArea>
          </main>

          <footer className="flex h-7 shrink-0 items-center justify-end gap-3 pl-2 pr-2 text-[11px] text-muted-foreground/50">
            {showGithubStarPrompt && (
              <div className="mr-auto flex items-center gap-2 rounded-md border border-border/80 bg-card/85 px-2 py-1 text-[11px] text-foreground">
                <span>{t('layout.starPromptText')}</span>
                <button
                  type="button"
                  className="font-medium text-primary transition-colors hover:text-primary/80"
                  onClick={onGithubStarPromptCta}
                >
                  {t('layout.starPromptAction')}
                </button>
                <button
                  type="button"
                  className="text-muted-foreground transition-colors hover:text-foreground"
                  onClick={onDismissGithubStarPrompt}
                  aria-label={t('layout.starPromptDismiss')}
                >
                  {t('layout.starPromptDismiss')}
                </button>
              </div>
            )}
            <button
              type="button"
              className="transition-colors hover:text-muted-foreground/85"
              onClick={() => openUrl(GITHUB_REPO_URL)}
            >
              {t('layout.footerRepo')}
            </button>
          </footer>
        </div>
      </div>

      {importMode && (
        <ImportWizard
          mode={importMode}
          initialLocalPath={importLocalPath}
          onClose={() => {
            setImportMode(null)
            setImportLocalPath(null)
          }}
        />
      )}
    </div>
  )
}

/**
 * Sidebar agent entry with a right-click context menu for bulk operations.
 *
 * Left-click navigates to the filtered skills view (same as before).
 * Right-click opens a menu with:
 *   - "Copy all skills here from… → {any | each detected agent}"
 *   - "Remove all skills (N)" — only enabled when the agent has direct installs.
 *
 * Rationale: the previous toolbar above the skill list was always visible and
 * added noise. Moving it to a right-click menu keeps the sidebar quiet but
 * still discoverable (native affordance — most desktop apps work this way).
 */
function AgentSidebarRow({
  agent,
  allAgents: detectedAgents,
  directCount,
  totalCount,
  isActive,
  tooltip,
  navLinkClass,
}: {
  agent: import('@/mainview/hooks/useAgents').AgentConfig
  allAgents: import('@/mainview/hooks/useAgents').AgentConfig[]
  directCount: number
  totalCount: number
  isActive: boolean
  tooltip: string
  navLinkClass: (p: { isActive: boolean }) => string
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [copySubmenu, setCopySubmenu] = useState<
    null | { openLeft: boolean; openUp: boolean }
  >(null)
  const [busy, setBusy] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const submenuRef = useRef<HTMLDivElement>(null)

  // After the main menu renders, nudge its position so it fits inside the
  // viewport. Electron window clips anything outside its bounds, and without
  // this the right-click menu could land half-offscreen near the bottom of
  // the sidebar when lots of agents are listed.
  useEffect(() => {
    if (!menu || !menuRef.current) return
    const el = menuRef.current
    const rect = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const margin = 8
    let x = menu.x
    let y = menu.y
    if (rect.right > vw - margin) x = Math.max(margin, vw - rect.width - margin)
    if (rect.bottom > vh - margin) y = Math.max(margin, vh - rect.height - margin)
    if (x !== menu.x || y !== menu.y) {
      el.style.left = `${x}px`
      el.style.top = `${y}px`
    }
  }, [menu])

  // Same trick for the submenu: decide whether to open it to the left/up
  // based on where the main menu item sits. Submenus naturally fly to the
  // right & down; if they'd overflow we flip.
  function openCopySubmenu(anchor: HTMLElement) {
    const rect = anchor.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    // Guess submenu size — 220 wide, max 60vh tall. If the right edge + 220
    // would overflow, open to the left. If bottom would overflow, align
    // bottom-up.
    const wouldOverflowRight = rect.right + 220 > vw - 8
    const submenuMaxHeight = Math.floor(vh * 0.6)
    const wouldOverflowBottom = rect.top + submenuMaxHeight > vh - 8
    setCopySubmenu({
      openLeft: wouldOverflowRight,
      openUp: wouldOverflowBottom,
    })
  }

  // Close on outside click / Escape.
  useEffect(() => {
    if (!menu) return
    function onDown(e: MouseEvent) {
      if (menuRef.current?.contains(e.target as Node)) return
      setMenu(null)
      setCopySubmenu(null)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setMenu(null)
        setCopySubmenu(null)
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menu])

  function openContextMenu(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY })
    setCopySubmenu(null)
  }

  async function handleCopyFrom(sourceSlug: string | null) {
    setMenu(null)
    setCopySubmenu(null)
    const sourceLabel =
      sourceSlug === null
        ? t('sidebar.agentContextCopyFromAny')
        : detectedAgents.find((a) => a.slug === sourceSlug)?.name ?? sourceSlug
    if (
      !window.confirm(
        t('skills.bulkCopyConfirm', {
          target: agent.name,
          source: sourceLabel,
        }),
      )
    )
      return
    setBusy(true)
    try {
      const result = (await invoke('sync_all_skills_to_agent', {
        targetAgent: agent.slug,
        sourceAgent: sourceSlug,
      })) as {
        copied: string[]
        skipped: string[]
        failed: { id: string; error: string }[]
      }
      if (result.copied.length === 0 && result.skipped.length === 0) {
        alert(t('skills.bulkCopyNoCandidates', { source: sourceLabel }))
      } else if (result.copied.length === 0 && result.failed.length === 0) {
        alert(
          t('skills.bulkCopyAllPresent', {
            count: result.skipped.length,
            target: agent.name,
          }),
        )
      } else {
        alert(
          t('skills.bulkCopyDone', {
            copied: result.copied.length,
            skipped: result.skipped.length,
            failed: result.failed.length,
          }),
        )
      }
      queryClient.invalidateQueries({ queryKey: ['skills'] })
    } catch (err) {
      alert(`Failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  async function handleRemoveAll() {
    setMenu(null)
    if (directCount === 0) return
    if (
      !window.confirm(
        t('skills.bulkClearConfirm', {
          count: directCount,
          agent: agent.name,
        }),
      )
    )
      return
    setBusy(true)
    try {
      const result = (await invoke('uninstall_all_skills_from_agent', {
        agentSlug: agent.slug,
      })) as { removed: string[]; failed: { id: string; error: string }[] }
      alert(
        t('skills.bulkClearDone', {
          removed: result.removed.length,
          failed: result.failed.length,
        }),
      )
      queryClient.invalidateQueries({ queryKey: ['skills'] })
    } catch (err) {
      alert(`Failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  // Pre-filter source agents to those with at least one direct install;
  // picking "Figma" as source when Figma has 0 skills is a no-op and
  // shouldn't be offered.
  const sourceAgents = detectedAgents.filter((a) => a.slug !== agent.slug)

  return (
    <>
      <NavLink
        to={`/skills?agent=${agent.slug}`}
        className={() => navLinkClass({ isActive })}
        title={tooltip}
        onContextMenu={openContextMenu}
      >
        <AgentIcon slug={agent.slug} />
        <span className="truncate">{agent.name}</span>
        <span className="ml-auto text-[10px] tabular-nums text-muted-foreground/60">
          {busy ? '…' : totalCount}
        </span>
      </NavLink>
      {menu &&
        createPortal(
          <div
            ref={menuRef}
            className="fixed z-[300] min-w-[220px] rounded-xl glass-elevated p-1 shadow-lg animate-fade-in-up text-sm"
            style={{ left: menu.x, top: menu.y }}
            role="menu"
          >
            <div
              className="relative flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-black/[0.05] dark:hover:bg-white/[0.06] cursor-pointer"
              onMouseEnter={(e) => openCopySubmenu(e.currentTarget)}
              onMouseLeave={() => setCopySubmenu(null)}
            >
              <Copy className="size-3.5 text-muted-foreground" />
              <span className="flex-1">
                {t('sidebar.agentContextCopyHere')}
              </span>
              <ChevronRight className="size-3 text-muted-foreground" />
              {copySubmenu && (
                <div
                  ref={submenuRef}
                  className={`absolute z-[301] min-w-[220px] max-h-[60vh] overflow-y-auto rounded-xl glass-elevated p-1 shadow-lg ${
                    copySubmenu.openLeft ? 'right-full mr-1' : 'left-full ml-1'
                  } ${copySubmenu.openUp ? 'bottom-0' : 'top-0'}`}
                  role="menu"
                >
                  <button
                    type="button"
                    className="w-full rounded-lg px-2.5 py-1.5 text-left hover:bg-black/[0.05] dark:hover:bg-white/[0.06]"
                    onClick={() => void handleCopyFrom(null)}
                  >
                    {t('sidebar.agentContextCopyFromAny')}
                  </button>
                  {sourceAgents.map((a) => (
                    <button
                      key={a.slug}
                      type="button"
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-black/[0.05] dark:hover:bg-white/[0.06]"
                      onClick={() => void handleCopyFrom(a.slug)}
                    >
                      <AgentIcon slug={a.slug} className="size-4 shrink-0" />
                      <span className="truncate">{a.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              disabled={directCount === 0}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-destructive hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
              onClick={() => void handleRemoveAll()}
            >
              <Trash2 className="size-3.5" />
              {t('sidebar.agentContextRemoveAll', { count: directCount })}
            </button>
          </div>,
          document.body,
        )}
    </>
  )
}
