import { getVercelOidcToken } from '@vercel/oidc'

/** Gets a short-lived, request-scoped credentials for skills.sh. */
export async function getSkillsOidcToken(): Promise<string | undefined> {
  try {
    return await getVercelOidcToken()
  } catch {
    // Vercel's documented local-development path after `vercel env pull`.
    return process.env.VERCEL_OIDC_TOKEN
  }
}
