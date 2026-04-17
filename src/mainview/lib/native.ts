import { isTrpcQueryProcedure } from '@/shared/trpc-query-procedures'
import type { AppRPCSchema } from '@/shared/rpc-schema'

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

const DEFAULT_TRPC_URL = 'http://127.0.0.1:17888'
const ELECTRON_PUSH_CHANNEL = 'skiller:push'

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
}

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
      const baseUrl = (msg.payload as { baseUrl?: string } | undefined)?.baseUrl
      if (typeof baseUrl === 'string' && baseUrl.length > 0) {
        window.__SKILLER_TRPC_BASE_URL__ = baseUrl
      }
    }
    dispatchPush(msg.name, msg.payload)
  })
}

// Fire-and-forget — any `listen()` call races with this; missed events during
// boot are extremely unlikely in practice because main waits for renderer to
// signal ready before sending, but we queue nothing explicitly.
void bootPushTransport()

/** ------------------------------------------------------------------
 * tRPC base URL resolution + request helper.
 * ------------------------------------------------------------------ */

function trpcBaseUrl(): string {
  const override = parseTrpcPortOverride()
  if (override !== null) {
    return `http://127.0.0.1:${override}`
  }
  if (typeof window !== 'undefined' && window.__SKILLER_TRPC_BASE_URL__) {
    return window.__SKILLER_TRPC_BASE_URL__
  }
  if (isBundledSkillerView()) {
    return DEFAULT_TRPC_URL
  }
  return (
    (import.meta as ImportMeta & { env?: { VITE_TRPC_URL?: string } }).env
      ?.VITE_TRPC_URL ?? DEFAULT_TRPC_URL
  )
}

type TrpcSingleResponse<T> =
  | { result: { data?: T } }
  | { error: { message?: string; code?: number; data?: unknown } }

async function callTrpcProcedure<T>(
  name: string,
  input: unknown,
  isQuery: boolean,
): Promise<T> {
  const base = trpcBaseUrl()
  let url = `${base}/trpc/${name}`
  const init: RequestInit = {
    method: isQuery ? 'GET' : 'POST',
  }
  if (isQuery) {
    if (input !== undefined) {
      url += `?input=${encodeURIComponent(JSON.stringify(input))}`
    }
  } else if (input !== undefined) {
    init.headers = { 'Content-Type': 'application/json' }
    init.body = JSON.stringify(input)
  }
  const res = await trpcFetch(url, init)
  const payload = (await res.json()) as TrpcSingleResponse<T>
  if (!res.ok || ('error' in payload && payload.error)) {
    const detail =
      payload && typeof payload === 'object' && 'error' in payload && payload.error
        ? JSON.stringify(payload.error)
        : `HTTP ${res.status}`
    throw new Error(`tRPC ${name} failed: ${detail}`)
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
  return callTrpcProcedure<BunRequests[K]['response']>(
    name,
    input,
    isTrpcQueryProcedure(name),
  )
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

export async function pickFolder(options?: {
  title?: string
}): Promise<string | null> {
  return invoke('pick_folder', options?.title ? { title: options.title } : undefined)
}
