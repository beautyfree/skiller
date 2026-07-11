import { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, RotateCw, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { AppUpdateStatusJson } from '@/shared/rpc-schema'
import { invoke, listen, openUrl } from '@/mainview/lib/native'
import { cn } from '@/mainview/lib/utils'
import { Button } from '@/mainview/components/ui/button'
import { useToast } from '@/mainview/components/ToastProvider'

const DISMISSED_UPDATE_VERSION_KEY = 'skiller.dismissed_update_version'

function readDismissedVersion(): string | null {
  try {
    return localStorage.getItem(DISMISSED_UPDATE_VERSION_KEY)
  } catch {
    return null
  }
}

function writeDismissedVersion(version: string | null): void {
  try {
    if (version) localStorage.setItem(DISMISSED_UPDATE_VERSION_KEY, version)
  } catch {
    // Ignore storage errors in private/locked environments.
  }
}

export default function AppUpdateBanner() {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [status, setStatus] = useState<AppUpdateStatusJson | null>(null)
  const [busy, setBusy] = useState<'idle' | 'downloading' | 'applying'>('idle')
  const [dismissedVersion, setDismissedVersion] = useState(() =>
    readDismissedVersion(),
  )

  useEffect(() => {
    let cancelled = false
    let unlisten: (() => void) | undefined

    invoke('app_update_status')
      .then((snapshot) => {
        if (!cancelled) setStatus(snapshot)
      })
      .catch(() => {})

    void listen<AppUpdateStatusJson>(
      'app_update_status_changed',
      ({ payload }) => {
        setStatus(payload)
        if (
          payload.remoteVersion &&
          payload.remoteVersion !== dismissedVersion &&
          (payload.state === 'available' ||
            payload.state === 'downloading' ||
            payload.state === 'ready' ||
            payload.state === 'error')
        ) {
          setDismissedVersion(readDismissedVersion())
        }
      },
    ).then((cleanup) => {
      if (cancelled) cleanup()
      else unlisten = cleanup
    })

    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [dismissedVersion])

  const visible = useMemo(() => {
    if (!status?.remoteVersion) return false
    if (dismissedVersion === status.remoteVersion) return false
    return (
      status.state === 'available' ||
      status.state === 'downloading' ||
      status.state === 'ready' ||
      status.state === 'error'
    )
  }, [dismissedVersion, status])

  const handleDismiss = useCallback(() => {
    const version = status?.remoteVersion ?? null
    writeDismissedVersion(version)
    setDismissedVersion(version)
  }, [status?.remoteVersion])

  const handlePrimaryAction = useCallback(async () => {
    if (!status) return
    if (status.state === 'error' && status.manualDownloadUrl) {
      await openUrl(status.manualDownloadUrl)
      return
    }
    if (status.state === 'ready') {
      setBusy('applying')
      try {
        await invoke('app_update_apply')
      } catch (e) {
        toast(
          `${t('settings.updateStateError')}: ${
            e instanceof Error ? e.message : String(e)
          }`,
          'destructive',
        )
        setBusy('idle')
      }
      return
    }

    setBusy('downloading')
    try {
      const snapshot = await invoke('app_update_download')
      if (snapshot) setStatus(snapshot)
      if (snapshot?.state === 'error' && snapshot.error) {
        toast(snapshot.error, 'destructive')
      }
    } catch (e) {
      toast(
        `${t('settings.updateStateError')}: ${
          e instanceof Error ? e.message : String(e)
        }`,
        'destructive',
      )
    } finally {
      setBusy('idle')
    }
  }, [status, t, toast])

  if (!visible || !status) return null

  const current = status.localVersion
  const latest = status.remoteVersion ?? ''
  const progress = typeof status.progress === 'number' ? status.progress : null
  const downloading = status.state === 'downloading' || busy === 'downloading'
  const ready = status.state === 'ready'
  const failed = status.state === 'error'

  return (
    <div className="pointer-events-none fixed left-1/2 top-4 z-[120] w-[min(calc(100vw-2rem),38rem)] -translate-x-1/2">
      <section
        role="status"
        aria-live="polite"
        className="skiller-update-banner pointer-events-auto animate-update-banner-in overflow-hidden rounded-xl border text-card-foreground backdrop-blur-xl"
      >
        <div className="flex items-center gap-3 px-3 py-2.5">
          <div
            className={cn(
              'skiller-update-mark flex size-8 shrink-0 items-center justify-center rounded-lg text-primary',
              ready && 'skiller-update-mark-ready',
              failed && 'text-destructive',
            )}
          >
            {ready ? (
              <RotateCw className="size-4" aria-hidden="true" />
            ) : (
              <Download className="size-4" aria-hidden="true" />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold leading-5">
              {failed
                ? t('settings.updateErrorTitle')
                : ready
                ? t('settings.updateBannerReadyTitle')
                : t('settings.updateBannerTitle', { version: latest })}
            </p>
            <p className="truncate text-xs leading-4 text-muted-foreground">
              {failed
                ? status.error || t('settings.updateStateError')
                : downloading
                ? progress == null
                  ? t('settings.updatePreparingDownload')
                  : t('settings.updateBannerDownloading', {
                      progress,
                    })
                : t('settings.updateBannerDescription', {
                    current,
                    latest,
                  })}
            </p>
          </div>

          <Button
            size="sm"
            variant="outline"
            className="skiller-update-action shrink-0"
            onClick={handlePrimaryAction}
            disabled={downloading || busy === 'applying'}
          >
            {ready ? (
              <RotateCw className="size-3.5" aria-hidden="true" />
            ) : (
              <Download className="size-3.5" aria-hidden="true" />
            )}
            {ready
              ? t('settings.updateRestart')
              : failed
                ? t('settings.updateManualDownload')
              : downloading
                ? t('settings.updateBannerUpdating')
                : t('settings.updateBannerAction')}
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="shrink-0 text-muted-foreground hover:text-foreground"
            onClick={handleDismiss}
            aria-label={t('settings.updateBannerDismiss')}
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        </div>

        {downloading && (
          <div className="h-1 bg-muted">
            <div
              className={cn(
                'h-full bg-primary transition-[width] duration-300',
                progress == null && 'skiller-update-progress-indeterminate',
              )}
              style={progress == null ? undefined : { width: `${progress}%` }}
            />
          </div>
        )}
      </section>
    </div>
  )
}
