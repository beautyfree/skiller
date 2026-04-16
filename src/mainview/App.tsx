import { useEffect, useState } from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { listen, invoke } from '@/mainview/lib/native'
import { useTranslation } from 'react-i18next'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import SkillsManager from './pages/SkillsManager'
import Marketplace from './pages/Marketplace'
import SettingsPage from './pages/Settings'
import { useTheme } from './hooks/useTheme'
import CloseConfirmDialog from './components/CloseConfirmDialog'

function AppInner() {
  const queryClient = useQueryClient()
  const { i18n } = useTranslation()
  useTheme()
  const [closeDialogOpen, setCloseDialogOpen] = useState(false)

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
      })
      .catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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
      <Routes>
        {/* Electrobun / file URLs often use .../index.html as the pathname; SPA routes are /. */}
        <Route path="/index.html" element={<Navigate to="/" replace />} />
        <Route path="/main/index.html" element={<Navigate to="/" replace />} />
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="skills" element={<SkillsManager />} />
          <Route path="marketplace" element={<Marketplace />} />
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
