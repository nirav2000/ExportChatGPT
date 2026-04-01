function inferRole(node) {
  const explicit = node.getAttribute('data-message-author-role');
  if (explicit) return explicit;
  const txt = node.textContent?.toLowerCase() || '';
  if (txt.includes('you said')) return 'assistant';
  return 'unknown';
}

function extractAssets(messageId, root) {
  const assets = [];
  root.querySelectorAll('img').forEach((img, idx) => {
    const src = img.currentSrc || img.src || '';
    if (!src) return;
    assets.push({
      id: `${messageId}-asset-${idx + 1}`,
      chatId: 'pending-chat-id',
      messageId,
      sourceType: 'live_capture',
      fileName: `asset-${idx + 1}.bin`,
      sha256: '',
      originalUrl: src,
      alt: img.alt || '',
      width: img.naturalWidth || undefined,
      height: img.naturalHeight || undefined,
    });
  });
  return assets;
}

function extractChatPayload() {
  const projectName = document.querySelector('nav [aria-current="page"]')?.textContent?.trim() || null;
  const title = document.title;
  const warnings = [];
  const messages = [];
  const assets = [];

  const nodes = Array.from(document.querySelectorAll('main article'));
  if (!nodes.length) warnings.push('No message articles found in main content');

  nodes.forEach((node, i) => {
    const messageId = `msg-${i + 1}`;
    const text = node.textContent?.trim() || '';
    const role = inferRole(node);
    messages.push({
      id: messageId,
      chatId: 'pending-chat-id',
      role,
      sourceType: 'live_capture',
      blocks: text ? [{ type: 'paragraph', text }] : [{ type: 'unknown_html', html: node.innerHTML }],
      rawHtml: node.innerHTML,
      createdAt: new Date().toISOString(),
    });
    assets.push(...extractAssets(messageId, node));
  });

  return { title, projectName, messages, assets, attachments: [], warnings, fingerprint: `${messages.length}:${assets.length}` };
}

function scanWorkspaceNav() {
  const projects = [];
  const chats = [];

  const navLinks = Array.from(document.querySelectorAll('nav a'));
  navLinks.forEach((a) => {
    const href = a.getAttribute('href') || '';
    const label = a.textContent?.trim() || '';
    if (!label) return;

    if (href.includes('/g/') || a.closest('[data-project]')) {
      projects.push({ name: label, href });
    } else if (href.includes('/c/')) {
      chats.push({ title: label, href });
    }
  });

  return {
    detectedAt: new Date().toISOString(),
    projects,
    chats,
    warnings: navLinks.length ? [] : ['No nav links found for scanning'],
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'extract-chat') return sendResponse(extractChatPayload());
  if (message.type === 'scan-workspace-nav') return sendResponse(scanWorkspaceNav());
});
