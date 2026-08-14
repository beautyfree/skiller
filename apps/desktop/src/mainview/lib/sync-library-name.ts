import type { SyncProfileStatusJson } from '@/shared/rpc-schema'

function isLocalFilesystemPath(source: string): boolean {
	return source.startsWith('/')
		|| source.startsWith('./')
		|| source.startsWith('../')
		|| /^[a-zA-Z]:[\\/]/.test(source)
		|| source.startsWith('\\\\')
}

/**
 * Returns a browser-safe repository URL when the remote tells us one.
 *
 * A generic SSH remote does not guarantee a web UI, so it deliberately has no
 * link. GitHub and GitLab SSH remotes are the two well-known exceptions.
 */
export function repositoryBrowserUrl(source: string | null | undefined): string | null {
	if (!source || isLocalFilesystemPath(source)) return null

	try {
		const parsed = new URL(source)
		if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
			parsed.username = ''
			parsed.password = ''
			parsed.search = ''
			parsed.hash = ''
			parsed.pathname = parsed.pathname.replace(/\.git$/i, '')
			return parsed.toString().replace(/\/$/, '')
		}
		if (parsed.protocol !== 'ssh:') return null
		const host = parsed.hostname.toLowerCase()
		if (host !== 'github.com' && host !== 'gitlab.com') return null
		const path = parsed.pathname.replace(/^\/+/, '').replace(/\.git$/i, '')
		return path ? `https://${host}/${path}` : null
	} catch {
		const match = source.match(/^git@(github\.com|gitlab\.com):(.+)$/i)
		if (!match) return null
		const path = match[2].replace(/\.git$/i, '')
		return path ? `https://${match[1].toLowerCase()}/${path}` : null
	}
}

/** Safe, human-readable label for a library source in primary UI. */
export function sourceDisplayName(source: string): string {
	if (isLocalFilesystemPath(source)) return 'Local Git library'
	try {
		const parsed = new URL(source)
		if (parsed.protocol === 'file:') return 'Local Git library'
		return `${parsed.hostname}${parsed.pathname}`.replace(/\.git$/i, '')
	} catch {
		return source.replace(/^git@/, '').replace(':', '/').replace(/\.git$/i, '')
	}
}

export function libraryDisplayName(profile: SyncProfileStatusJson): string {
	return profile.remote_identity ? sourceDisplayName(profile.remote_identity) : 'Local library'
}
