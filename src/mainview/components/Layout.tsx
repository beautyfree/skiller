import { NavLink, Outlet, useSearchParams } from 'react-router-dom'
import { useMemo, useState, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { pickFolder, invoke, openUrl } from '@/mainview/lib/native'
import {
  LayoutDashboard,
  Puzzle,
  Store,
  Settings,
  GitBranch,
  FolderOpen,
  FolderKanban,
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

export default function Layout() {
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
                  className="flex h-full min-h-0 flex-col gap-0.5 overflow-y-auto px-3 pb-2"
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
                          const isActive = activeAgentSlug === agent.slug
                          return (
                            <NavLink
                              key={agent.slug}
                              to={`/skills?agent=${agent.slug}`}
                              className={() => navLinkClass({ isActive })}
                            >
                              <AgentIcon slug={agent.slug} />
                              <span className="truncate">{agent.name}</span>
                              <span className="ml-auto text-[10px] tabular-nums text-muted-foreground/60">
                                {count}
                              </span>
                            </NavLink>
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
