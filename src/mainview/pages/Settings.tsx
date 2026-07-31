import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Trash2,
  Check,
  GitBranch,
  RefreshCw,
  Info,
  ExternalLink,
  Download,
  RotateCw,
  AlertTriangle,
} from 'lucide-react'
import { openUrl, invoke, listen } from '@/mainview/lib/native'
import { setTelemetryEnabled } from '@/mainview/lib/telemetry'
import type {
  AppUpdateStatusJson,
  SkillJson,
  SyncPublishPreviewJson,
  SyncRestorePreviewJson,
} from '@/shared/rpc-schema'
import { useAccentColor } from '@/mainview/hooks/useAccentColor'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/mainview/components/ui/button'
import { useToast } from '@/mainview/components/ToastProvider'
import { useRepos, useRemoveRepo, useSyncRepo } from '@/mainview/hooks/useRepos'

interface AppSettings {
  theme: string | null
  language: string | null
  path_overrides: Record<string, string[]> | null
  close_action: string | null
  analytics_enabled?: boolean | null
  macos_window_blur?: boolean | null
  assumed_listing_char_budget?: number | null
  assumed_context_window_chars?: number | null
}

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  language: null,
  path_overrides: null,
  close_action: null,
  analytics_enabled: null,
  macos_window_blur: null,
}

const LANGUAGES = [
  { code: 'en', label: 'English' },
]

function isMacDesktopUa(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  return /Mac/.test(ua) && !/(iPhone|iPad|iPod)/.test(ua)
}

