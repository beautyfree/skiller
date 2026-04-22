import posthog from 'posthog-js'

const DEFAULT_POSTHOG_KEY = 'phc_q6DHwwvAXc2XeGRFsZ3qQiyF5p5gbXqLJduYm4kR742G'
const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com'

const env = import.meta as ImportMeta & {
  env?: {
    VITE_POSTHOG_KEY?: string
    VITE_POSTHOG_HOST?: string
    MODE?: string
  }
}

const TELEMETRY_DISABLED =
  (env.env?.VITE_POSTHOG_KEY ?? DEFAULT_POSTHOG_KEY).trim().length === 0

let initialized = false
let telemetryEnabled = false

export function initTelemetry(): void {
  if (initialized || TELEMETRY_DISABLED) return
  initialized = true

  posthog.init(env.env?.VITE_POSTHOG_KEY ?? DEFAULT_POSTHOG_KEY, {
    api_host: env.env?.VITE_POSTHOG_HOST ?? DEFAULT_POSTHOG_HOST,
    capture_pageview: false,
    capture_pageleave: true,
    autocapture: true,
    person_profiles: 'identified_only',
    persistence: 'localStorage+cookie',
    loaded: (client) => {
      client.register({
        app: 'skiller-desktop',
        app_env: env.env?.MODE ?? 'unknown',
      })
      if (!telemetryEnabled) {
        client.opt_out_capturing()
      }
    },
  })
}

export function setTelemetryEnabled(enabled: boolean): void {
  telemetryEnabled = enabled
  if (TELEMETRY_DISABLED || !initialized) return
  try {
    if (enabled) {
      posthog.opt_in_capturing()
    } else {
      posthog.opt_out_capturing()
    }
  } catch {
    // Keep telemetry non-blocking for UX and app flow.
  }
}

export function isTelemetryEnabled(): boolean {
  return telemetryEnabled
}

export function captureTelemetry(
  event: string,
  properties?: Record<string, unknown>,
): void {
  if (TELEMETRY_DISABLED || !initialized || !telemetryEnabled) return
  try {
    posthog.capture(event, properties)
  } catch {
    // Keep telemetry non-blocking for UX and app flow.
  }
}

export function identifyTelemetry(
  distinctId: string,
  properties?: Record<string, unknown>,
): void {
  if (TELEMETRY_DISABLED || !initialized || !telemetryEnabled) return
  try {
    posthog.identify(distinctId, properties)
  } catch {
    // Keep telemetry non-blocking for UX and app flow.
  }
}
