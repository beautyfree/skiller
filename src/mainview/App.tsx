import { useEffect, useRef, useState } from 'react'
import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { listen, invoke } from '@/mainview/lib/native'
import { useTranslation } from 'react-i18next'
import {
  captureTelemetry,
  identifyTelemetry,
  setTelemetryEnabled,
} from '@/mainview/lib/telemetry'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import SkillsManager from './pages/SkillsManager'
import Marketplace from './pages/Marketplace'
import ProjectsPage from './pages/Projects'
import SettingsPage from './pages/Settings'
import OnboardingWizard from './components/OnboardingWizard'
import { useTheme } from './hooks/useTheme'
import CloseConfirmDialog from './components/CloseConfirmDialog'

const GITHUB_REPO_URL =
  'https://github.com/beautyfree/skiller-skills-desktop-manager'
const STAR_PROMPT_MIN_LAUNCHES = 3
const STAR_PROMPT_MIN_AGE_MS = 24 * 60 * 60 * 1000
const STAR_PROMPT_RESHOW_LAUNCHES = 3
const STAR_PROMPT_RESHOW_MS = 3 * 24 * 60 * 60 * 1000

function AppInner() {
  const queryClient = useQueryClient()
  const location = useLocation()
  const { i18n } = useTranslation()
  useTheme()
  const appOpenedTrackedRef = useRef(false)
  const [telemetryReady, setTelemetryReady] = useState(false)
  const [closeDialogOpen, setCloseDialogOpen] = useState(false)
  const [showGithubStarPrompt, setShowGithubStarPrompt] = useState(false)
  // Onboarding shows on very first launch (or when user explicitly replays it
  // from Settings). Guarded by a localStorage flag — we respect privacy mode
  // by falling back to "not done" if storage throws, which still shows once.
  const [onboardingOpen, setOnboardingOpen] = useState(() => {
    try {
      return localStorage.getItem('skiller.onboarding.done') !== '1'
    } catch {
      return true
    }
  })

  useEffect(() => {
    if (!telemetryReady || appOpenedTrackedRef.current) return
    appOpenedTrackedRef.current = true
    captureTelemetry('app_opened')
    void invoke('get_app_version')
      .then((version) => {
        identifyTelemetry(`desktop:${version}`, { app_version: version })
      })
      .catch(() => {})
  }, [telemetryReady])

  useEffect(() => {
    if (!telemetryReady) return
    captureTelemetry('page_view', {
      path: location.pathname,
      search: location.search,
    })
  }, [location.pathname, location.search, telemetryReady])

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ force?: boolean }>).detail
      if (detail?.force) setOnboardingOpen(true)
    }
    window.addEventListener('skiller:open-onboarding', handler)
    return () => window.removeEventListener('skiller:open-onboarding', handler)
  }, [])

  // macOS Electrobun: translucent shell when native blur is on (see shell_runtime + macos-window-effects.ts)
  useEffect(() => {
    if (typeof navigator === 'undefined') return
    const ua = navigator.userAgent
    const isMacDesktop = /Mac/.test(ua) && !/(iPhone|iPad|iPod)/.test(ua)
    if (!isMacDesktop) return
    const applyVibrancyClass = (on: boolean) => {
      document.documentElement.classList.toggle(
        'skiller-macos-vibrancy',
        on
      )
    }
    void invoke('shell_runtime')
      .then((flags) => {
        applyVibrancyClass(flags.macosWindowBlur)
      })
      .catch(() => {
        applyVibrancyClass(true)
      })
  }, [])

  useEffect(() => {
    let cancelled = false
    let unlisten: (() => void) | undefined
    void listen('shell_runtime_changed', (e) => {
      const { macosWindowBlur } = e.payload as { macosWindowBlur: boolean }
      document.documentElement.classList.toggle(
        'skiller-macos-vibrancy',
        macosWindowBlur
      )
    })
      .then((cleanup) => {
        if (cancelled) cleanup()
        else unlisten = cleanup
      })
      .catch(() => {})
    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [])

  // Restore the saved language preference from the backend on startup.
  useEffect(() => {
    invoke('read_settings')
      .then((settings) => {
        const lang = settings.language
        if (lang && lang !== i18n.language) {
          void i18n.changeLanguage(lang)
        }
        setTelemetryEnabled(settings.analytics_enabled !== false)
        setTelemetryReady(true)
      })
      .catch(() => {
        setTelemetryReady(true)
      })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Ask for a GitHub star once after meaningful usage cadence.
  useEffect(() => {
    let cancelled = false
    void invoke('read_settings')
      .then(async (settings) => {
        const existing = settings.github_star_prompt ?? {}
        const now = Date.now()
        const nowIso = new Date(now).toISOString()
        const firstSeenAt = existing.first_seen_at ?? nowIso
        const launchCount = Math.max(0, existing.launch_count ?? 0) + 1
        const hasClicked = Boolean(existing.cta_clicked_at)
        const dismissedAt = existing.dismissed_at
        const dismissedLaunchCount = Math.max(
          0,
          existing.dismissed_launch_count ?? 0,
        )
        const firstSeenMs = Date.parse(firstSeenAt)
        const ageMs = Number.isFinite(firstSeenMs) ? now - firstSeenMs : 0
        const reachedInitialCadence =
          launchCount >= STAR_PROMPT_MIN_LAUNCHES &&
          ageMs >= STAR_PROMPT_MIN_AGE_MS

        let shouldPrompt = false
        if (!hasClicked && reachedInitialCadence) {
          if (!dismissedAt) {
            shouldPrompt = true
          } else {
            const dismissedMs = Date.parse(dismissedAt)
            const dismissedAgeMs = Number.isFinite(dismissedMs)
              ? now - dismissedMs
              : 0
            const launchesSinceDismiss = Math.max(
              0,
              launchCount - dismissedLaunchCount,
            )
            shouldPrompt =
              launchesSinceDismiss >= STAR_PROMPT_RESHOW_LAUNCHES ||
              dismissedAgeMs >= STAR_PROMPT_RESHOW_MS
          }
        }

        const nextSettings = {
          ...settings,
          github_star_prompt: {
            ...existing,
            first_seen_at: firstSeenAt,
            launch_count: launchCount,
          },
        }

        await invoke('write_settings', { settings: nextSettings })
        if (!cancelled && shouldPrompt) setShowGithubStarPrompt(true)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const handleGithubStarDismiss = () => {
    setShowGithubStarPrompt(false)
    captureTelemetry('github_star_prompt_dismissed')
    void invoke('read_settings')
      .then((settings) => {
        const existing = settings.github_star_prompt ?? {}
        const launchCount = Math.max(0, existing.launch_count ?? 0)
        return invoke('write_settings', {
          settings: {
            ...settings,
            github_star_prompt: {
              ...existing,
              dismissed_at: new Date().toISOString(),
              dismissed_launch_count: launchCount,
              dismiss_count: Math.max(0, existing.dismiss_count ?? 0) + 1,
            },
          },
        })
      })
      .catch(() => {})
  }

  const handleGithubStarClick = () => {
    setShowGithubStarPrompt(false)
    captureTelemetry('github_star_prompt_clicked')
    void invoke('open_external', { url: GITHUB_REPO_URL })
    void invoke('read_settings')
      .then((settings) =>
        invoke('write_settings', {
          settings: {
            ...settings,
            github_star_prompt: {
              ...(settings.github_star_prompt ?? {}),
              cta_clicked_at: new Date().toISOString(),
            },
          },
        }),
      )
      .catch(() => {})
  }

  useEffect(() => {
    if (showGithubStarPrompt) {
      captureTelemetry('github_star_prompt_shown')
    }
  }, [showGithubStarPrompt])

  useEffect(() => {
    let cancelled = false
    let unlisten: (() => void) | undefined
    void listen('skills_changed', () => {
      queryClient.invalidateQueries({ queryKey: ['skills'] })
      queryClient.invalidateQueries({ queryKey: ['repo-skills'] })
      queryClient.invalidateQueries({ queryKey: ['agents'] })
    })
      .then((cleanup) => {
        if (cancelled) cleanup()
        else unlisten = cleanup
      })
      .catch(() => {})

    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [queryClient])

  useEffect(() => {
    let cancelled = false
    let unlisten: (() => void) | undefined
    void listen('close_requested', () => {
      setCloseDialogOpen(true)
    })
      .then((cleanup) => {
        if (cancelled) cleanup()
        else unlisten = cleanup
      })
      .catch(() => {})
    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [])

  return (
    <>
      <CloseConfirmDialog
        open={closeDialogOpen}
        onDone={() => setCloseDialogOpen(false)}
      />
      {onboardingOpen && (
        <OnboardingWizard onClose={() => setOnboardingOpen(false)} />
      )}
      <Routes>
        {/* Electrobun / file URLs often use .../index.html as the pathname; SPA routes are /. */}
        <Route path="/index.html" element={<Navigate to="/" replace />} />
        <Route path="/main/index.html" element={<Navigate to="/" replace />} />
        <Route
          element={
            <Layout
              showGithubStarPrompt={showGithubStarPrompt}
              onDismissGithubStarPrompt={handleGithubStarDismiss}
              onGithubStarPromptCta={handleGithubStarClick}
            />
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="skills" element={<SkillsManager />} />
          <Route path="marketplace" element={<Marketplace />} />
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Routes>
    </>
  )
}

export default function App() {
  // HashRouter: routing stays in the URL fragment (#/…), so the document URL remains
  // views://mainview/index.html. BrowserRouter navigations to "/" become views://mainview/ and the
  // views:// handler returns an empty body (no directory index).
  return (
    <HashRouter>
      <AppInner />
    </HashRouter>
  )
}