export default function SettingsPage() {
  const { t, i18n } = useTranslation()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const isMacDesktop = isMacDesktopUa()
  const [cacheCleared, setCacheCleared] = useState(false)
  const { accent, setAccent, presets } = useAccentColor()
  const { data: repos } = useRepos()
  const removeRepo = useRemoveRepo()
  const [appVersion, setAppVersion] = useState('')
  const [updateStatus, setUpdateStatus] = useState<AppUpdateStatusJson | null>(
    null,
  )
  const [updateBusy, setUpdateBusy] = useState<
    'idle' | 'checking' | 'downloading' | 'applying'
  >('idle')
  const [searchParams] = useSearchParams()
  const [syncProfileId, setSyncProfileId] = useState('personal')
  const [syncRemoteUrl, setSyncRemoteUrl] = useState('')
  const [syncMode, setSyncMode] = useState<'private' | 'team' | 'public'>('private')
  const [syncSkillIds, setSyncSkillIds] = useState<string[]>([])
  const [syncSkillKinds, setSyncSkillKinds] = useState<Record<string, 'bundled' | 'reference'>>({})
  const [syncAgentSlugs, setSyncAgentSlugs] = useState<string[] | null>(null)
  const [syncSelectionInitialized, setSyncSelectionInitialized] = useState(false)
  const [publishPreview, setPublishPreview] = useState<SyncPublishPreviewJson | null>(null)
  const [restorePreview, setRestorePreview] = useState<SyncRestorePreviewJson | null>(null)
  const [restoreSkillIds, setRestoreSkillIds] = useState<string[]>([])

  // Scroll to the section named by `?section=<id>` after mount. Used when the
  // footer sync indicator or SyncBanner deep-links here.
  useEffect(() => {
    const section = searchParams.get('section')
    if (!section) return
    // Wait a tick so the section has rendered (data fetches inside may still be
    // pending but the target <section id> is always in the initial DOM tree).
    const t = setTimeout(() => {
      const el = document.getElementById(section)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 50)
    return () => clearTimeout(t)
  }, [searchParams])

  useEffect(() => {
    invoke('get_app_version')
      .then(setAppVersion)
      .catch(() => {})
  }, [])

  useEffect(() => {
    let cancelled = false
    invoke('app_update_status')
      .then((s) => {
        if (!cancelled) setUpdateStatus(s)
      })
      .catch(() => {})
    let unlisten: (() => void) | undefined
    void listen<AppUpdateStatusJson>(
      'app_update_status_changed',
      ({ payload }) => {
        setUpdateStatus(payload)
      },
    ).then((fn) => {
      if (cancelled) fn()
      else unlisten = fn
    })
    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [])

  async function handleUpdateCheck() {
    setUpdateBusy('checking')
    try {
      await invoke('app_update_check')
    } catch (e) {
      toast(
        t('settings.updateStateError') +
          ': ' +
          (e instanceof Error ? e.message : String(e)),
        'destructive',
      )
    } finally {
      setUpdateBusy('idle')
    }
  }

  async function handleUpdateDownload() {
    setUpdateBusy('downloading')
    try {
      const snapshot = await invoke('app_update_download')
      // Adopt the returned snapshot immediately so the button flips to
      // "Restart & install" without waiting for the push event to race
      // through — previously the busy reset happened before the event
      // arrived and the UI briefly showed "Download update" again.
      if (snapshot) setUpdateStatus(snapshot)
      if (snapshot?.state === 'error' && snapshot.error) {
        toast(snapshot.error, 'destructive')
      }
    } catch (e) {
      toast(
        t('settings.updateStateError') +
          ': ' +
          (e instanceof Error ? e.message : String(e)),
        'destructive',
      )
    } finally {
      setUpdateBusy('idle')
    }
  }

  function handleManualUpdateDownload() {
    if (updateStatus?.manualDownloadUrl) {
      openUrl(updateStatus.manualDownloadUrl)
    }
  }

  async function handleUpdateApply() {
    setUpdateBusy('applying')
    try {
      await invoke('app_update_apply')
    } catch (e) {
      toast(
        t('settings.updateStateError') +
          ': ' +
          (e instanceof Error ? e.message : String(e)),
        'destructive',
      )
      setUpdateBusy('idle')
    }
    // No `finally` reset — applyUpdate kills and relaunches the process.
  }

  function formatLastChecked(ts: number | null | undefined): string | null {
    if (!ts) return null
    const date = new Date(ts)
    return date.toLocaleString(i18n.language || 'en', {
      hour: 'numeric',
      minute: '2-digit',
      day: 'numeric',
      month: 'short',
    })
  }
  const syncRepo = useSyncRepo()

  const { data: settings, isLoading } = useQuery<AppSettings>({
    queryKey: ['settings'],
    queryFn: async () => (await invoke('read_settings')) as AppSettings,
  })

  const { data: shellRuntime } = useQuery({
    queryKey: ['shell-runtime'],
    queryFn: () => invoke('shell_runtime'),
    enabled: isMacDesktop,
  })

  const { data: syncProfiles } = useQuery({
    queryKey: ['sync-profiles'],
    queryFn: () => invoke('list_sync_profiles'),
  })
  const { data: syncSkills } = useQuery<SkillJson[]>({
    queryKey: ['sync-skills'],
    queryFn: () => invoke('scan_all_skills'),
  })
  const { data: syncAgents } = useQuery({
    queryKey: ['sync-agents'],
    queryFn: () => invoke('list_agents'),
  })

  useEffect(() => {
    if (!syncSkills || syncSelectionInitialized) return
    setSyncSkillIds(syncSkills.map((skill) => skill.id))
    setSyncSelectionInitialized(true)
  }, [syncSkills, syncSelectionInitialized])

  const syncPublishMutation = useMutation({
    mutationFn: () => invoke('sync_profile_publish', {
      profileId: syncProfileId,
      mode: syncMode,
      skillIds: syncSkillIds,
      skillKinds: syncSkillKinds,
      agentSlugs: syncAgentSlugs ?? undefined,
      remoteUrl: syncRemoteUrl || null,
      push: true,
    }),
    onSuccess: async (result) => {
      setPublishPreview(null)
      await queryClient.invalidateQueries({ queryKey: ['sync-profiles'] })
      toast(result.pushed ? 'Sync profile committed and pushed.' : 'Sync profile committed locally.')
    },
    onError: (err) => toast(err instanceof Error ? err.message : String(err), 'destructive'),
  })
  const syncCloneMutation = useMutation({
    mutationFn: () => invoke('sync_profile_clone', { profileId: syncProfileId, remoteUrl: syncRemoteUrl }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['sync-profiles'] })
      toast('Sync profile connected. Pull to review its skills.')
    },
    onError: (err) => toast(err instanceof Error ? err.message : String(err), 'destructive'),
  })
  const syncGitHubMutation = useMutation({
    mutationFn: () => invoke('sync_github_create_repo', {
      repository: syncProfileId,
      visibility: syncMode === 'public' ? 'public' : 'private',
    }),
    onSuccess: (result) => {
      setSyncRemoteUrl(result.remoteUrl)
      toast('GitHub repository created. Review and push when ready.')
    },
    onError: (err) => toast(err instanceof Error ? err.message : String(err), 'destructive'),
  })
  const syncRestoreMutation = useMutation({
    mutationFn: () => invoke('sync_restore_apply', {
      profileId: syncProfileId,
      skillIds: restoreSkillIds,
    }),
    onSuccess: async (result) => {
      setRestorePreview(null)
      await queryClient.invalidateQueries({ queryKey: ['sync-skills'] })
      await queryClient.invalidateQueries({ queryKey: ['sync-profiles'] })
      toast(`Restored ${result.restored.length} skill(s) to ${result.installed_to_detected_agents.length} detected agent(s).`)
    },
    onError: (err) => toast(err instanceof Error ? err.message : String(err), 'destructive'),
  })

  async function reviewSyncPublish() {
    try {
      const preview = await invoke('sync_publish_preview', {
        profileId: syncProfileId,
        mode: syncMode,
        skillIds: syncSkillIds,
        skillKinds: syncSkillKinds,
        agentSlugs: syncAgentSlugs ?? undefined,
      })
      setPublishPreview(preview)
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'destructive')
    }
  }

  async function reviewSyncRestore() {
    try {
      const preview = await invoke('sync_pull_preview', { profileId: syncProfileId })
      setRestorePreview(preview)
      setRestoreSkillIds(preview.skills.filter((skill) => skill.action !== 'unchanged').map((skill) => skill.id))
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'destructive')
    }
  }

  const saveMutation = useMutation({
    mutationFn: async (s: AppSettings) => {
      await invoke('write_settings', { settings: s })
    },
    onSuccess: async () => {
      void queryClient.invalidateQueries({ queryKey: ['settings'] })
      void queryClient.invalidateQueries({ queryKey: ['shell-runtime'] })
      if (isMacDesktopUa()) {
        try {
          const f = await invoke('shell_runtime')
          document.documentElement.classList.toggle(
            'skiller-macos-vibrancy',
            f.macosWindowBlur
          )
        } catch {
          /* ignore */
        }
      }
    },
    onError: (err) => {
      const detail =
        err instanceof Error ? err.message : t('settings.saveFailedDesc')
      toast(`${t('settings.saveFailedTitle')}: ${detail}`, 'destructive')
      if (isMacDesktopUa()) {
        void invoke('shell_runtime')
          .then((f) => {
            document.documentElement.classList.toggle(
              'skiller-macos-vibrancy',
              f.macosWindowBlur
            )
          })
          .catch(() => {})
      }
    },
  })

  async function handleClearCache() {
    try {
      await invoke('clear_marketplace_cache')
      await queryClient.invalidateQueries({ queryKey: ['marketplace'] })
      setCacheCleared(true)
      setTimeout(() => setCacheCleared(false), 2000)
    } catch (e) {
      console.error(
        'Clear cache failed:',
        e instanceof Error ? e.message : String(e)
      )
    }
  }

  function handleLanguageChange(langCode: string) {
    void i18n.changeLanguage(langCode)
    saveMutation.mutate({
      ...(settings ?? DEFAULT_SETTINGS),
      language: langCode,
    })
  }

  if (isLoading) {
    return (
      <div className="settings-page flex min-h-full w-full justify-center px-6 py-8 pb-10 animate-fade-in-up">
        <div className="w-full max-w-[560px] space-y-6">
          <div className="h-5 w-28 rounded animate-skeleton" />
          <div className="space-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="rounded-2xl p-5 glass-panel settings-panel space-y-3"
              >
                <div className="h-4 w-24 rounded animate-skeleton" />
                <div className="h-3 w-48 rounded animate-skeleton" />
                <div className="h-8 w-32 rounded-lg animate-skeleton" />
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  const currentLang = i18n.language

  return (
    <div className="settings-page flex min-h-full w-full justify-center px-6 py-8 pb-10 animate-fade-in-up">
      <div className="w-full max-w-[560px] space-y-5">
        <header className="pb-1">
          <h1 className="text-[15px] font-semibold leading-5 tracking-[-0.015em] text-foreground">
            {t('sidebar.settings')}
          </h1>
        </header>

        {/* Theme */}
        <section className="rounded-2xl p-5 glass-panel settings-panel space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-sm font-medium">{t('settings.theme')}</h2>
            </div>
            <div className="flex shrink-0 gap-1.5">
              {(['light', 'dark', 'system'] as const).map((themeOption) => {
                // Must match useTheme: omitted / null theme in TOML means "system", not default dark.
                const persisted = settings?.theme
                const effectiveTheme: 'light' | 'dark' | 'system' =
                  persisted === 'light' || persisted === 'dark'
                    ? persisted
                    : 'system'
                const isActive = themeOption === effectiveTheme
                return (
                  <Button
                    key={themeOption}
                    variant={isActive ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => {
                      saveMutation.mutate({
                        ...(settings ?? DEFAULT_SETTINGS),
                        theme: themeOption === 'system' ? null : themeOption,
                      })
                    }}
                  >
                    {t(`settings.${themeOption}`)}
                  </Button>
                )
              })}
            </div>
          </div>
        </section>

        {/* Accent Color */}
        <section className="rounded-2xl p-5 glass-panel settings-panel space-y-3">
          <h2 className="text-sm font-medium">{t('settings.accentColor')}</h2>
          <div className="flex gap-2 flex-wrap">
            {presets.map((p) => {
              const isActive = accent === p.key
              const labelKey = `settings.accent${
                p.key.charAt(0).toUpperCase() + p.key.slice(1)
              }` as const
              return (
                <button
                  key={p.key}
                  onClick={() => {
                    setAccent(p.key)
                  }}
                  className={`group flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium transition-all duration-200 cursor-pointer border ${
                    isActive
                      ? 'glass border-current/20 shadow-sm'
                      : 'border-transparent hover:bg-black/[0.03] dark:hover:bg-white/[0.04]'
                  }`}
                >
                  <span
                    className="size-4 rounded-full shrink-0 ring-1 ring-black/10 dark:ring-white/15"
                    style={{ background: p.swatch }}
                  />
                  <span
                    className={
                      isActive ? 'text-primary' : 'text-muted-foreground'
                    }
                  >
                    {t(labelKey)}
                  </span>
                  {isActive && <Check className="size-3 text-primary" />}
                </button>
              )
            })}
          </div>
        </section>

        {/* macOS window blur */}
        {isMacDesktop && (
          <section className="rounded-2xl p-5 glass-panel settings-panel space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="text-sm font-medium">
                  {t('settings.windowBlur')}
                </h2>
                <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                  {t('settings.windowBlurDescription')}
                </p>
                {shellRuntime?.macosWindowBlurLockedByEnv ? (
                  <p className="mt-2 text-xs text-amber-600 dark:text-amber-500/90 leading-relaxed">
                    {t('settings.windowBlurLockedByEnv')}
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 gap-1.5">
                {([false, true] as const).map((on) => {
                  const storedOn = settings?.macos_window_blur !== false
                  const isActive = on ? storedOn : !storedOn
                  return (
                    <Button
                      key={on ? 'on' : 'off'}
                      variant={isActive ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => {
                        if (shellRuntime?.macosWindowBlurLockedByEnv) return
                        document.documentElement.classList.toggle(
                          'skiller-macos-vibrancy',
                          on
                        )
                        saveMutation.mutate({
                          ...(settings ?? DEFAULT_SETTINGS),
                          macos_window_blur: on,
                        })
                      }}
                    >
                      {on
                        ? t('settings.windowBlurOn')
                        : t('settings.windowBlurOff')}
                    </Button>
                  )
                })}
              </div>
            </div>
          </section>
        )}

        {/* Language */}
        <section className="rounded-2xl p-5 glass-panel settings-panel space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-sm font-medium">{t('settings.language')}</h2>
            </div>
            <div className="flex shrink-0 gap-1.5">
              {LANGUAGES.map((lang) => (
                <Button
                  key={lang.code}
                  variant={currentLang === lang.code ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => handleLanguageChange(lang.code)}
                >
                  {lang.label}
                </Button>
              ))}
            </div>
          </div>
        </section>

        {/* Analytics */}
        <section className="rounded-2xl p-5 glass-panel settings-panel space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-sm font-medium">{t('settings.analytics')}</h2>
              <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                {t('settings.analyticsDescription')}
              </p>
            </div>
            <div className="flex shrink-0 gap-1.5">
              {([true, false] as const).map((enabled) => {
                const currentEnabled = settings?.analytics_enabled !== false
                const isActive = currentEnabled === enabled
                return (
                  <Button
                    key={enabled ? 'on' : 'off'}
                    variant={isActive ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => {
                      setTelemetryEnabled(enabled)
                      saveMutation.mutate({
                        ...(settings ?? DEFAULT_SETTINGS),
                        analytics_enabled: enabled,
                      })
                    }}
                  >
                    {enabled
                      ? t('settings.analyticsOn')
                      : t('settings.analyticsOff')}
                  </Button>
                )
              })}
            </div>
          </div>
        </section>

        {/* Close Behavior */}
        <section className="rounded-2xl p-5 glass-panel settings-panel space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-sm font-medium">
                {t('settings_close.closeBehavior')}
              </h2>
              <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                {t('settings_close.closeBehaviorDescription')}
              </p>
            </div>
            <div className="flex shrink-0 gap-1.5">
              {([null, 'minimize', 'quit'] as const).map((option) => {
                const current = settings?.close_action ?? null
                const isActive = current === option
                const labelKey =
                  option === null
                    ? 'settings_close.ask'
                    : `settings_close.${option}`
                return (
                  <Button
                    key={option ?? 'ask'}
                    variant={isActive ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => {
                      saveMutation.mutate({
                        ...(settings ?? DEFAULT_SETTINGS),
                        close_action: option,
                      })
                    }}
                  >
                    {t(labelKey)}
                  </Button>
                )
              })}
            </div>
          </div>
        </section>

        {/* App Updates */}
        <section className="rounded-2xl p-5 glass-panel settings-panel space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-sm font-medium">
                {t('settings.appUpdates')}
              </h2>
              <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                {(() => {
                  const s = updateStatus
                  const localV = s?.localVersion || appVersion
                  const remoteV = s?.remoteVersion
                  switch (s?.state) {
                    case 'checking':
                      return t('settings.updateStateChecking')
                    case 'available':
                      return (
                        t('settings.updateStateAvailable') +
                        (remoteV
                          ? ' — ' +
                            t('settings.updateVersionLine', {
                              current: localV,
                              latest: remoteV,
                            })
                          : '')
                      )
                    case 'downloading':
                      return (
                        t('settings.updateStateDownloading') +
                        (typeof s.progress === 'number'
                          ? ` (${s.progress}%)`
                          : '')
                      )
                    case 'ready':
                      return t('settings.updateStateReady')
                    case 'error':
                      return s.error || t('settings.updateStateError')
                    default: {
                      const lastChecked = formatLastChecked(s?.lastCheckedAt)
                      return (
                        t('settings.updateStateUpToDate') +
                        ' — ' +
                        t('settings.updateVersionOnly', { version: localV }) +
                        (lastChecked
                          ? ' · ' +
                            t('settings.updateLastChecked', { time: lastChecked })
                          : '')
                      )
                    }
                  }
                })()}
              </p>
            </div>
            <div className="flex gap-2 shrink-0">
              {updateStatus?.state === 'ready' ? (
                <Button
                  size="sm"
                  onClick={handleUpdateApply}
                  disabled={updateBusy === 'applying'}
                >
                  <RotateCw className="size-3.5" />
                  {t('settings.updateRestart')}
                </Button>
              ) : updateStatus?.state === 'available' ? (
                <Button
                  size="sm"
                  onClick={handleUpdateDownload}
                  disabled={updateBusy === 'downloading'}
                >
                  <Download className="size-3.5" />
                  {t('settings.updateDownload')}
                </Button>
              ) : updateStatus?.state === 'error' &&
                updateStatus.manualDownloadUrl ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleManualUpdateDownload}
                >
                  <ExternalLink className="size-3.5" />
                  {t('settings.updateManualDownload')}
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleUpdateCheck}
                  disabled={
                    updateBusy === 'checking' ||
                    updateStatus?.state === 'checking' ||
                    updateStatus?.state === 'downloading'
                  }
                >
                  <RefreshCw
                    className={`size-3.5 ${
                      updateStatus?.state === 'checking' ||
                      updateBusy === 'checking'
                        ? 'animate-spin'
                        : ''
                    }`}
                  />
                  {t('settings.updateCheckNow')}
                </Button>
              )}
            </div>
          </div>

          {/* Download progress bar — the percentage is already in the
           *  subtitle, but a visual bar gives actual feedback on long
           *  downloads (200+ MB DMG can take minutes on slow networks).
           *  Indeterminate stripe when progress is null (handshake phase). */}
          {updateStatus?.state === 'downloading' && (
            <div className="space-y-1">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full bg-primary transition-[width] duration-300 ${
                    typeof updateStatus.progress !== 'number'
                      ? 'skiller-update-progress-indeterminate'
                      : ''
                  }`}
                  style={
                    typeof updateStatus.progress === 'number'
                      ? { width: `${updateStatus.progress}%` }
                      : undefined
                  }
                />
              </div>
              {typeof updateStatus.progress === 'number' && (
                <p className="text-[10px] tabular-nums text-muted-foreground">
                  {updateStatus.progress}%
                </p>
              )}
              {typeof updateStatus.progress !== 'number' && (
                <p className="text-[10px] text-muted-foreground">
                  {t('settings.updatePreparingDownload')}
                </p>
              )}
            </div>
          )}
          {/* Persistent error surface — the inline muted paragraph above was
           *  too easy to miss. Errors from autoUpdater (signature, disk full,
           *  network) stay visible here with an explicit destructive style
           *  until the user runs a successful check/download that clears the
           *  state. */}
          {updateStatus?.error && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-destructive">
                  {t('settings.updateErrorTitle')}
                </p>
                <p className="mt-0.5 text-muted-foreground break-words font-mono">
                  {updateStatus.error}
                </p>
              </div>
            </div>
          )}
          <div className="pt-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => window.dispatchEvent(new Event('skiller:open-release-notes'))}
            >
              <Info className="size-3.5" />
              {t('settings.viewReleaseNotes')}
            </Button>
          </div>
        </section>


        {/* Agent sync */}
        <section id="agent-sync" className="hidden" aria-hidden="true">
          <div>
            <h2 className="text-sm font-medium flex items-center gap-1.5">
              <GitBranch className="size-4" />
              Agent sync
            </h2>
            <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
              Version selected skills in a private, team, or public Git repository. Credentials stay in your Git credential helper or SSH agent; Skiller never stores them.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="space-y-1 text-xs text-muted-foreground">
              Profile ID
              <input
                value={syncProfileId}
                onChange={(event) => {
                  setSyncProfileId(event.target.value.toLowerCase())
                  setPublishPreview(null)
                  setRestorePreview(null)
                }}
                spellCheck={false}
                className="h-8 w-full rounded-lg border border-border bg-background/60 px-2 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring/40"
                aria-label="Sync profile ID"
              />
            </label>
            <label className="space-y-1 text-xs text-muted-foreground">
              Git remote (optional until push)
              <input
                value={syncRemoteUrl}
                onChange={(event) => setSyncRemoteUrl(event.target.value)}
                placeholder="git@github.com:you/skiller-skills.git"
                spellCheck={false}
                className="h-8 w-full rounded-lg border border-border bg-background/60 px-2 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring/40"
                aria-label="Sync Git remote"
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Sync visibility">
            {(['private', 'team', 'public'] as const).map((mode) => (
              <Button
                key={mode}
                size="sm"
                variant={syncMode === mode ? 'default' : 'outline'}
                onClick={() => {
                  setSyncMode(mode)
                  setPublishPreview(null)
                }}
              >
                {mode}
              </Button>
            ))}
          </div>
          <div className="rounded-xl glass-inset p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium">Skills to include ({syncSkillIds.length})</p>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => setSyncSkillIds(syncSkills?.map((skill) => skill.id) ?? [])}
              >
                Select all
              </Button>
            </div>
            <div className="max-h-36 space-y-1 overflow-y-auto pr-1">
              {syncSkills?.map((skill) => {
                const checked = syncSkillIds.includes(skill.id)
                return (
                  <label key={skill.id} className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-xs hover:bg-black/[0.03] dark:hover:bg-white/[0.04]">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        setPublishPreview(null)
                        setSyncSkillIds((current) => checked
                          ? current.filter((id) => id !== skill.id)
                          : [...current, skill.id])
                      }}
                    />
                    <span className="truncate">{skill.name}</span>
                    <span className="ml-auto font-mono text-[10px] text-muted-foreground">{skill.id}</span>
                    {checked && (
                      <button
                        type="button"
                        className="rounded border border-border px-1 py-0.5 text-[9px] text-muted-foreground hover:text-foreground"
                        onClick={(event) => {
                          event.preventDefault()
                          setPublishPreview(null)
                          setSyncSkillKinds((current) => ({
                            ...current,
                            [skill.id]: current[skill.id] === 'reference' ? 'bundled' : 'reference',
                          }))
                        }}
                      >
                        {syncSkillKinds[skill.id] === 'reference' ? 'pinned ref' : 'bundle'}
                      </button>
                    )}
                  </label>
                )
              })}
              {syncSkills?.length === 0 && <p className="text-xs text-muted-foreground">No local skills to sync yet.</p>}
            </div>
          </div>
          <div className="rounded-xl glass-inset p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium">Install policy on restore</p>
              <Button size="xs" variant={syncAgentSlugs === null ? 'default' : 'ghost'} onClick={() => setSyncAgentSlugs(null)}>
                All detected
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">Only agent identifiers travel in the profile; no local agent configuration or credentials are exported.</p>
            <div className="flex flex-wrap gap-1.5">
              {syncAgents?.filter((agent) => agent.detected).map((agent) => {
                const checked = syncAgentSlugs?.includes(agent.slug) ?? false
                return <label key={agent.slug} className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px]">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => setSyncAgentSlugs((current) => {
                      const base = current ?? []
                      return base.includes(agent.slug) ? base.filter((slug) => slug !== agent.slug) : [...base, agent.slug]
                    })}
                  />
                  {agent.name}
                </label>
              })}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={reviewSyncPublish} disabled={syncPublishMutation.isPending}>
              Review publish
            </Button>
            <Button size="sm" variant="outline" onClick={() => syncGitHubMutation.mutate()} disabled={syncGitHubMutation.isPending}>
              Create GitHub repo
            </Button>
            <Button size="sm" variant="outline" onClick={() => syncCloneMutation.mutate()} disabled={syncCloneMutation.isPending || !syncRemoteUrl}>
              Connect existing remote
            </Button>
            <Button size="sm" variant="outline" onClick={reviewSyncRestore} disabled={syncRestoreMutation.isPending}>
              Pull & review
            </Button>
          </div>
          {publishPreview && (
            <div className="rounded-xl border border-border bg-background/40 p-3 space-y-2 text-xs">
              <p className="font-medium">Publish review: {publishPreview.skills.length} skill(s), {publishPreview.skills.reduce((total, skill) => total + skill.file_count, 0)} file(s).</p>
              {publishPreview.references.length > 0 && <p className="text-muted-foreground">{publishPreview.references.length} skill(s) will be restored from an immutable Git commit, not copied into this repository.</p>}
              {(syncMode === 'public' || publishPreview.skills.some((skill) => skill.excluded_paths.length > 0)) && (
                <div className="max-h-32 space-y-1 overflow-y-auto rounded-lg bg-muted/30 p-2 font-mono text-[10px] text-muted-foreground">
                  {publishPreview.skills.flatMap((skill) => skill.files.map((path) => <div key={`${skill.id}/${path}`}>include {skill.id}/{path}</div>))}
                  {publishPreview.skills.flatMap((skill) => skill.excluded_paths.map((path) => <div key={`${skill.id}/exclude/${path}`}>exclude {skill.id}/{path}</div>))}
                </div>
              )}
              {publishPreview.secret_findings.length > 0 ? (
                <p className="text-destructive">Blocked: {publishPreview.secret_findings.length} possible secret(s) found. Remove them before publishing.</p>
              ) : (
                <p className="text-muted-foreground">No secret patterns found. Confirming commits locally and pushes only through the configured Git remote.</p>
              )}
              <Button size="sm" onClick={() => syncPublishMutation.mutate()} disabled={syncPublishMutation.isPending || publishPreview.secret_findings.length > 0}>
                Commit & push reviewed skills
              </Button>
            </div>
          )}
          {restorePreview && (
            <div className="rounded-xl border border-border bg-background/40 p-3 space-y-2 text-xs">
              <p className="font-medium">Restore review: {restorePreview.skills.length} skill(s).</p>
              <div className="space-y-1 text-muted-foreground">
                {restorePreview.skills.map((skill) => {
                  const selectable = skill.action !== 'unchanged'
                  return <label key={skill.id} className="flex items-center gap-2 rounded-md px-1 py-0.5">
                    <input
                      type="checkbox"
                      disabled={!selectable}
                      checked={selectable ? restoreSkillIds.includes(skill.id) : true}
                      onChange={() => setRestoreSkillIds((current) => current.includes(skill.id) ? current.filter((id) => id !== skill.id) : [...current, skill.id])}
                    />
                    <span>{skill.id}</span><span className="ml-auto">{skill.kind} · {skill.action}</span>
                  </label>
                })}
              </div>
              {restorePreview.secret_findings.length > 0 ? (
                <p className="text-destructive">Blocked: {restorePreview.secret_findings.length} possible secret(s) found in the remote profile.</p>
              ) : (
                <Button size="sm" onClick={() => syncRestoreMutation.mutate()} disabled={syncRestoreMutation.isPending || restoreSkillIds.length === 0}>
                  Restore reviewed changes
                </Button>
              )}
            </div>
          )}
          {syncProfiles && syncProfiles.length > 0 && (
            <div className="space-y-1 text-xs text-muted-foreground">
              {syncProfiles.map((profile) => (
                <button
                  key={profile.profile_id}
                  className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
                  onClick={() => {
                    setSyncProfileId(profile.profile_id)
                    setSyncMode(profile.mode)
                    setSyncRemoteUrl(profile.remote_url ?? '')
                    setPublishPreview(null)
                    setRestorePreview(null)
                  }}
                >
                  <span className="font-medium text-foreground">{profile.profile_id}</span>
                  <span>{profile.mode} · {profile.skill_count} skills · {profile.changed ? 'local changes' : 'clean'}</span>
                </button>
              ))}
            </div>
          )}
        </section>


        {/* Onboarding replay */}
        <section className="rounded-2xl p-5 glass-panel settings-panel space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-sm font-medium">
                {t('settings.onboardingTitle')}
              </h2>
              <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                {t('settings.onboardingDescription')}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                try {
                  localStorage.removeItem('skiller.onboarding.done')
                } catch {
                  /* ignore */
                }
                window.dispatchEvent(
                  new CustomEvent('skiller:open-onboarding', {
                    detail: { force: true },
                  }),
                )
              }}
            >
              {t('settings.onboardingReplay')}
            </Button>
          </div>
        </section>

        {/* Cache */}
        <section className="rounded-2xl p-5 glass-panel settings-panel space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-sm font-medium">
                {t('settings.marketplaceCache')}
              </h2>
              <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                {t('settings.cacheDescription')}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleClearCache}
              disabled={cacheCleared}
            >
              {cacheCleared ? (
                <>
                  <Check className="size-3.5" />
                  {t('settings.cleared')}
                </>
              ) : (
                <>
                  <Trash2 className="size-3.5" />
                  {t('settings.clearCache')}
                </>
              )}
            </Button>
          </div>
        </section>

        {/* Skill Repos */}
        <section className="rounded-2xl p-5 glass-panel settings-panel space-y-3">
          <h2 className="text-sm font-medium flex items-center gap-1.5">
            <GitBranch className="size-4" />
            {t('repos.skillRepos')}
          </h2>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {t('repos.reposDescription')}
          </p>
          {repos && repos.length > 0 ? (
            <div className="space-y-1.5">
              {repos.map((repo) => {
                const isLocal = repo.id.startsWith('local-')
                return (
                  <div
                    key={repo.id}
                    className="rounded-xl glass-inset px-3 py-2.5 text-xs space-y-1.5"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium">{repo.name}</span>
                        <span className="rounded-full border border-border bg-muted/40 px-1.5 py-0.5 text-[10px] font-[510] text-muted-foreground">
                          {isLocal
                            ? t('repos.localSource')
                            : t('repos.gitSource')}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        {!isLocal && (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            title={t('repos.sync')}
                            disabled={syncRepo.isPending}
                            onClick={() => {
                              syncRepo.mutate(repo.id)
                            }}
                          >
                            <RefreshCw
                              className={`size-3 ${
                                syncRepo.isPending ? 'animate-spin' : ''
                              }`}
                            />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          title={t('repos.remove')}
                          disabled={removeRepo.isPending}
                          onClick={() => {
                            removeRepo.mutate(repo.id)
                          }}
                        >
                          <Trash2 className="size-3" />
                        </Button>
                      </div>
                    </div>
                    <p className="text-muted-foreground font-mono break-all">
                      {repo.repo_url}
                    </p>
                    <div className="flex items-center gap-3 text-muted-foreground">
                      <span>
                        {t('repos.skillCountLabel', {
                          count: repo.skill_count,
                        })}
                      </span>
                      {!isLocal && repo.last_synced && (
                        <span>
                          {t('repos.lastSynced', {
                            time: new Date(repo.last_synced).toLocaleString(),
                          })}
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-black/[0.06] dark:border-white/[0.06] p-4 text-center">
              <p className="text-xs text-muted-foreground">
                {t('repos.noRepos')}
              </p>
            </div>
          )}
        </section>

        {/* About */}
        <section className="rounded-2xl p-5 glass-panel settings-panel space-y-3">
          <h2 className="text-sm font-medium flex items-center gap-1.5">
            <Info className="size-4" />
            {t('settings.about')}
          </h2>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Skiller</span>
            {appVersion && (
              <span className="rounded-full glass-badge px-2 py-0.5 text-[10px] font-medium tabular-nums">
                v{appVersion}
              </span>
            )}
          </div>
          <button
            className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline cursor-pointer"
            onClick={() =>
              openUrl(
                'https://github.com/beautyfree/skiller'
              )
            }
          >
            <GitBranch className="size-3" />
            github.com/beautyfree/skiller
            <ExternalLink className="size-3" />
          </button>
        </section>
      </div>

    </div>
  )
}
