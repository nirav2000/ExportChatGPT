chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'capture-current-chat') {
    sendResponse({ ok: true, status: 'capturing' });
  }
});
