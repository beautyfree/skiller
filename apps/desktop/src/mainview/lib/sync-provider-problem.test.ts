import { describe, expect, test } from 'bun:test'
import { providerProblemPresentation } from './sync-provider-problem'

describe('Sync Center provider problem presentation', () => {
	test('offers the next safe action instead of treating every failure as authentication', () => {
		expect(providerProblemPresentation('github', 'connect', { kind: 'authentication' }).action).toBe('connect')
		expect(providerProblemPresentation('github', 'connect', { kind: 'unavailable' }).action).toBe('retry')
		expect(providerProblemPresentation('gitlab', 'create', { kind: 'conflict' }).action).toBe('rename')
		expect(providerProblemPresentation('github', 'create', { kind: 'created-unresolved' }).action).toBe('choose-existing')
		expect(providerProblemPresentation('gitlab', 'create', { kind: 'cli-missing' }).action).toBe('choose-other')
	})

	test('keeps raw command output out of user-facing copy', () => {
		for (const kind of ['authentication', 'cli-missing', 'unavailable', 'conflict', 'permission', 'created-unresolved', 'unknown'] as const) {
			const presentation = providerProblemPresentation('github', 'create', { kind })
			expect(presentation.message).not.toContain('token')
			expect(presentation.message).not.toContain('/Users/')
		}
	})
})
