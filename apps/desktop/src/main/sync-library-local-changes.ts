import { classifyToolkitChanges } from 'dotagents/toolkit-review'
import type { DotagentsLibraryLocalChangesJson } from '../shared/rpc-schema'
import type { SyncInventory } from './sync-inventory'
import type { SyncLedger } from './sync-ledger'
import type { SyncManifest } from './sync-profile'

type RestoreEntry = { id: string }

/**
 * Presentation adapter only. dotagents owns the actual classification rules;
 * Skiller converts its result to the stable renderer JSON contract.
 */
export function classifyLibraryLocalChanges({
  inventory,
  manifest,
  ledger,
  restoreEntries,
  libraryExclusions,
}: {
  inventory: SyncInventory
  manifest: SyncManifest
  ledger: SyncLedger | null
  restoreEntries: readonly RestoreEntry[]
  libraryExclusions?: Readonly<Record<string, { integrity: string }>>
}): DotagentsLibraryLocalChangesJson['changes'] {
  void restoreEntries
  return classifyToolkitChanges({
    items: inventory.items.map((item) => ({ id: item.candidateKey, name: item.displayName, integrity: item.contentHash })),
    library: manifest.skills.filter((skill) => skill.kind === 'bundled').map((skill) => ({ id: skill.id, integrity: skill.sha256 })),
    observedIntegrity: ledger?.observed_content_hashes,
    libraryExclusions: libraryExclusions,
  }).map((change) => ({
    id: change.id,
    display_name: change.name,
    kind: change.kind,
    detail: change.kind === 'new-local'
      ? 'Found on this computer, but not saved in this library.'
      : change.kind === 'kept-local'
        ? 'Kept on this computer and not included in this library.'
      : change.kind === 'changed-local'
        ? 'Its local files differ from the version saved in this library.'
        : 'It was on this computer, but is not found now.',
  }))
}
