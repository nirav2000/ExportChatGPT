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

function gatherAllChatLinks() {
  const selectors = [
    'aside a[href*="/c/"]',
    'nav a[href*="/c/"]',
    '[role="navigation"] a[href*="/c/"]',
    'a[href*="/c/"]'
  ];

  const links = [];
  for (const selector of selectors) {
    for (const a of document.querySelectorAll(selector)) {
      if (a instanceof HTMLAnchorElement) links.push(a);
    }
  }

  return uniqueBy(
    links
      .map((a) => ({
        title: (a.textContent || '').trim() || 'Untitled Chat',
        href: normalizeHref(a.getAttribute('href') || ''),
        element: a,
      }))
      .filter((c) => c.href.includes('/c/')),
    (c) => `${c.href}|${c.title}`
  );
}

function scanCurrentProjectNav() {
  const projectName = currentProjectName();
  const projectId = projectName ? `project-${sanitizeId(projectName)}` : null;
  const warnings = [];
  const allChatLinks = gatherAllChatLinks();

  const grouped = [];
  const ungrouped = [];

  for (const chat of allChatLinks) {
    const text = (chat.element.closest('li,div,section')?.textContent || '').trim();
    const label = text || chat.title;

    const hasProjectSignal =
      !!projectName &&
      label.includes(projectName);

    if (hasProjectSignal) {
      grouped.push({
        id: `chat-${sanitizeId(chat.title || chat.href)}`,
        title: chat.title,
        href: chat.href,
        projectId,
        projectName,
      });
    } else {
      ungrouped.push({
        id: `chat-${sanitizeId(chat.title || chat.href)}`,
        title: chat.title,
        href: chat.href,
        projectId: null,
        projectName: null,
      });
    }
  }

  let finalGrouped = grouped;
  let finalUngrouped = ungrouped;

  if (!finalGrouped.length && projectName) {
    const selectedContainer = document.querySelector('aside, nav, [role="navigation"]');
    const nearbyLinks = selectedContainer
      ? uniqueBy(
          Array.from(selectedContainer.querySelectorAll('a[href*="/c/"]')).map((a) => ({
            id: `chat-${sanitizeId(a.textContent?.trim() || a.getAttribute('href') || '')}`,
            title: (a.textContent || '').trim() || 'Untitled Chat',
            href: normalizeHref(a.getAttribute('href') || ''),
            projectId,
            projectName,
          })),
          (c) => `${c.href}|${c.title}`
        )
      : [];

    if (nearbyLinks.length) {
      finalGrouped = nearbyLinks;
      finalUngrouped = allChatLinks
        .filter((c) => !nearbyLinks.some((g) => g.href === c.href))
        .map((c) => ({
          id: `chat-${sanitizeId(c.title || c.href)}`,
          title: c.title,
          href: c.href,
          projectId: null,
          projectName: null,
        }));
      warnings.push('Used sidebar-local fallback grouping for current project');
    }
  }

  if (!projectName) warnings.push('Could not confidently identify current project name');
  if (!finalGrouped.length) warnings.push('No chats were confidently linked to the current project');
  if (!allChatLinks.length) warnings.push('No chat links found in visible DOM');

  return {
    detectedAt: new Date().toISOString(),
    projects: projectName
      ? [{
          id: projectId,
          name: projectName,
          chats: finalGrouped.map((c) => ({
            id: c.id,
            title: c.title,
            href: c.href,
          })),
        }]
      : [],
    chats: finalGrouped,
    ungroupedChats: finalUngrouped,
    warnings,
    mode: 'current-project',
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'ping') return sendResponse({ ok: true });
  if (message.type === 'extract-chat') return sendResponse(extractChatPayload());
  if (message.type === 'scan-current-project-nav') return sendResponse(scanCurrentProjectNav());
});
