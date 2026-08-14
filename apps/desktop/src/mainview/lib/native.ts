import { isTrpcQueryProcedure } from '@/shared/trpc-query-procedures'
import type { AppRPCSchema } from '@/shared/rpc-schema'
import { captureTelemetry } from '@/mainview/lib/telemetry'

/**
 * Renderer-side glue to the main process.
 *
 * Two transports coexist during the Electrobun → Electron migration:
 *  - Electrobun (legacy): `electrobun/view` gives a typed duplex RPC; we only
 *    use its message-listener side since request/response already goes through
 *    tRPC HTTP.
 *  - Electron (new): preload exposes `window.api.on/invoke`; main process
 *    pushes events via `webContents.send(PUSH_CHANNEL, { name, payload })`.
 *
 * Both paths populate `window.__SKILLER_TRPC_BASE_URL__` and fan events out
 * through a shared in-process EventTarget so `listen()` callers don't care.
 */

declare global {
  interface Window {
    /** Set by the main process (either host) when tRPC binds a port. */
    __SKILLER_TRPC_BASE_URL__?: string
    /** Per-process capability issued only over Electron IPC. */
    __SKILLER_TRPC_TOKEN__?: string
    /** Electron preload-exposed bridge. Absent under Electrobun or plain Vite. */
    api?: {
      platform: NodeJS.Platform
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
      on: (
        channel: string,
        listener: (...args: unknown[]) => void,
      ) => () => void
    }
  }
}

type BunRequests = AppRPCSchema['bun']['requests']
export type BunPushMessage = keyof AppRPCSchema['bun']['messages']

const ELECTRON_PUSH_CHANNEL = 'skiller:push'
const ELECTRON_TRPC_ENDPOINT_CHANNEL = 'skiller:trpc-endpoint'
const TRPC_TOKEN_HEADER = 'X-Skiller-Rpc-Token'

/** WKWebView can time out localhost requests around 60s; keep signal long-lived. */
const TRPC_FETCH_MAX_MS = 600_000

function mergeLongLivedSignal(
  parent: AbortSignal | undefined,
  maxMs: number,
): AbortSignal | undefined {
  if (typeof AbortSignal === 'undefined' || typeof AbortSignal.timeout !== 'function') {
    return parent
  }
  const long = AbortSignal.timeout(maxMs)
  if (!parent) return long
  const anyFn = (
    AbortSignal as unknown as { any?: (signals: AbortSignal[]) => AbortSignal }
  ).any
  if (typeof anyFn === 'function') {
    return anyFn([parent, long])
  }
  return parent
}

function trpcFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const signal = mergeLongLivedSignal(init?.signal ?? undefined, TRPC_FETCH_MAX_MS)
  return fetch(input, { ...init, signal })
}

function isBundledSkillerView(): boolean {
  if (typeof window === 'undefined') return false
  return (
    window.location.protocol === 'views:' ||
    window.location.href.startsWith('views://')
  )
}

function isElectronHost(): boolean {
  return typeof window !== 'undefined' && typeof window.api !== 'undefined'
}

/** Vite: `?trpcPort=`. Optional `#trpcPort=` in hash if the host adds it. */
function parseTrpcPortOverride(): number | null {
  if (typeof window === 'undefined') return null
  const parse = (raw: string | null): number | null => {
    if (raw == null || raw === '') return null
    const n = Number.parseInt(raw, 10)
    if (Number.isFinite(n) && n > 0 && n < 65536) return n
    return null
  }
  const fromSearch = parse(new URLSearchParams(window.location.search).get('trpcPort'))
  if (fromSearch !== null) return fromSearch
  const { hash } = window.location
  if (hash.length > 1) {
    return parse(new URLSearchParams(hash.slice(1)).get('trpcPort'))
  }
  return null
}

/** ------------------------------------------------------------------
 * Push transport: normalizes Electrobun duplex RPC and Electron IPC
 * into a single EventTarget that exposes `addListener(name, handler)`.
 * ------------------------------------------------------------------ */

type PushListener = (payload: unknown) => void

const g = globalThis as typeof globalThis & {
  __skillerPushHub?: Map<string, Set<PushListener>>
  __skillerPushBooted?: boolean
  __skillerElectronTrpcEndpoint?: Promise<TrpcEndpoint>
}

type TrpcEndpoint = { baseUrl: string; token: string }

