import { RELEASE_API, RELEASES_URL, VARIANTS, detectPlatform, resolveRelease } from './download-release.mjs';

const osSelect = document.querySelector('#download-os');
const variantSelect = document.querySelector('#download-variant');
const singleBuild = document.querySelector('#download-single-build');
const action = document.querySelector('#download-action');
const status = document.querySelector('#download-status');
const detail = document.querySelector('#download-detail');
const guidance = document.querySelector('#download-guidance');
const retry = document.querySelector('#download-retry');
const releaseLink = document.querySelector('#release-link');
let release = null;
let platform = {};
let autoPending = new URLSearchParams(location.search).get('start') === '1';
let loading = true;

document.querySelector('#download-controls').hidden = false;
document.querySelector('#download-fallback').hidden = true;
document.querySelector('#download-alternatives').hidden = false;

function populateVariants(preferred = '') {
  const variants = Object.entries(VARIANTS).filter(([, variant]) => variant.os === osSelect.value);
  variantSelect.replaceChildren(...variants.map(([key, variant]) => new Option(variant.label, key)));
  variantSelect.value = variants.some(([key]) => key === preferred) ? preferred : variants[0]?.[0] || '';
  variantSelect.disabled = !osSelect.value;
  variantSelect.hidden = variants.length < 2;
  singleBuild.hidden = variants.length !== 1;
  singleBuild.textContent = variants.length === 1 ? variants[0][1].label : '';
}

function render() {
  for (const panel of document.querySelectorAll('[data-install]')) {
    panel.hidden = panel.dataset.install !== osSelect.value;
  }
  for (const button of document.querySelectorAll('[data-platform]')) button.setAttribute('aria-pressed', String(button.dataset.platform === osSelect.value));
  const key = variantSelect.value;
  const variant = VARIANTS[key];
  const asset = release?.assets[key];
  action.hidden = !asset;
  action.removeAttribute('href');
  retry.hidden = loading || !!release;
  releaseLink.href = release?.url || RELEASES_URL;
  releaseLink.textContent = release ? 'Release notes · v' + release.version : 'All releases on GitHub';
  if (loading) status.textContent = 'Checking the latest release…';
  else if (!release) status.textContent = 'We couldn’t check the latest release. Try again or download from GitHub.';
  else if (!osSelect.value) status.textContent = platform.mobile ? 'Skiller runs on desktop. Choose the computer you’ll install it on.' : 'Choose your operating system and build.';
  else if (!key) status.textContent = platform.unsupported && osSelect.value !== 'mac' ? 'This release supports Intel / AMD 64-bit on Windows and Linux. Choose a build for a supported computer.' : 'Choose the build for your computer.';
  else if (!asset) status.textContent = 'This build is not available in the latest release. Choose another format or view the release on GitHub.';
  else {
    action.href = asset.url;
    action.textContent = 'Download for ' + ({ mac: 'macOS', windows: 'Windows', linux: 'Linux' })[variant.os];
    status.textContent = 'Latest release · v' + release.version;
  }
  detail.textContent = asset ? variant.extension + ' · ' + (asset.size / 1024 / 1024).toFixed(1) + ' MB' : '';
  guidance.hidden = osSelect.value !== 'mac';
  for (const section of document.querySelectorAll('[data-linux-format]')) {
    section.hidden = key !== section.dataset.linuxFormat;
  }
  if (autoPending && !loading && asset) {
    autoPending = false;
    action.click();
    status.textContent = 'Download requested · v' + release.version + '. If it doesn’t start, use the button below.';
  }
}

async function loadRelease() {
  loading = true;
  release = null;
  render();
  try {
    const response = await fetch(RELEASE_API, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store', signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('Release unavailable');
    release = resolveRelease(await response.json());
  } catch {
    release = null;
  } finally {
    loading = false;
    render();
  }
}

function choosePlatform(os) {
  osSelect.value = os;
  autoPending = false;
  populateVariants(os === 'windows' ? 'windows-x64' : os === 'linux' ? 'linux-appimage' : '');
  render();
}
for (const button of document.querySelectorAll('[data-platform]')) button.addEventListener('click', () => choosePlatform(button.dataset.platform));
for (const button of document.querySelectorAll('[data-build]')) button.addEventListener('click', () => {
  autoPending = false;
  osSelect.value = VARIANTS[button.dataset.build].os;
  populateVariants(button.dataset.build);
  render();
});
osSelect.addEventListener('change', () => {
  autoPending = false;
  populateVariants('');
  render();
});
variantSelect.addEventListener('change', () => { autoPending = false; render(); });
retry.addEventListener('click', loadRelease);
action.addEventListener('click', () => {
  status.textContent = 'Download requested. If it doesn’t start, use the button again.';
});

async function initialize() {
  let hints = {};
  try {
    if (navigator.userAgentData?.getHighEntropyValues) {
      hints = await Promise.race([
        navigator.userAgentData.getHighEntropyValues(['architecture', 'bitness', 'platform']),
        new Promise(resolve => setTimeout(() => resolve({}), 1500)),
      ]);
    }
  } catch { /* Manual selection remains available. */ }
  platform = detectPlatform({ userAgent: navigator.userAgent, platform: hints.platform || navigator.userAgentData?.platform || navigator.platform,
    mobile: navigator.userAgentData?.mobile || (/Mac/.test(navigator.platform) && navigator.maxTouchPoints > 1),
    architecture: hints.architecture, bitness: hints.bitness });
  osSelect.value = platform.os;
  populateVariants(platform.variant);
  // Only a positively identified desktop build may start automatically.
  if (!platform.variant) autoPending = false;
  render();
  await loadRelease();
}
initialize();
