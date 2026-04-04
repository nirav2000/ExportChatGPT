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

function textFromNode(node) {
  return (node?.textContent || '').replace(/\s+/g, ' ').trim();
}

function getCurrentChatIdFromUrl() {
  const match = location.pathname.match(/\/c\/([^/?#]+)/);
  return match?.[1] || null;
}

function getProjectsHeading() {
  return Array.from(document.querySelectorAll('h2')).find(
    (node) => textFromNode(node).toLowerCase() === 'projects',
  ) || null;
}

function getProjectsScope() {
  const heading = getProjectsHeading();
  if (!heading) return null;

  let node = heading.parentElement;
  while (node) {
    if (node.querySelector('li')) return node;
    node = node.parentElement;
  }
  return heading.parentElement || null;
}

function getProjectTitleFromItem(item) {
  if (!item) return null;

  const candidates = Array.from(item.querySelectorAll('div.truncate')).filter((el) => {
    if (el.closest('a[href*="/c/"]')) return false;
    const title = el.getAttribute('title') || textFromNode(el);
    return Boolean(title && title.trim());
  });

  for (const candidate of candidates) {
    const title = (candidate.getAttribute('title') || textFromNode(candidate)).trim();
    if (title) return title;
  }

  return null;
}

function getProjectItems() {
  const scope = getProjectsScope();
  if (!scope) return [];

  const items = Array.from(scope.querySelectorAll('li')).filter((li) => {
    return Boolean(getProjectTitleFromItem(li) && li.querySelector('a[href*="/c/"] div.truncate'));
  });

  return uniqueBy(items, (li) => getProjectTitleFromItem(li) || String(Math.random()));
}

function getChatsFromProjectItem(item, projectId, projectName) {
  const anchors = Array.from(item.querySelectorAll('a[href*="/c/"]'));
  const chats = anchors.map((a) => {
    const truncate = a.querySelector('div.truncate');
    const title =
      truncate?.getAttribute('title') ||
      textFromNode(truncate) ||
      textFromNode(a) ||
      'Untitled Chat';

    return {
      id: chatIdFromHref(a.getAttribute('href') || '', title),
      title,
      href: normalizeHref(a.getAttribute('href') || ''),
      projectId,
      projectName,
    };
  });

  return uniqueBy(chats, (chat) => chat.id);
}

function getProjectNameFromLoadedChat() {
  const currentChatId = getCurrentChatIdFromUrl();
  if (!currentChatId) return null;

  for (const item of getProjectItems()) {
    const match = item.querySelector(`a[href*="/c/${currentChatId}"]`);
    if (match) {
      return getProjectTitleFromItem(item);
    }
  }

  return null;
}

function extractChatPayload() {
  const projectName = getProjectNameFromLoadedChat();
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
  const currentChatId = getCurrentChatIdFromUrl();
  const warnings = [];

  if (!currentChatId) {
    return {
      detectedAt: new Date().toISOString(),
      mode: 'current-project',
      warnings: ['Could not determine the current chat id from the URL'],
      projects: [],
      chats: [],
      ungroupedChats: [],
    };
  }

  const projectItems = getProjectItems();
  const matchedItem = projectItems.find((item) =>
    item.querySelector(`a[href*="/c/${currentChatId}"]`)
  );

  if (!matchedItem) {
    return {
      detectedAt: new Date().toISOString(),
      mode: 'current-project',
      warnings: ['Could not find the current chat inside a project group under the Projects heading'],
      projects: [],
      chats: [],
      ungroupedChats: [],
    };
  }

  const projectName = getProjectTitleFromItem(matchedItem);
  const projectId = projectName ? `project-${sanitizeId(projectName)}` : null;
  const chats = getChatsFromProjectItem(matchedItem, projectId, projectName);

  if (!projectName) warnings.push('Could not extract the project title from the project list item');
  if (!chats.length) warnings.push('No chats found inside the current project list item');

  return {
    detectedAt: new Date().toISOString(),
    mode: 'current-project',
    warnings,
    projects: projectName
      ? [{
          id: projectId,
          name: projectName,
          chats: chats.map((chat) => ({
            id: chat.id,
            title: chat.title,
            href: chat.href,
          })),
        }]
      : [],
    chats,
    ungroupedChats: [],
  };
}

function scanStandaloneChatsNav() {
  const warnings = [];
  const projectItems = getProjectItems();
  const projectAnchorSet = new Set(
    projectItems.flatMap((item) =>
      Array.from(item.querySelectorAll('a[href*="/c/"]')).map((a) => normalizeHref(a.getAttribute('href') || ''))
    )
  );

  const allAnchors = uniqueBy(
    Array.from(document.querySelectorAll('a[href*="/c/"]')),
    (a) => normalizeHref(a.getAttribute('href') || '')
  );

  const standaloneAnchors = allAnchors.filter((a) => {
    const href = normalizeHref(a.getAttribute('href') || '');
    if (!href.includes('/c/')) return false;
    if (projectAnchorSet.has(href)) return false;

    const truncate = a.querySelector('div.truncate');
    const title =
      truncate?.getAttribute('title') ||
      textFromNode(truncate) ||
      textFromNode(a);

    return Boolean(title);
  });

  const chats = uniqueBy(
    standaloneAnchors.map((a) => {
      const truncate = a.querySelector('div.truncate');
      const title =
        truncate?.getAttribute('title') ||
        textFromNode(truncate) ||
        textFromNode(a) ||
        'Untitled Chat';

      return {
        id: chatIdFromHref(a.getAttribute('href') || '', title),
        title,
        href: normalizeHref(a.getAttribute('href') || ''),
        projectId: null,
        projectName: null,
      };
    }),
    (chat) => chat.id
  );

  if (!chats.length) warnings.push('No standalone chats found outside the Projects section');

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
