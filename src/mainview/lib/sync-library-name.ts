import type { SyncProfileStatusJson } from '@/shared/rpc-schema'

function isLocalFilesystemPath(source: string): boolean {
	return source.startsWith('/')
		|| source.startsWith('./')
		|| source.startsWith('../')
		|| /^[a-zA-Z]:[\\/]/.test(source)
		|| source.startsWith('\\\\')
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
