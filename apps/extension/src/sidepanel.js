const resultEl = document.getElementById('result');
const captureStateEl = document.getElementById('captureState');
const eligibilityEl = document.getElementById('eligibility');
const permissionEl = document.getElementById('permission');

async function updatePermissionState() {
  const granted = await chrome.permissions.contains({ origins: ['https://chatgpt.com/*', 'https://chat.openai.com/*'] });
  permissionEl.textContent = granted ? 'permission: granted' : 'permission: missing';
}

async function updateEligibility() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const ok = Boolean(tab?.url?.startsWith('https://chatgpt.com/') || tab?.url?.startsWith('https://chat.openai.com/'));
  eligibilityEl.textContent = ok ? 'ready' : 'not-chatgpt';
}

function setState(state) {
  captureStateEl.textContent = state;
  captureStateEl.className = `chip ${state}`;
}

async function doCapture() {
  setState('capturing');
  const response = await chrome.runtime.sendMessage({ type: 'capture-current-chat' });
  if (!response?.ok) {
    setState('failed');
    resultEl.textContent = `Capture failed: ${response?.error || 'Unknown error'}`;
    return;
  }
  setState('complete');
  resultEl.textContent = JSON.stringify(response.bundle, null, 2);
}

async function doExport() {
  setState('downloading');
  const response = await chrome.runtime.sendMessage({ type: 'download-last-bundle' });
  setState(response?.ok ? 'complete' : 'failed');
}

document.getElementById('requestPerm')?.addEventListener('click', async () => {
  const granted = await chrome.permissions.request({ origins: ['https://chatgpt.com/*', 'https://chat.openai.com/*'] });
  resultEl.textContent = granted ? 'Permission granted.' : 'Permission denied.';
  await updatePermissionState();
});

document.getElementById('scan')?.addEventListener('click', doCapture);
document.getElementById('exportChat')?.addEventListener('click', doExport);
document.getElementById('exportProject')?.addEventListener('click', doExport);
document.getElementById('exportAll')?.addEventListener('click', doExport);
document.getElementById('rescan')?.addEventListener('click', doCapture);

updatePermissionState();
updateEligibility();
setState('ready');
