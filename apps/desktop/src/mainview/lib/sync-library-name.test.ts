import { expect, test } from 'bun:test'
import { libraryDisplayName, sourceDisplayName } from './sync-library-name'

test('Sync Center labels local Git remotes without exposing a machine path', () => {
	expect(sourceDisplayName('file:///Users/alice/private/agent-library.git')).toBe('Local Git library')
	expect(sourceDisplayName('/Users/alice/private/agent-library.git')).toBe('Local Git library')
	expect(sourceDisplayName('C:\\Users\\alice\\private\\agent-library.git')).toBe('Local Git library')
	expect(sourceDisplayName('\\\\fileserver\\team\\agent-library.git')).toBe('Local Git library')
	expect(libraryDisplayName({ remote_identity: 'file:///tmp/agent-library.git' } as never)).toBe('Local Git library')
})

test('Sync Center keeps an identifiable name for network remotes', () => {
	expect(sourceDisplayName('https://github.com/beautyfree/agent-library.git')).toBe('github.com/beautyfree/agent-library')
	expect(sourceDisplayName('git@git.example.com:team/agent-library.git')).toBe('git.example.com/team/agent-library')
})
