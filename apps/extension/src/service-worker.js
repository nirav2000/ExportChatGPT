async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function captureCurrentChat() {
  const tab = await getActiveTab();
  if (!tab?.id) {
    return { ok: false, error: 'No active tab found' };
  }
  const result = await chrome.tabs.sendMessage(tab.id, { type: 'extract-chat' });
  const bundle = {
    bundleVersion: 1,
    capturedAt: new Date().toISOString(),
    workspace: { id: 'default', name: 'Default Workspace', sourceType: 'live_capture' },
    projects: result.projectName
      ? [{ id: `project-${result.projectName}`, workspaceId: 'default', name: result.projectName, sourceType: 'live_capture' }]
      : [],
    chats: [{
      id: `chat-${Date.now()}`,
      workspaceId: 'default',
      projectId: result.projectName ? `project-${result.projectName}` : null,
      title: result.title || 'Untitled Chat',
      sourceType: 'live_capture',
      fingerprint: result.fingerprint || '',
      updatedAt: new Date().toISOString(),
    }],
    messages: result.messages,
    assets: result.assets,
    attachments: result.attachments,
    warnings: result.warnings || [],
  };
  await chrome.storage.local.set({ lastCapture: bundle });
  return { ok: true, bundle };
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
    if (message.type === 'download-last-bundle') return sendResponse(await downloadLastBundle());
    if (message.type === 'get-last-capture') {
      const data = await chrome.storage.local.get('lastCapture');
      return sendResponse({ ok: true, bundle: data.lastCapture || null });
    }
    return sendResponse({ ok: false, error: 'Unknown message type' });
  })();
  return true;
});
