import '@/mainview/lib/native'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from '@/mainview/App'
import { ToastProvider } from '@/mainview/components/ToastProvider'
import { captureTelemetry, initTelemetry } from '@/mainview/lib/telemetry'
import '@/mainview/i18n'
import '@/mainview/index.css'

const queryClient = new QueryClient()
initTelemetry()

window.addEventListener('error', (event) => {
  captureTelemetry('renderer_error', {
    message: event.message || 'unknown',
    source: event.filename || 'unknown',
    line: event.lineno || 0,
  })
})

window.addEventListener('unhandledrejection', (event) => {
  const reason =
    event.reason instanceof Error
      ? event.reason.message
      : typeof event.reason === 'string'
        ? event.reason
        : 'unknown'
  captureTelemetry('renderer_unhandled_rejection', { reason })
})

/* ── Global mouse tracker for liquid-glass highlight (one listener; HMR dispose removes the previous) ── */
{
  const root = document.documentElement
  let ticking = false
  const onMouseMove = (e: MouseEvent) => {
    if (ticking) return
    ticking = true
    requestAnimationFrame(() => {
      root.style.setProperty('--mx', `${e.clientX}`)
      root.style.setProperty('--my', `${e.clientY}`)
      ticking = false
    })
  }
  document.addEventListener('mousemove', onMouseMove)
  import.meta.hot?.dispose(() => {
    document.removeEventListener('mousemove', onMouseMove)
  })
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <App />
      </ToastProvider>
    </QueryClientProvider>
  </React.StrictMode>
)