function getHub(): Map<string, Set<PushListener>> {
  if (!g.__skillerPushHub) g.__skillerPushHub = new Map()
  return g.__skillerPushHub
}

function dispatchPush(name: string, payload: unknown): void {
  const hub = getHub()
  const set = hub.get(name)
  if (!set) return
  for (const fn of set) {
    try {
      fn(payload)
    } catch (err) {
      console.warn(`[push:${name}] listener threw:`, err)
    }
  }
}

function addPushListener(name: string, fn: PushListener): () => void {
  const hub = getHub()
  let set = hub.get(name)
  if (!set) {
    set = new Set()
    hub.set(name, set)
  }
  set.add(fn)
  return () => set?.delete(fn)
}

async function bootPushTransport(): Promise<void> {
  if (g.__skillerPushBooted) return
  g.__skillerPushBooted = true

  if (!isElectronHost()) {
    // Running under plain Vite (`vite dev` with no Electron shell) — no push
    // transport is available. tRPC queries still work because they go over
    // HTTP directly to whatever server the developer has running.
    console.debug('[native] no Electron preload — push transport disabled')
    return
  }

  window.api!.on(ELECTRON_PUSH_CHANNEL, (...args: unknown[]) => {
    const msg = args[0] as { name?: string; payload?: unknown } | undefined
    if (!msg || typeof msg.name !== 'string') return
    if (msg.name === 'trpc_endpoint') {
      try {
        const endpoint = parseElectronTrpcEndpoint(msg.payload)
        window.__SKILLER_TRPC_BASE_URL__ = endpoint.baseUrl
        window.__SKILLER_TRPC_TOKEN__ = endpoint.token
      } catch {
        // The first invoke will request a fresh endpoint through IPC.
      }
    }
    dispatchPush(msg.name, msg.payload)
  })
}

// Fire-and-forget for later push events. The first Electron `invoke()` also
// pulls the endpoint over IPC, so queries cannot race this listener or fall
// through to another Skiller process that owns the preferred HTTP port.
void bootPushTransport()

/** ------------------------------------------------------------------
 * tRPC base URL resolution + request helper.
 * ------------------------------------------------------------------ */

export function parseElectronTrpcEndpoint(payload: unknown): TrpcEndpoint {
  const baseUrl =
    payload && typeof payload === 'object' && 'baseUrl' in payload
      ? (payload as { baseUrl?: unknown }).baseUrl
      : undefined
  const token =
    payload && typeof payload === 'object' && 'token' in payload
      ? (payload as { token?: unknown }).token
      : undefined
  if (typeof baseUrl !== 'string' || typeof token !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(token)) {
    throw new Error('Skiller could not connect to its local service.')
  }
  let parsed: URL
  try {
    parsed = new URL(baseUrl)
  } catch {
    throw new Error('Skiller could not connect to its local service.')
  }
  if (
    parsed.protocol !== 'http:' ||
    parsed.hostname !== '127.0.0.1' ||
    !parsed.port ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error('Skiller could not connect to its local service.')
  }
  return { baseUrl: parsed.origin, token }
}

async function trpcEndpoint(): Promise<TrpcEndpoint> {
  const override = parseTrpcPortOverride()
  if (override !== null) {
    throw new Error('Skiller local service authentication is unavailable for this port override.')
  }
  if (typeof window !== 'undefined' && window.__SKILLER_TRPC_BASE_URL__ && window.__SKILLER_TRPC_TOKEN__) {
    return { baseUrl: window.__SKILLER_TRPC_BASE_URL__, token: window.__SKILLER_TRPC_TOKEN__ }
  }
  if (isElectronHost()) {
    if (!g.__skillerElectronTrpcEndpoint) {
      g.__skillerElectronTrpcEndpoint = window.api!
        .invoke(ELECTRON_TRPC_ENDPOINT_CHANNEL)
        .then((payload) => {
          const endpoint = parseElectronTrpcEndpoint(payload)
          window.__SKILLER_TRPC_BASE_URL__ = endpoint.baseUrl
          window.__SKILLER_TRPC_TOKEN__ = endpoint.token
          return endpoint
        })
        .catch((error) => {
          g.__skillerElectronTrpcEndpoint = undefined
          throw error
        })
    }
    return g.__skillerElectronTrpcEndpoint
  }
  throw new Error(
    isBundledSkillerView()
      ? 'Skiller could not authenticate its local service.'
      : 'Open Skiller through its Electron shell to connect to its local service.',
  )
}

