chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'extract-chat') {
    const title = document.title;
    const messages = Array.from(document.querySelectorAll('main article')).map((el) => el.textContent?.trim()).filter(Boolean);
    sendResponse({ title, messages });
  }
});
