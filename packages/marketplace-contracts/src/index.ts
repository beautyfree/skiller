/**
 * Stable response boundary between the Skiller desktop app and its marketplace
 * gateway. dotagents intentionally does not import this package: Marketplace
 * discovery is a Skiller product concern, not a library-sync concern.
 */
export interface MarketplaceSkillFile {
  path: string
  contents: string
}

export interface MarketplaceSkillSnapshot {
  name: string
  source: string
  skill: string
  version?: string
  files: MarketplaceSkillFile[]
}

export interface MarketplaceProblem {
  error: string
  code:
    | 'invalid_skill_identifier'
    | 'authentication_unavailable'
    | 'upstream_unavailable'
    | 'upstream_response_invalid'
    | 'response_too_large'
}