type TrpcSingleResponse<T> =
  | { result: { data?: T } }
  | { error: { message?: string; code?: number; data?: unknown } }

/** Keep server stacks and transport metadata out of user-facing errors. */
export function readableTrpcError(name: string, response: unknown, status: number): string {
  if (response && typeof response === 'object' && 'error' in response) {
    const error = (response as { error?: unknown }).error
    if (error && typeof error === 'object' && 'message' in error) {
      const message = (error as { message?: unknown }).message
      if (typeof message === 'string' && message.trim()) {
        return (message.split(/\n\s*at\s/)[0] ?? message).replace(/\s+/g, ' ').trim().slice(0, 600)
      }
    }
  }
  return `${name.replace(/_/g, ' ')} failed (HTTP ${status})`
}

/**
 * Cancelling an in-flight read is normal when a view changes. Depending on the
 * transport, it arrives as a DOMException, an Error named AbortError, or the
 * browser's "operation was aborted" message. Treat only those shapes as a
 * silent cancellation; every other failure remains user-visible.
 */
export function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return true
  if (error instanceof Error && error.name === 'AbortError') return true
  return error instanceof Error && /^(?:the )?operation was aborted\.?$/i.test(error.message.trim())
}

async function callTrpcProcedure<T>(
  name: string,
  input: unknown,
  isQuery: boolean,
): Promise<T> {
  const endpoint = await trpcEndpoint()
  let url = `${endpoint.baseUrl}/trpc/${name}`
  const init: RequestInit = {
    method: isQuery ? 'GET' : 'POST',
    headers: { [TRPC_TOKEN_HEADER]: endpoint.token },
  }
  if (isQuery) {
    if (input !== undefined) {
      url += `?input=${encodeURIComponent(JSON.stringify(input))}`
    }
  } else {
    // tRPC v11 requires Content-Type: application/json on every mutation,
    // even ones with no input (it rejects the body-less POST with 415
    // UNSUPPORTED_MEDIA_TYPE before reaching the procedure).
    init.headers = { ...init.headers, 'Content-Type': 'application/json' }
    init.body = input === undefined ? '{}' : JSON.stringify(input)
  }
  const res = await trpcFetch(url, init)
  const payload = (await res.json()) as TrpcSingleResponse<T>
  if (!res.ok || ('error' in payload && payload.error)) {
    throw new Error(readableTrpcError(name, payload, res.status))
  }
  const data = 'result' in payload ? payload.result.data : undefined
  return data as T
}

export async function invoke<K extends keyof BunRequests>(
  cmd: K,
  ...args: undefined extends BunRequests[K]['params']
    ? [params?: BunRequests[K]['params']]
    : [params: BunRequests[K]['params']]
): Promise<BunRequests[K]['response']> {
  const name = cmd as string
  const input = args[0]
  const isQuery = isTrpcQueryProcedure(name)
  const startedAt = performance.now()
  try {
    const response = await callTrpcProcedure<BunRequests[K]['response']>(
      name,
      input,
      isQuery,
    )
    if (!isQuery) {
      captureTelemetry('rpc_mutation_called', {
        command: name,
        duration_ms: Math.round(performance.now() - startedAt),
      })
    }
    return response
  } catch (error) {
    const message =
      error instanceof Error ? error.message.slice(0, 240) : 'unknown'
    captureTelemetry('rpc_call_failed', {
      command: name,
      is_query: isQuery,
      duration_ms: Math.round(performance.now() - startedAt),
      message,
    })
    throw error
  }
}

export async function listen<T>(
  message: BunPushMessage,
  handler: (event: { payload: T }) => void,
): Promise<() => void> {
  return addPushListener(message, (payload) => handler({ payload: payload as T }))
}

export function openUrl(url: string): void {
  void invoke('open_external', { url })
}

export function revealItemInDir(path: string): void {
  void invoke('reveal_path_in_folder', { path })
}

/** Open a discovered skill's directory itself, rather than merely revealing a file in it. */
export function openSkillFolder(skillId: string): void {
  void invoke('open_skill_folder', { skillId })
}

export async function pickFolder(options?: {
  title?: string
}): Promise<string | null> {
  return invoke('pick_folder', options?.title ? { title: options.title } : undefined)
}
