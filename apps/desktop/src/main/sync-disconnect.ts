import { computePlanId } from 'dotagents'

export type SyncDisconnectFacts = {
	profileId: string
	remoteIdentity: string | null
	changed: boolean
	ahead: number
	recoveryPending: boolean
}

export type SyncDisconnectPlan = {
	planId: string
	profileId: string
	remoteIdentity: string | null
	canDisconnect: boolean
	blockers: string[]
}

/**
 * Build a path-free, deterministic review for forgetting one local library
 * connection. A remote-only update is not a blocker: reconnecting can fetch it
 * again. Local work and interrupted transactions must never be discarded.
 */
export function planSyncDisconnect(facts: SyncDisconnectFacts): SyncDisconnectPlan {
	const blockers = [
		...(facts.recoveryPending ? ['Finish recovery before disconnecting this library.'] : []),
		...(facts.changed ? ['Review or discard the local library changes before disconnecting.'] : []),
		...(facts.ahead > 0 ? [`Upload ${facts.ahead} pending ${facts.ahead === 1 ? 'change' : 'changes'} before disconnecting.`] : []),
	]
	const payload = {
		kind: 'skiller-sync-disconnect',
		schemaVersion: 1,
		profileId: facts.profileId,
		remoteIdentity: facts.remoteIdentity,
		changed: facts.changed,
		ahead: facts.ahead,
		recoveryPending: facts.recoveryPending,
	}
	return {
		planId: computePlanId(payload),
		profileId: facts.profileId,
		remoteIdentity: facts.remoteIdentity,
		canDisconnect: blockers.length === 0,
		blockers,
	}
}

export async function applyReviewedSyncDisconnect(
	reviewedPlanId: string,
	current: SyncDisconnectPlan,
	trashConnection: () => Promise<void>,
): Promise<void> {
	if (current.planId !== reviewedPlanId) throw new Error('The local library changed after review. Review disconnect again.')
	if (!current.canDisconnect) throw new Error(current.blockers[0] ?? 'This library cannot be disconnected yet')
	await trashConnection()
}
