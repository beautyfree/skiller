import { NavLink, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useMemo, useState, useCallback, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { pickFolder, invoke, openUrl } from '@/mainview/lib/native'
import {
  LayoutDashboard,
  Puzzle,
  Store,
  Settings,
  GitBranch,
  FolderOpen,
  Copy,
  Trash2,
  ChevronRight,
  MessageCircle,
  LibraryBig,
  X,
} from 'lucide-react'
import { AgentIcon } from '@/mainview/components/AgentIcon'
import { Button } from '@/mainview/components/ui/button'
import { Tooltip } from '@/mainview/components/ui/tooltip'
import { useToast } from '@/mainview/components/ToastProvider'
import ImportWizard from '@/mainview/components/ImportWizard'
import { InsetScrollArea } from '@/mainview/components/InsetScrollArea'
import { ScrollFade } from '@/mainview/components/ScrollFade'
import { WINDOW_EDGE_INSET_RIGHT } from '@/mainview/lib/shell-chrome'
import { useResizable } from '@/mainview/hooks/useResizable'
import ResizeHandle from '@/mainview/components/ResizeHandle'
import { useAgents } from '@/mainview/hooks/useAgents'
import { useSkills, allAgents } from '@/mainview/hooks/useSkills'
import type { DotagentsLibraryLocalChangesJson, GlobalSkillUpdateCheckJson, SyncProfileStatusJson } from '@/shared/rpc-schema'
import skillerMark from '@/mainview/assets/brand/skiller-mark.png'

const GITHUB_REPO_URL =
  'https://github.com/beautyfree/skiller'
const FEEDBACK_URL =
  'https://github.com/beautyfree/skiller/discussions/categories/ideas'

// Hoisted outside component — stable reference, no re-creation per render
const NAV_LINK_BASE =
  'flex items-center gap-2 min-h-[28px] rounded-md px-3 py-1.5 text-[13px] font-[510] leading-[18px] border border-transparent outline-none focus-visible:ring-2 focus-visible:ring-ring/50 transition-[color,background-color,border-color,box-shadow,opacity] duration-150'
/** Linear-like active row: muted pill, not indigo fill */
const NAV_LINK_ACTIVE = `${NAV_LINK_BASE} bg-black/[0.05] text-foreground dark:bg-white/[0.09] dark:text-foreground`
const NAV_LINK_INACTIVE = `${NAV_LINK_BASE} text-sidebar-foreground/80 hover:text-foreground hover:bg-black/[0.04] dark:hover:bg-white/[0.05]`

function navLinkClass({ isActive }: { isActive: boolean }) {
  return isActive ? NAV_LINK_ACTIVE : NAV_LINK_INACTIVE
}

function ImportChoiceDialog({
  open,
  onClose,
  onGit,
  onLocal,
}: {
  open: boolean
  onClose: () => void
  onGit: () => void
  onLocal: () => void
}) {
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose, open])

  if (!open) return null

  return <div className="modal-shell modal-overlay fixed inset-0 z-50 flex items-center justify-center p-4">
    <button type="button" className="absolute inset-0 cursor-default" aria-label="Close import options" onClick={onClose} />
    <section role="dialog" aria-modal="true" aria-labelledby="import-choice-title" className="modal-panel relative z-10 w-[min(38rem,calc(100vw-2rem))] overflow-hidden rounded-2xl outline-none animate-modal-in glass-elevated">
      <header className="flex items-start justify-between gap-4 border-b border-border/70 px-5 py-4">
        <div><h2 id="import-choice-title" className="text-lg font-semibold tracking-[-0.025em]">Import skills</h2><p className="mt-1 text-sm leading-5 text-muted-foreground">Choose where the skills live now.</p></div>
        <Button size="icon-sm" variant="ghost" aria-label="Close" onClick={onClose}><X className="size-4" /></Button>
      </header>
      <div className="grid gap-3 p-5 sm:grid-cols-2">
        <button type="button" onClick={onGit} className="group min-h-36 rounded-xl border border-border/70 p-4 text-left outline-none transition-colors hover:border-primary/45 hover:bg-muted/35 focus-visible:ring-2 focus-visible:ring-ring/50">
          <GitBranch className="size-5 text-primary" aria-hidden="true" />
          <p className="mt-5 text-sm font-semibold">From Git</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">Clone or connect a Git repository that contains skills.</p>
        </button>
        <button type="button" onClick={onLocal} className="group min-h-36 rounded-xl border border-border/70 p-4 text-left outline-none transition-colors hover:border-primary/45 hover:bg-muted/35 focus-visible:ring-2 focus-visible:ring-ring/50">
          <FolderOpen className="size-5 text-primary" aria-hidden="true" />
          <p className="mt-5 text-sm font-semibold">From this computer</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">Choose a folder that already contains skills.</p>
        </button>
      </div>
    </section>
  </div>
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
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { toast } = useToast()
  const [importMode, setImportMode] = useState<'git' | 'local' | null>(null)
  const [importChoiceOpen, setImportChoiceOpen] = useState(false)
  const [importLocalPath, setImportLocalPath] = useState<string | null>(null)
  const pickingFolder = useRef(false)
  const agentSidebarScrollRef = useRef<HTMLDivElement>(null)
  const location = useLocation()
  const { data: agents, isLoading: agentsLoading } = useAgents()
  // Do not start the heavyweight global All Skills scan while the user is in
  // Agent Library. Its own inventory is independent and should be the first
  // thing the main process is free to answer.
  const { data: skills } = useSkills({ enabled: location.pathname !== '/library' })
  // Source checks are intentionally independent from list rendering. The
  // cached toolkit shows immediately; dotagents refreshes approved sources in
  // the background at a bounded cadence and never opens auth UI.
  const { data: globalSkillUpdates } = useQuery<GlobalSkillUpdateCheckJson>({
    queryKey: ['global-skill-updates'],
    queryFn: () => invoke('check_global_skill_updates'),
    enabled: Boolean(skills),
    staleTime: 15 * 60_000,
    refetchInterval: 15 * 60_000,
    refetchOnWindowFocus: false,
  })
  const { data: syncProfiles } = useQuery<SyncProfileStatusJson[]>({
    queryKey: ['sync-profiles'],
    // Safe metadata check only: no local skills are touched, no merge/commit
    // is performed and Git is forbidden from showing an auth prompt.
    queryFn: () => invoke('refresh_sync_profiles'),
    refetchInterval: 5 * 60_000,
  })
  const activeLibraryProfileId = syncProfiles?.[0]?.profile_id
  const announcedReconnectProfiles = useRef(new Set<string>())
  // The sidebar is the primary way to discover work that needs attention.
  // Query the same lightweight local comparison Agent Library consumes, so a
  // review requirement is visible before the user happens to open that page.
  const { data: libraryLocalChanges } = useQuery<DotagentsLibraryLocalChangesJson>({
    queryKey: ['dotagents-library-local-changes', activeLibraryProfileId],
    queryFn: () => invoke('dotagents_library_local_changes', { profileId: activeLibraryProfileId! }),
    enabled: Boolean(activeLibraryProfileId),
    staleTime: 30_000,
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: false,
  })
  const warmAgentLibrary = useCallback(() => {
    const profileId = syncProfiles?.[0]?.profile_id
    if (!profileId) return
    // Starting this on pointer/focus intent keeps Agent Library responsive
    // without competing with the normal app startup scan. The page consumes
    // this exact React Query entry, so opening it does not launch a second
    // inventory comparison.
    void queryClient.prefetchQuery({
      queryKey: ['dotagents-library-local-changes', profileId],
      queryFn: () => invoke('dotagents_library_local_changes', { profileId }),
      staleTime: 30_000,
    })
  }, [queryClient, syncProfiles])
  const localLibraryChangesNeedReview = (libraryLocalChanges?.changes ?? []).some((change) => change.kind !== 'kept-local')
  const providerReconnectRequired = Boolean(syncProfiles?.some((profile) => profile.provider_connection_required))
  const syncNeedsReview = providerReconnectRequired || localLibraryChangesNeedReview || Boolean(syncProfiles?.some((profile) => profile.changed || profile.ahead > 0 || profile.behind > 0 || profile.check_error))
  const syncAttentionTooltip = providerReconnectRequired ? 'Reconnect your library to keep syncing' : 'Library changes need review'
  useEffect(() => {
    for (const profile of syncProfiles ?? []) {
      if (!profile.provider_connection_required || announcedReconnectProfiles.current.has(profile.profile_id)) continue
      announcedReconnectProfiles.current.add(profile.profile_id)
      const provider = profile.remote_url?.includes('gitlab.com') ? 'GitLab' : 'GitHub'
      toast({
        title: `Reconnect ${provider} to keep your library in sync`,
        description: 'Your library and installed skills are unchanged.',
      }, 'default', { label: 'Open library', onClick: () => navigate('/library'), closeOnClick: false }, { timeoutMs: 20_000 })
    }
  }, [navigate, syncProfiles, toast])
  const skillUpdatesNeedReview = Boolean(
    globalSkillUpdates?.items.some((item) =>
      item.state === 'update-available' || item.state === 'review-required' || item.state === 'local-changes',
    ),
  )
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
    const breakdown = new Map<string, { direct: number; dotagents: number; otherShared: number }>()
    for (const skill of skills ?? []) {
      for (const inst of skill.installations) {
        const prev = breakdown.get(inst.agent_slug) ?? {
          direct: 0,
          dotagents: 0,
          otherShared: 0,
        }
        if (!inst.is_inherited) prev.direct += 1
        else if (inst.inherited_from === 'shared') prev.dotagents += 1
        else prev.otherShared += 1
        breakdown.set(inst.agent_slug, prev)
      }
    }
    return breakdown
  }, [skills])

  const sidebar = useResizable({
    // Match the shared Linear-derived shell in PostPost: the visual default
    // is 230px while 220px remains the lower desktop resize boundary.
    initial: 230,
    min: 220,
    max: 330,
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
  // A full skill scan can take several seconds on a mature setup. It must not
  // turn every route into a global skeleton: Agent Library has its own
  // purpose-built snapshot and can be useful before the All Skills index is
  // ready. Agent discovery remains the only navigation prerequisite.
  const loading = agentsLoading

  return (
    <div className="layout-root box-border flex h-screen flex-col overflow-hidden">
      {/* Global drag band as a real layout row (not overlay). */}
      <div
        className={`relative pointer-events-auto shrink-0 cursor-default select-none ${DRAG_CLASSES}`}
        style={{ height: TITLE_BAR_DRAG_HEIGHT }}
        onMouseDown={(e) => {
          if (e.detail === 2) onTitleBarZoomGesture(e)
        }}
        onDoubleClick={onTitleBarZoomGesture}
        aria-hidden="true"
      >
        {/* Decorative only: stays within the native drag surface on every OS. */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="flex items-center gap-1.5" aria-label="Skiller">
            <span className="grid size-[19px] place-items-center">
              <img
                src={skillerMark}
                alt=""
                draggable={false}
                className="size-[16px] object-contain invert dark:invert-0"
              />
            </span>
            <span className="relative top-px inline-block text-[14px] font-bold leading-none tracking-[-0.055em] text-foreground/90 [font-family:'Bricolage_Grotesque',sans-serif]">Skiller</span>
          </div>
        </div>
      </div>

      <div className={`flex min-h-0 min-w-0 flex-1 overflow-hidden ${WINDOW_EDGE_INSET_RIGHT}`}>
        {/* Sidebar — same plane as canvas */}
          <aside
            aria-label="Sidebar"
            className="layout-sidebar relative flex h-full shrink-0 flex-col"
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
                  onClick={() => setImportChoiceOpen(true)}
                >
                  <GitBranch className="size-3.5" aria-hidden="true" />
                  Import skills
                </Button>
              </div>

              <nav
                aria-label="Main navigation"
                className="flex min-h-0 flex-1 flex-col gap-0.5 px-3 pb-2"
              >
                <div className="shrink-0">
                  <h2 className="mb-1 px-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50">
                    {t('sidebar.workspace')}
                  </h2>
                  <div className="flex flex-col gap-0.5">
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
                      <span className="ml-auto flex shrink-0 items-center gap-2">
                        {skills && <span className="text-[10px] tabular-nums text-muted-foreground/60">{skills.length}</span>}
                        {skillUpdatesNeedReview && <Tooltip content="Skill updates need review" side="right"><span className="size-1.5 rounded-full bg-primary" /></Tooltip>}
                      </span>
                    </NavLink>

                    <NavLink to="/marketplace" className={navLinkClass}>
                      <Store className="size-4" aria-hidden="true" />
                      {t('sidebar.marketplace')}
                    </NavLink>

                    <NavLink
                      to="/library"
                      className={navLinkClass}
                      onPointerEnter={warmAgentLibrary}
                      onFocus={warmAgentLibrary}
                      onClick={() => window.dispatchEvent(new Event('skiller:open-agent-library'))}
                    >
                      <LibraryBig className="size-4" aria-hidden="true" />
                      Agent Library
                      {syncNeedsReview && <span className="ml-auto flex shrink-0 items-center"><Tooltip content={syncAttentionTooltip} side="right"><span className="size-1.5 rounded-full bg-primary" /></Tooltip></span>}
                    </NavLink>

                  </div>
                </div>

                {detectedAgents.length > 0 && (
                  <div className="mt-4 flex min-h-0 flex-1 flex-col">
                    <h2 className="mb-2 shrink-0 px-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/50">
                      {t('sidebar.agents')}
                    </h2>
                    <div className="relative min-h-0 flex-1">
                      <div ref={agentSidebarScrollRef} className="sidebar-scrollbar h-full min-h-0 overflow-y-auto pr-1">
                        <div className="flex flex-col gap-0.5">
                        {detectedAgents.map((agent) => {
                          const count = skillCountByAgent.get(agent.slug) ?? 0
                          const breakdown = skillBreakdownByAgent.get(
                            agent.slug,
                          ) ?? { direct: 0, dotagents: 0, otherShared: 0 }
                          const isActive =
                            location.pathname === '/skills' &&
                            activeAgentSlug === agent.slug
                          const tooltip = breakdown.otherShared > 0
                            ? t('sidebar.agentSkillsTooltipWithOtherShared', {
                                direct: breakdown.direct,
                                dotagents: breakdown.dotagents,
                                other: breakdown.otherShared,
                              })
                            : t('sidebar.agentSkillsTooltip', {
                                direct: breakdown.direct,
                                dotagents: breakdown.dotagents,
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
                      <ScrollFade viewportRef={agentSidebarScrollRef} surface="sidebar" />
                    </div>
                  </div>
                )}

                {detectedAgents.length === 0 && <div className="flex-1 min-h-2" />}

                <div className="shrink-0 flex flex-col gap-0.5 border-t border-border/50 pt-2">
                  <NavLink to="/settings" className={navLinkClass}>
                    <Settings className="size-4" aria-hidden="true" />
                    {t('sidebar.settings')}
                  </NavLink>
                </div>
              </nav>
            </>
          )}
          <ResizeHandle
            className="linear-resize-handle--overlay"
            onPointerDown={sidebar.onPointerDown}
            onMouseDown={sidebar.onMouseDown}
            isResizing={sidebar.isResizing}
          />
        </aside>

        {/* Main column: inset rounded panel — separate from sidebar; footer stays on canvas */}
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <main className="main-workspace-panel relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[12px] border border-border bg-card shadow-(--ds-shadow-layered-subtle) select-none">
<InsetScrollArea className="min-h-0 flex-1 pr-0" scroll={location.pathname !== '/library'}>
              {loading ? (
                <div className="space-y-4 px-6 py-6 animate-pulse">
                  <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,20.25rem),1fr))] gap-4">
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
              className="inline-flex items-center gap-1 transition-colors hover:text-muted-foreground/85"
              onClick={() => openUrl(FEEDBACK_URL)}
            >
              <MessageCircle className="size-3" aria-hidden="true" />
              {t('layout.footerFeedback')}
            </button>
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
      <ImportChoiceDialog
        open={importChoiceOpen}
        onClose={() => setImportChoiceOpen(false)}
        onGit={() => {
          setImportChoiceOpen(false)
          setImportMode('git')
        }}
        onLocal={() => {
          setImportChoiceOpen(false)
          void handleImportLocal()
        }}
      />
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
      <Tooltip content={tooltip} side="right">
      <NavLink
        to={`/skills?agent=${agent.slug}`}
        className={() => `${navLinkClass({ isActive })} w-full`}
        onContextMenu={openContextMenu}
      >
        <AgentIcon slug={agent.slug} />
        <span className="truncate">{agent.name}</span>
        <span className="ml-auto text-[10px] tabular-nums text-muted-foreground/60">
          {busy ? '…' : totalCount}
        </span>
      </NavLink>
      </Tooltip>
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
