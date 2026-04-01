async function sha256Hex(arrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-256', arrayBuffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function toBase64(arrayBuffer) {
  let binary = '';
  const bytes = new Uint8Array(arrayBuffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function resolveAssetBytes(asset) {
  try {
    if (!asset.originalUrl) return { ...asset, resolveStatus: 'missing-url' };
    if (asset.originalUrl.startsWith('data:')) {
      const [prefix, data] = asset.originalUrl.split(',');
      const mimeType = prefix.match(/^data:(.*?);base64$/)?.[1] || 'application/octet-stream';
      const binary = atob(data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const buf = bytes.buffer;
      return {
        ...asset,
        mimeType,
        sha256: await sha256Hex(buf),
        dataBase64: toBase64(buf),
        resolveStatus: 'resolved',
      };
    }

    const response = await fetch(asset.originalUrl, { credentials: 'include' });
    if (!response.ok) {
      return { ...asset, resolveStatus: `http-${response.status}` };
    }
    const buf = await response.arrayBuffer();
    return {
      ...asset,
      mimeType: response.headers.get('content-type') || asset.mimeType,
      sha256: await sha256Hex(buf),
      dataBase64: toBase64(buf),
      resolveStatus: 'resolved',
    };
  } catch (error) {
    return { ...asset, resolveStatus: `error:${error.message}` };
  }
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function createDedicatedExportTab() {
  return chrome.tabs.create({ url: 'https://chatgpt.com/', active: false });
}

async function captureFromTab(tabId) {
  const result = await chrome.tabs.sendMessage(tabId, { type: 'extract-chat' });
  const chatId = `chat-${Date.now()}`;
  const messages = (result.messages || []).map((m) => ({ ...m, chatId }));
  const assetsRaw = (result.assets || []).map((a, i) => ({ ...a, chatId, id: a.id || `${chatId}-asset-${i + 1}` }));
  const assets = [];
  for (const asset of assetsRaw) {
    assets.push(await resolveAssetBytes(asset));
  }

  return {
    bundleVersion: 1,
    capturedAt: new Date().toISOString(),
    workspace: { id: 'default', name: 'Default Workspace', sourceType: 'live_capture' },
    projects: result.projectName
      ? [{ id: `project-${result.projectName}`, workspaceId: 'default', name: result.projectName, sourceType: 'live_capture' }]
      : [],
    chats: [
      {
        id: chatId,
        workspaceId: 'default',
        projectId: result.projectName ? `project-${result.projectName}` : null,
        title: result.title || 'Untitled Chat',
        sourceType: 'live_capture',
        fingerprint: result.fingerprint || `${messages.length}:${assets.length}`,
        updatedAt: new Date().toISOString(),
      },
    ],
    messages,
    assets,
    attachments: result.attachments || [],
    warnings: result.warnings || [],
  };
}

async function captureCurrentChat() {
  const tab = await getActiveTab();
  if (!tab?.id) return { ok: false, error: 'No active tab found' };
  const bundle = await captureFromTab(tab.id);
  await chrome.storage.local.set({ lastCapture: bundle, captureState: 'complete' });
  return { ok: true, bundle };
}

async function scanWorkspaceInDedicatedTab() {
  const tab = await createDedicatedExportTab();
  await new Promise((r) => setTimeout(r, 2500));
  const res = await chrome.tabs.sendMessage(tab.id, { type: 'scan-workspace-nav' });
  await chrome.storage.local.set({ workspaceScan: res, captureState: 'scanning' });
  return { ok: true, scan: res, tabId: tab.id };
}

async function downloadLastBundle() {
  const { lastCapture } = await chrome.storage.local.get('lastCapture');
  if (!lastCapture) return { ok: false, error: 'No capture available' };
  const blob = new Blob([JSON.stringify(lastCapture, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  await chrome.downloads.download({ url, filename: `project-archivist/capture-${Date.now()}.json`, saveAs: true });
  return { ok: true };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (message.type === 'capture-current-chat') return sendResponse(await captureCurrentChat());
    if (message.type === 'scan-workspace') return sendResponse(await scanWorkspaceInDedicatedTab());
    if (message.type === 'download-last-bundle') return sendResponse(await downloadLastBundle());
    if (message.type === 'get-last-capture') {
      const data = await chrome.storage.local.get(['lastCapture', 'workspaceScan', 'captureState']);
      return sendResponse({ ok: true, ...data });
    }
    return sendResponse({ ok: false, error: 'Unknown message type' });
  })();
  return true;
});
