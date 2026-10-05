export const RELEASES_URL = 'https://github.com/beautyfree/skiller/releases/latest';
export const RELEASE_API = 'https://api.github.com/repos/beautyfree/skiller/releases/latest';

export const VARIANTS = {
  'mac-arm64': { os: 'mac', label: 'Apple silicon · M1 and later', extension: 'DMG', suffix: 'macos-arm64.dmg' },
  'mac-x64': { os: 'mac', label: 'Intel Mac', extension: 'DMG', suffix: 'macos-x64.dmg' },
  'windows-x64': { os: 'windows', label: 'Windows · Intel / AMD 64-bit', extension: 'EXE', suffix: 'win-x64.exe' },
  'linux-appimage': { os: 'linux', label: 'AppImage · Intel / AMD 64-bit', extension: 'AppImage', suffix: 'x86_64.AppImage' },
  'linux-deb': { os: 'linux', label: 'Debian / Ubuntu · Intel / AMD 64-bit', extension: 'DEB', suffix: 'linux-amd64.deb' },
  'linux-tar': { os: 'linux', label: 'Tar archive · Intel / AMD 64-bit', extension: 'TAR.XZ', suffix: 'linux-x64.tar.xz' },
};

// A Mac user agent often says Intel even on Apple silicon: never infer its chip from that string.
export function detectPlatform({ userAgent = '', platform = '', mobile = false, architecture = '', bitness = '' } = {}) {
  if (mobile || /Android|iPhone|iPad|iPod/i.test(userAgent) || platform === 'iOS') return { os: '', variant: '', mobile: true };
  const value = platform + ' ' + userAgent;
  const os = /mac/i.test(value) ? 'mac' : /windows|win32|win64/i.test(value) ? 'windows' : /linux/i.test(value) ? 'linux' : '';
  const arm = /arm|aarch64/i.test(architecture);
  const x64 = /x86|x64|amd64/i.test(architecture) && bitness === '64';
  if (os === 'mac') return { os, variant: arm ? 'mac-arm64' : x64 ? 'mac-x64' : '' };
  if (arm || bitness === '32') return { os, variant: '', unsupported: true };
  const knownX64 = x64 || (!architecture && /x86_64|Win64|WOW64|amd64/i.test(userAgent));
  return { os, variant: knownX64 ? (os === 'windows' ? 'windows-x64' : os === 'linux' ? 'linux-appimage' : '') : '' };
}

export function resolveRelease(release) {
  if (!release || release.draft || release.prerelease || !/^v?\d+\.\d+\.\d+$/.test(release.tag_name) || !Array.isArray(release.assets)) {
    throw new Error('No valid stable release');
  }
  const tag = release.tag_name;
  const version = tag.replace(/^v/, '');
  const assets = {};
  for (const [key, variant] of Object.entries(VARIANTS)) {
    const names = ['Skiller-' + version + '-' + variant.suffix];
    if (key === 'linux-appimage') names.push('Skiller-' + version + '-linux-x86_64.AppImage');
    const found = release.assets.filter(a => names.includes(a.name) && a.state === 'uploaded');
    if (found.length !== 1) continue;
    const a = found[0];
    const expected = 'https://github.com/beautyfree/skiller/releases/download/' + tag + '/' + a.name;
    if (a.browser_download_url !== expected || !Number.isSafeInteger(a.size) || a.size <= 0) continue;
    assets[key] = { name: a.name, url: expected, size: a.size };
  }
  if (!Object.keys(assets).length) throw new Error('No supported installers in this release');
  return { tag, version, url: 'https://github.com/beautyfree/skiller/releases/tag/' + tag, assets };
}
