import { proxySkillsShSnapshot } from '../../src/skillssh-proxy.js'

export default {
  async fetch(request: Request): Promise<Response> {
    const identifier = new URL(request.url).searchParams.get('identifier') ?? ''
    return proxySkillsShSnapshot(identifier, {
      oidcToken: request.headers.get('x-vercel-oidc-token') ?? process.env.VERCEL_OIDC_TOKEN,
    })
  },
}
