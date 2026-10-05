import test from 'node:test';
import assert from 'node:assert/strict';
import { VARIANTS, detectPlatform, resolveRelease } from '../docs/assets/download-release.mjs';

function fixture() {
  return { tag_name: 'v0.3.5', draft: false, prerelease: false,
    assets: Object.values(VARIANTS).map(v => {
      const name = 'Skiller-0.3.5-' + v.suffix;
      return { name, state: 'uploaded', size: 1000, browser_download_url: 'https://github.com/beautyfree/skiller/releases/download/v0.3.5/' + name };
    }) };
}
test('Mac Intel user agent alone must not guess a Mac processor', () => {
  assert.deepEqual(detectPlatform({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' }), { os: 'mac', variant: '' });
  assert.equal(detectPlatform({ platform: 'macOS', architecture: 'arm', bitness: '64' }).variant, 'mac-arm64');
  assert.equal(detectPlatform({ platform: 'macOS', architecture: 'x86', bitness: '64' }).variant, 'mac-x64');
});
test('desktop platforms and mobile devices select only supported builds', () => {
  assert.equal(detectPlatform({ userAgent: 'Windows NT 10.0; Win64; x64' }).variant, 'windows-x64');
  assert.equal(detectPlatform({ userAgent: 'X11; Linux x86_64' }).variant, 'linux-appimage');
  assert.equal(detectPlatform({ platform: 'Windows', architecture: 'arm', bitness: '64' }).unsupported, true);
  assert.equal(detectPlatform({ userAgent: 'iPhone; CPU iPhone OS like Mac OS X' }).os, '');
  assert.equal(detectPlatform({ platform: 'MacIntel', mobile: true }).os, '');
});
test('selects only exact installers from the published stable version', () => {
  const release = fixture();
  release.assets.push({ name: 'Skiller-0.3.5-win-x64.exe.blockmap', state: 'uploaded', size: 99, browser_download_url: 'https://example.com' });
  const result = resolveRelease(release);
  assert.equal(Object.keys(result.assets).length, 6);
  assert.equal(result.assets['mac-arm64'].name, 'Skiller-0.3.5-macos-arm64.dmg');
  assert.equal(result.assets['windows-x64'].url, 'https://github.com/beautyfree/skiller/releases/download/v0.3.5/Skiller-0.3.5-win-x64.exe');
});
test('handles both actual and workflow Linux AppImage naming conventions', () => {
  const release = fixture();
  const app = release.assets.find(a => a.name.endsWith('.AppImage'));
  app.name = 'Skiller-0.3.5-linux-x86_64.AppImage';
  app.browser_download_url = 'https://github.com/beautyfree/skiller/releases/download/v0.3.5/' + app.name;
  assert.equal(resolveRelease(release).assets['linux-appimage'].name, app.name);
});
test('rejects draft, prerelease, malformed and empty release data', () => {
  for (const change of [{ draft: true }, { prerelease: true }, { tag_name: 'v0.3.5-beta' }, { assets: [] }]) {
    assert.throws(() => resolveRelease({ ...fixture(), ...change }));
  }
  assert.throws(() => resolveRelease(null));
});
test('never substitutes an older release, untrusted URL, unfinished or duplicate asset', () => {
  for (const change of [
    { browser_download_url: 'https://example.com/installer.exe' },
    { browser_download_url: 'https://github.com/beautyfree/skiller/releases/download/v0.3.4/Skiller-0.3.5-win-x64.exe' },
    { state: 'new' }, { size: 0 },
  ]) {
    const release = fixture();
    Object.assign(release.assets.find(a => a.name.endsWith('.exe')), change);
    assert.equal(resolveRelease(release).assets['windows-x64'], undefined);
  }
  const release = fixture();
  release.assets.push(release.assets.find(a => a.name.endsWith('.exe')));
  assert.equal(resolveRelease(release).assets['windows-x64'], undefined);
});

// Exercise the actual page controller without downloading a 140 MB installer.
async function runPage({ platform, search = '', fail = false, deniedHints = false, exercise }) {
  const selectors = ['#download-os', '#download-variant', '#download-single-build', '#download-action', '#download-status', '#download-detail', '#download-guidance', '#download-retry', '#release-link', '#download-controls', '#download-fallback', '#download-alternatives'];
  const nodes = new Map(selectors.map(s => [s, { hidden: false, value: '', textContent: '', href: '', clicks: 0, handlers: {},
    addEventListener(name, callback) { this.handlers[name] = callback; },
    removeAttribute(name) { this[name] = ''; },
    replaceChildren(...options) { this.options = options; }, add() {},
    click() { this.clicks++; this.handlers.click?.(); },
  }]));
  const panels = ['mac', 'windows', 'linux'].map(os => ({ dataset: { install: os } }));
  const formats = ['linux-appimage', 'linux-deb', 'linux-tar'].map(key => ({ dataset: { linuxFormat: key } }));
  const buttons = ['mac', 'windows', 'linux'].map(os => ({ dataset: { platform: os }, attributes: {}, handlers: {}, setAttribute(k, v) { this.attributes[k] = v; }, addEventListener(k, f) { this.handlers[k] = f; } }));
  const alternatives = Object.keys(VARIANTS).map(build => ({ dataset: { build }, handlers: {}, addEventListener(k, f) { this.handlers[k] = f; } }));
  const names = ['document', 'navigator', 'location', 'Option', 'fetch'];
  const saved = names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
  const replacements = {
    document: { querySelector: s => nodes.get(s), querySelectorAll: s => s === '[data-install]' ? panels : s === '[data-linux-format]' ? formats : s === '[data-platform]' ? buttons : s === '[data-build]' ? alternatives : [] },
    navigator: { platform: platform.platform, userAgent: platform.userAgent || '', maxTouchPoints: 0, userAgentData: {
      platform: platform.platform, mobile: false, getHighEntropyValues: async () => { if (deniedHints) throw new Error('Denied'); return platform; },
    } },
    location: { search },
    Option: class { constructor(label, value) { this.value = value; this.label = label; } },
    fetch: async () => { if (fail) throw new Error('Offline'); return { ok: true, json: async () => fixture() }; },
  };
  try {
    for (const [name, value] of Object.entries(replacements)) Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
    await import('../docs/assets/download.mjs?test=' + Math.random());
    // initialize() waits for platform hints and then the release response.
    for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve));
    const page = { nodes, panels, formats, buttons, alternatives };
    if (exercise) exercise(page);
    return page;
  } finally {
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
}
test('explicit download entry auto-starts the matching latest build exactly once', async () => {
  const { nodes } = await runPage({ platform: { platform: 'macOS', architecture: 'arm', bitness: '64' }, search: '?start=1' });
  assert.equal(nodes.get('#download-action').clicks, 1);
  assert.match(nodes.get('#download-action').href, /v0\.3\.5\/Skiller-0\.3\.5-macos-arm64\.dmg$/);
  assert.match(nodes.get('#download-status').textContent, /Download requested/);
});
test('direct visits, unknown Mac chips and API errors never auto-start a download', async () => {
  const direct = await runPage({ platform: { platform: 'Windows', architecture: 'x86', bitness: '64' } });
  assert.equal(direct.nodes.get('#download-action').clicks, 0);
  assert.equal(direct.nodes.get('#download-action').hidden, false);
  const unknown = await runPage({ platform: { platform: 'MacIntel' }, search: '?start=1', deniedHints: true });
  assert.equal(unknown.nodes.get('#download-variant').value, 'mac-arm64');
  assert.deepEqual(unknown.nodes.get('#download-variant').options.map(o => o.value), ['mac-arm64', 'mac-x64']);
  assert.equal(unknown.nodes.get('#download-action').clicks, 0);
  const offline = await runPage({ platform: { platform: 'Windows', architecture: 'x86', bitness: '64' }, search: '?start=1', fail: true });
  assert.equal(offline.nodes.get('#download-action').clicks, 0);
  assert.equal(offline.nodes.get('#download-action').hidden, true);
  assert.equal(offline.nodes.get('#download-retry').hidden, false);
  assert.equal(offline.nodes.get('#release-link').href, 'https://github.com/beautyfree/skiller/releases/latest');
});

test('platform tabs and alternate builds update the installer and installation guide', async () => {
  await runPage({ platform: { platform: 'macOS', architecture: 'arm', bitness: '64' }, exercise: page => {
  page.buttons.find(b => b.dataset.platform === 'windows').handlers.click();
  assert.equal(page.nodes.get('#download-variant').hidden, true);
  assert.equal(page.nodes.get('#download-single-build').hidden, false);
  assert.equal(page.nodes.get('#download-single-build').textContent, 'Windows · Intel / AMD 64-bit');
  assert.match(page.nodes.get('#download-action').href, /win-x64.exe$/);
  assert.equal(page.buttons.find(b => b.dataset.platform === 'windows').attributes['aria-pressed'], 'true');
  assert.equal(page.panels.find(p => p.dataset.install === 'windows').hidden, false);
  page.alternatives.find(b => b.dataset.build === 'linux-deb').handlers.click();
  assert.match(page.nodes.get('#download-action').href, /linux-amd64.deb$/);
  assert.equal(page.formats.find(p => p.dataset.linuxFormat === 'linux-deb').hidden, false);
  page.buttons.find(b => b.dataset.platform === 'mac').handlers.click();
  assert.equal(page.nodes.get('#download-variant').value, 'mac-arm64');
  assert.equal(page.nodes.get('#download-variant').hidden, false);
  assert.equal(page.nodes.get('#download-single-build').hidden, true);
  assert.equal(page.nodes.get('#download-action').hidden, false);
  assert.equal(page.nodes.get('#download-guidance').hidden, false);
  } });
});
