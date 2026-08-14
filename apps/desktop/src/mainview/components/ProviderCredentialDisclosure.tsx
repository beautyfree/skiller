import { createPortal } from 'react-dom'
import { Github, Gitlab } from 'lucide-react'
import { Button } from '@/mainview/components/ui/button'

export type CredentialProvider = 'github' | 'gitlab'

function disclosurePreferenceKey(provider: CredentialProvider): string {
  return `skiller.provider-credential-disclosure.${provider}.v1`
}

/** Returns false until the person has explicitly acknowledged their first
 * Keychain-backed connection to this provider. */
export function hasAcknowledgedProviderCredentialDisclosure(provider: CredentialProvider): boolean {
  try {
    return localStorage.getItem(disclosurePreferenceKey(provider)) === '1'
  } catch {
    // A missing preference store must not turn an OS credential prompt into a
    // surprise. Show the explanation again instead.
    return false
  }
}

export function acknowledgeProviderCredentialDisclosure(provider: CredentialProvider): void {
  try {
    localStorage.setItem(disclosurePreferenceKey(provider), '1')
  } catch {
    // The action can still proceed; the next explicit use will explain again.
  }
}

export function providerForRemote(remote: string | null | undefined): CredentialProvider | null {
  if (!remote) return null
  const value = remote.toLowerCase()
  if (value.includes('github.com')) return 'github'
  if (value.includes('gitlab.com')) return 'gitlab'
  return null
}

export function ProviderCredentialDisclosure({
  provider,
  onCancel,
  onContinue,
}: {
  provider: CredentialProvider
  onCancel: () => void
  onContinue: () => void
}) {
  const providerName = provider === 'github' ? 'GitHub' : 'GitLab'

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-4" role="presentation">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="provider-credential-disclosure-title"
        className="w-full max-w-md rounded-2xl border border-border bg-background p-6 shadow-2xl"
      >
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            {provider === 'github' ? <Github className="size-5" /> : <Gitlab className="size-5" />}
          </div>
          <div className="min-w-0">
            <h2 id="provider-credential-disclosure-title" className="text-base font-semibold tracking-[-0.02em]">Use {providerName} securely</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              Skiller will unlock its encrypted {providerName} connection. On macOS, the encryption key is kept in Keychain and macOS may ask for your login password.
            </p>
          </div>
        </div>
        <div className="mt-5 rounded-xl border border-border/70 bg-muted/30 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
          Your password stays with macOS and is never sent to Skiller. The encrypted connection stays in Skiller&apos;s private app data; Skiller does not read or share <span className="font-mono text-foreground">dotagents</span> credential entries. If no connection is saved, you can sign in in your browser instead.
        </div>
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">In the macOS dialog, choose <span className="font-medium text-foreground">Always Allow</span> if you want Skiller to reuse this connection without asking again.</p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel}>Not now</Button>
          <Button onClick={onContinue}>Continue to {providerName}</Button>
        </div>
      </section>
    </div>,
    document.body,
  )
}
