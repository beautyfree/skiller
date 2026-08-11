import { proxySkillsShSnapshot } from '../../../src/skillssh-proxy.js'
import { getRequestHeader, getRequestUrl, sendResponse } from '../../../src/vercel-handler.js'
import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(request: VercelRequest, response: VercelResponse): Promise<void> {
  const url = getRequestUrl(request)
  const prefix = '/api/v1/skills/'
  const identifier = decodeURIComponent(url.pathname.slice(prefix.length))
  await sendResponse(
    await proxySkillsShSnapshot(identifier, {
      oidcToken: getRequestHeader(request, 'x-vercel-oidc-token') ?? process.env.VERCEL_OIDC_TOKEN,
    }),
    response,
  )
}
