import { proxySkillsShSnapshot } from '../../../src/skillssh-proxy'

export default async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const prefix = '/api/v1/skills/'
  const identifier = decodeURIComponent(url.pathname.slice(prefix.length))
  return proxySkillsShSnapshot(identifier, {
    oidcToken: request.headers.get('x-vercel-oidc-token') ?? process.env.VERCEL_OIDC_TOKEN,
  })
}
