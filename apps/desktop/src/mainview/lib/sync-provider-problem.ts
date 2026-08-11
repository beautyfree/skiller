import type { SyncProviderProblemJson } from '@/shared/rpc-schema'

export type ProviderProblemAction = 'connect' | 'retry' | 'rename' | 'choose-existing' | 'choose-other'

export function providerProblemPresentation(
	provider: 'github' | 'gitlab',
	target: 'connect' | 'create',
	problem: SyncProviderProblemJson,
): { message: string; action: ProviderProblemAction; actionLabel: string } {
	const name = provider === 'github' ? 'GitHub' : 'GitLab'
	const item = provider === 'github' ? 'repository' : 'project'
	if (problem.kind === 'authentication') {
		return { message: `Connect ${name} on this computer to continue.`, action: 'connect', actionLabel: `Connect ${name}` }
	}
	if (problem.kind === 'cli-missing') {
		return {
			message: `${name} setup is unavailable on this computer. You can install its official CLI, or use a Git address instead.`,
			action: 'choose-other',
			actionLabel: 'Use a Git address',
		}
	}
	if (problem.kind === 'unavailable') {
		return { message: `${name} could not be reached. Check your connection and try again.`, action: 'retry', actionLabel: 'Try again' }
	}
	if (problem.kind === 'conflict') {
		return {
			message: target === 'create' ? `That ${item} name is already in use. Choose another name.` : `${name} returned a conflicting library result. Try again.`,
			action: target === 'create' ? 'rename' : 'retry',
			actionLabel: target === 'create' ? 'Change name' : 'Try again',
		}
	}
	if (problem.kind === 'permission') {
		return {
			message: `The connected ${name} account does not have access to this ${item}. Review the account or choose another location.`,
			action: 'connect',
			actionLabel: 'Review account',
		}
	}
	if (problem.kind === 'created-unresolved') {
		return {
			message: `The ${item} was created, but Skiller could not confirm its address. Choose the new ${item} instead of creating it again.`,
			action: 'choose-existing',
			actionLabel: `Choose from ${name}`,
		}
	}
	return { message: `${name} could not complete the request. Nothing was changed by Skiller.`, action: 'retry', actionLabel: 'Try again' }
}
