import { proxySkillsShSnapshot } from '../../src/skillssh-proxy.js'
import { getSkillsOidcToken } from '../../src/oidc.js'

export default {
  async fetch(request: Request): Promise<Response> {
    const identifier = new URL(request.url).searchParams.get('identifier') ?? ''
    return proxySkillsShSnapshot(identifier, {
      oidcToken: await getSkillsOidcToken(),
    })
  },
}
