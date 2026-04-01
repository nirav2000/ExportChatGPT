const statusEl = document.getElementById('status');
document.getElementById('scan')?.addEventListener('click', async () => {
  statusEl.textContent = 'scanning';
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  const result = await chrome.tabs.sendMessage(tab.id, { type: 'extract-chat' });
  await chrome.storage.local.set({ lastCapture: result });
  statusEl.textContent = result?.messages?.length ? 'complete' : 'partial';
});
