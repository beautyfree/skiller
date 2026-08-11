import { afterEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyReviewedSyncDisconnect, planSyncDisconnect } from './sync-disconnect'

const tempRoots: string[] = []

afterEach(() => {
	for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('local library disconnect review', () => {
	it('allows a clean local connection to be moved to Trash without exposing a machine path', () => {
		const plan = planSyncDisconnect({
			profileId: 'agent-library',
			remoteIdentity: 'https://github.com/example/agent-library',
			changed: false,
			ahead: 0,
			recoveryPending: false,
		})
		expect(plan).toMatchObject({ canDisconnect: true, blockers: [] })
		expect(plan.planId).toMatch(/^[a-f0-9]{64}$/)
		expect(JSON.stringify(plan)).not.toContain('/Users/')
	})

	it('blocks local changes, pending uploads, and interrupted operations', () => {
		const plan = planSyncDisconnect({
			profileId: 'team-library',
			remoteIdentity: 'https://git.example.com/team/library',
			changed: true,
			ahead: 2,
			recoveryPending: true,
		})
		expect(plan.canDisconnect).toBe(false)
		expect(plan.blockers).toHaveLength(3)
	})

	it('does not block remote-only updates that can be fetched after reconnecting', () => {
		const plan = planSyncDisconnect({
			profileId: 'shared-library',
			remoteIdentity: 'https://gitlab.com/example/shared-library',
			changed: false,
			ahead: 0,
			recoveryPending: false,
		})
		expect(plan.canDisconnect).toBe(true)
	})

	it('applies only the unchanged reviewed plan through the platform Trash adapter', async () => {
		const root = mkdtempSync(join(tmpdir(), 'skiller-disconnect-'))
		tempRoots.push(root)
		const workspace = join(root, 'agent-library')
		mkdirSync(workspace)
		const trashed = join(root, 'trash', 'agent-library')
		mkdirSync(join(root, 'trash'))
		const plan = planSyncDisconnect({
			profileId: 'agent-library',
			remoteIdentity: 'https://github.com/example/agent-library',
			changed: false,
			ahead: 0,
			recoveryPending: false,
		})
		await applyReviewedSyncDisconnect(plan.planId, plan, async () => renameSync(workspace, trashed))
		expect(existsSync(workspace)).toBe(false)
		expect(existsSync(trashed)).toBe(true)
	})

	it('refuses a stale or blocked review before invoking the Trash adapter', async () => {
		let calls = 0
		const clean = planSyncDisconnect({ profileId: 'library', remoteIdentity: null, changed: false, ahead: 0, recoveryPending: false })
		await expect(applyReviewedSyncDisconnect('0'.repeat(64), clean, async () => { calls += 1 })).rejects.toThrow('changed after review')
		const blocked = planSyncDisconnect({ profileId: 'library', remoteIdentity: null, changed: true, ahead: 0, recoveryPending: false })
		await expect(applyReviewedSyncDisconnect(blocked.planId, blocked, async () => { calls += 1 })).rejects.toThrow('local library changes')
		expect(calls).toBe(0)
	})
})
