import { Electroview } from 'electrobun/view'
import { isTrpcQueryProcedure } from '@/shared/trpc-query-procedures'
import type { AppRPCSchema } from '@/shared/rpc-schema'

declare global {
  interface Window {
    /** Set by Bun via webview.executeJavascript when tRPC binds a port (including fallback). */
    __SKILLER_TRPC_BASE_URL__?: string
  }
}

type BunRequests = AppRPCSchema['bun']['requests']
export type BunPushMessage = keyof AppRPCSchema['bun']['messages']

const DEFAULT_TRPC_URL = 'http://127.0.0.1:17888'

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

const g = globalThis as typeof globalThis & {
  __agentSkillsNativeRpc?: ReturnType<typeof Electroview.defineRPC<AppRPCSchema>>
  __agentSkillsElectroviewBooted?: boolean
  __trpcEndpointListenerBound?: boolean
}

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

function getOrCreateNativeRpc() {
  if (!g.__agentSkillsNativeRpc) {
    g.__agentSkillsNativeRpc = Electroview.defineRPC<AppRPCSchema>({
      maxRequestTime: 300_000,
      handlers: {
        requests: {},
        messages: {},
      },
    } as Parameters<typeof Electroview.defineRPC<AppRPCSchema>>[0])
  }
  return g.__agentSkillsNativeRpc
}

export const nativeRpc = getOrCreateNativeRpc()

if (!g.__agentSkillsElectroviewBooted) {
  g.__agentSkillsElectroviewBooted = true
  new Electroview({ rpc: nativeRpc })
}

if (!g.__trpcEndpointListenerBound) {
  g.__trpcEndpointListenerBound = true
  nativeRpc.addMessageListener('trpc_endpoint', (payload: { baseUrl?: string }) => {
    if (typeof payload?.baseUrl === 'string' && payload.baseUrl.length > 0) {
      window.__SKILLER_TRPC_BASE_URL__ = payload.baseUrl
    }
  })
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
  try {
    return await callTrpcProcedure<BunRequests[K]['response']>(
      name,
      input,
      isTrpcQueryProcedure(name),
    )
  } catch (error) {
    throw error
  }
}

export async function listen<T>(
  message: BunPushMessage,
  handler: (event: { payload: T }) => void,
): Promise<() => void> {
  const wrapped = (payload: T) => handler({ payload })
  nativeRpc.addMessageListener(message, wrapped as (payload: unknown) => void)
  return () => {
    nativeRpc.removeMessageListener(
      message,
      wrapped as (payload: unknown) => void,
    )
  }
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
