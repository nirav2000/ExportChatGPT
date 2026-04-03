function inferRole(node) {
  const explicit = node.getAttribute('data-message-author-role');
  if (explicit) return explicit;

  const roleHost = node.closest('[data-message-author-role]');
  if (roleHost) return roleHost.getAttribute('data-message-author-role') || 'unknown';

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

function pickMessageNodes() {
  const selectors = [
    '[data-message-author-role]',
    'main article',
    'main [role="article"]',
    'main .markdown',
    'main [class*="message"]'
  ];

  for (const selector of selectors) {
    const nodes = Array.from(document.querySelectorAll(selector))
      .filter((n) => (n.textContent || '').trim().length > 0);
    if (nodes.length) return { nodes, selector };
  }

  return { nodes: [], selector: null };
}

function normalizeHref(href) {
  try {
    return new URL(href, location.origin).toString();
  } catch {
    return href || '';
  }
}

function sanitizeId(input) {
  return String(input || 'untitled')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function chatIdFromHref(href, fallbackTitle = '') {
  const normalized = normalizeHref(href);
  const match = normalized.match(/\/c\/([^/?#]+)/);
  if (match?.[1]) return `chat-${match[1]}`;
  return `chat-${sanitizeId(fallbackTitle || normalized)}`;
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = keyFn(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function currentProjectName() {
  const selected = document.querySelector('nav [aria-current="page"], aside [aria-current="page"]');
  if (selected?.textContent?.trim()) return selected.textContent.trim();

  const heading = Array.from(document.querySelectorAll('h1,h2,h3,[data-project-name]'))
    .map((el) => el.textContent?.trim() || '')
    .find((text) => text && text.length < 120);
  if (heading) return heading;

  return null;
}

function activeChatAnchor() {
  const direct = document.querySelector('a[href*="/c/"][aria-current="page"]');
  if (direct instanceof HTMLAnchorElement) return direct;

  const currentNode = document.querySelector('[aria-current="page"]');
  if (currentNode instanceof HTMLElement) {
    const anchor = currentNode.closest('a[href*="/c/"]');
    if (anchor instanceof HTMLAnchorElement) return anchor;
    const nested = currentNode.querySelector('a[href*="/c/"]');
    if (nested instanceof HTMLAnchorElement) return nested;
  }

  const pathnameMatch = location.pathname.match(/\/c\/([^/?#]+)/);
  if (pathnameMatch?.[1]) {
    const exact = document.querySelector(`a[href*="/c/${pathnameMatch[1]}"]`);
    if (exact instanceof HTMLAnchorElement) return exact;
  }

  return null;
}

function visibleChatLinks(root = document) {
  const selectors = [
    'aside a[href*="/c/"]',
    'nav a[href*="/c/"]',
    '[role="navigation"] a[href*="/c/"]',
    'a[href*="/c/"]'
  ];

  const links = [];
  for (const selector of selectors) {
    for (const a of root.querySelectorAll(selector)) {
      if (a instanceof HTMLAnchorElement) links.push(a);
    }
  }

  return uniqueBy(
    links
      .filter((a) => normalizeHref(a.getAttribute('href') || '').includes('/c/'))
      .filter((a) => (a.textContent || '').trim().length > 0),
    (a) => normalizeHref(a.getAttribute('href') || '')
  );
}

function findChatGroupContainer(anchor) {
  if (!(anchor instanceof HTMLAnchorElement)) return null;

  const navRoot =
    anchor.closest('aside, nav, [role="navigation"]') ||
    document.querySelector('aside, nav, [role="navigation"]');

  let node = anchor.parentElement;
  let best = null;

  while (node) {
    const links = Array.from(node.querySelectorAll('a[href*="/c/"]'));
    if (links.some((link) => link === anchor) && links.length >= 1 && links.length <= 50) {
      best = node;
    }

    if (node === navRoot) break;
    node = node.parentElement;
  }

  return best || navRoot || anchor.parentElement || null;
}

function linkToChat(a, projectId = null, projectName = null) {
  return {
    id: chatIdFromHref(a.getAttribute('href') || '', (a.textContent || '').trim()),
    title: (a.textContent || '').trim() || 'Untitled Chat',
    href: normalizeHref(a.getAttribute('href') || ''),
    projectId,
    projectName,
  };
}

function extractChatPayload() {
  const projectName = currentProjectName();
  const title = document.title;
  const warnings = [];
  const messages = [];
  const assets = [];

  const { nodes, selector } = pickMessageNodes();

  if (!nodes.length) warnings.push('No message nodes found in main content');
  else warnings.push(`Message selector used: ${selector}`);

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

  return {
    title,
    projectName,
    messages,
    assets,
    attachments: [],
    warnings,
    fingerprint: `${messages.length}:${assets.length}`,
  };
}

function scanCurrentProjectNav() {
  const projectName = currentProjectName();
  const projectId = projectName ? `project-${sanitizeId(projectName)}` : null;
  const warnings = [];

  const activeAnchor = activeChatAnchor();
  const groupContainer = activeAnchor ? findChatGroupContainer(activeAnchor) : null;

  let links = groupContainer ? visibleChatLinks(groupContainer) : [];

  if (!links.length) {
    const navRoot =
      document.querySelector('aside, nav, [role="navigation"]') ||
      document;
    links = visibleChatLinks(navRoot).filter((a) => {
      const rowText = (a.closest('li,div,section,article')?.textContent || '').trim();
      return projectName ? rowText.includes(projectName) : false;
    });
    if (links.length) warnings.push('Used project-name fallback for current project scan');
  }

  const chats = uniqueBy(
    links.map((a) => linkToChat(a, projectId, projectName)),
    (c) => c.id
  );

  if (!projectName) warnings.push('Could not confidently identify current project name');
  if (!groupContainer) warnings.push('Could not isolate project container from current chat');
  if (!chats.length) warnings.push('No chats found for the current project');

  return {
    detectedAt: new Date().toISOString(),
    mode: 'current-project',
    warnings,
    projects: projectName
      ? [{
          id: projectId,
          name: projectName,
          chats: chats.map((c) => ({
            id: c.id,
            title: c.title,
            href: c.href,
          })),
        }]
      : [],
    chats,
    ungroupedChats: [],
  };
}

function scanStandaloneChatsNav() {
  const warnings = [];
  const activeAnchor = activeChatAnchor();
  const groupContainer = activeAnchor ? findChatGroupContainer(activeAnchor) : null;
  const navRoot =
    document.querySelector('aside, nav, [role="navigation"]') ||
    document;

  let links = visibleChatLinks(navRoot);

  if (groupContainer) {
    links = links.filter((a) => !groupContainer.contains(a));
    warnings.push('Excluded the currently open project container from standalone scan');
  }

  const chats = uniqueBy(
    links.map((a) => linkToChat(a, null, null)),
    (c) => c.id
  );

  if (!chats.length) warnings.push('No standalone chats found in the visible navigation');

  return {
    detectedAt: new Date().toISOString(),
    mode: 'standalone-chats',
    warnings,
    projects: [],
    chats: [],
    ungroupedChats: chats,
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'ping') return sendResponse({ ok: true });
  if (message.type === 'extract-chat') return sendResponse(extractChatPayload());
  if (message.type === 'scan-current-project-nav') return sendResponse(scanCurrentProjectNav());
  if (message.type === 'scan-standalone-nav') return sendResponse(scanStandaloneChatsNav());
});
