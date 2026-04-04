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
    'main [class*="message"]',
  ];

  for (const selector of selectors) {
    const nodes = Array.from(document.querySelectorAll(selector))
      .filter((n) => (n.textContent || '').trim().length > 0);
    if (nodes.length) return { nodes, selector };
  }

  return { nodes: [], selector: null };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    .slice(0, 100);
}

function chatIdFromHref(href, fallbackTitle = '') {
  const normalized = normalizeHref(href);
  const match = normalized.match(/\/c\/([^/?#]+)/);
  if (match?.[1]) return `chat-${match[1]}`;
  return `chat-${sanitizeId(fallbackTitle || normalized)}`;
}

function projectIdFromHref(href, fallbackTitle = '') {
  const normalized = normalizeHref(href);
  const match = normalized.match(/\/g\/([^/?#]+)/);
  if (match?.[1]) return `project-${match[1]}`;
  return `project-${sanitizeId(fallbackTitle || normalized)}`;
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

function isIgnoredProjectTitle(title) {
  const value = String(title || '').trim().toLowerCase();
  return !value || value === 'more' || value === 'new project';
}

function getCurrentChatIdFromUrl() {
  const match = location.pathname.match(/\/c\/([^/?#]+)/);
  return match?.[1] || null;
}

function getCurrentProjectIdFromUrl() {
  const match = location.pathname.match(/\/g\/([^/?#]+)/);
  return match?.[1] || null;
}

function isProjectPage() {
  return /\/project(?:[/?#]|$)/.test(location.pathname);
}

function getProjectsHeading() {
  return Array.from(document.querySelectorAll('h2')).find(
    (node) => textFromNode(node).toLowerCase() === 'projects',
  ) || null;
}

function getProjectsSection() {
  const heading = getProjectsHeading();
  if (!heading) return null;
  return heading.closest('.group\\/sidebar-expando-section, .group/sidebar-expando-section') || heading.closest('div');
}

function getVisibleProjectAnchors() {
  const section = getProjectsSection();
  if (!section) return [];

  const anchors = Array.from(
    section.querySelectorAll('ul > li > a[href*="/g/g-p-"][href$="/project"]'),
  );

  return uniqueBy(
    anchors
      .map((anchor) => {
        const titleNode = Array.from(anchor.querySelectorAll('div.truncate')).find((el) => {
          const title = (el.getAttribute('title') || textFromNode(el)).trim();
          return title && !isIgnoredProjectTitle(title);
        });

        const name = (titleNode?.getAttribute('title') || textFromNode(titleNode) || '').trim();
        const href = normalizeHref(anchor.getAttribute('href') || '');

        return name
          ? {
              anchor,
              id: projectIdFromHref(href, name),
              name,
              href,
            }
          : null;
      })
      .filter(Boolean),
    (project) => project.href || project.id || project.name,
  );
}

function getMoreProjectsTrigger() {
  const section = getProjectsSection();
  if (!section) return null;

  return Array.from(section.querySelectorAll('li')).find((li) => {
    const text = textFromNode(li.querySelector('div.truncate') || li);
    return text.toLowerCase() === 'more';
  }) || null;
}

function visiblePopoverWrapper() {
  const wrappers = Array.from(document.querySelectorAll('[data-radix-popper-content-wrapper]'));
  return wrappers.reverse().find((node) => {
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }) || null;
}

async function discoverProjectsFromMorePopover() {
  const item = getMoreProjectsTrigger();
  if (!item) return [];

  const clickable =
    item.querySelector('[aria-haspopup="menu"], button, [role="button"], a') ||
    item;

  clickable.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  await sleep(500);

  const wrapper = visiblePopoverWrapper();
  if (!wrapper) return [];

  const anchors = Array.from(wrapper.querySelectorAll('a[href*="/g/g-p-"][href$="/project"]'));
  const projects = uniqueBy(
    anchors
      .map((a) => {
        const truncate = a.querySelector('div.truncate');
        const name = (truncate?.getAttribute('title') || textFromNode(truncate) || textFromNode(a)).trim();
        const href = normalizeHref(a.getAttribute('href') || '');
        if (!name || isIgnoredProjectTitle(name) || !href) return null;
        return {
          id: projectIdFromHref(href, name),
          name,
          href,
        };
      })
      .filter(Boolean),
    (project) => project.href || project.id || project.name,
  );

  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  return projects;
}

async function discoverAllProjectsNav() {
  const warnings = [];

  const visibleProjects = getVisibleProjectAnchors().map((project) => ({
    id: project.id,
    name: project.name,
    href: project.href,
  }));

  let moreProjects = [];
  try {
    moreProjects = await discoverProjectsFromMorePopover();
    if (moreProjects.length) {
      warnings.push(`Loaded ${moreProjects.length} additional project(s) from More`);
    }
  } catch (error) {
    warnings.push(`Could not load More projects: ${error?.message || String(error)}`);
  }

  const projects = uniqueBy(
    [...visibleProjects, ...moreProjects].filter((project) => project.name && !isIgnoredProjectTitle(project.name)),
    (project) => project.href || project.id || project.name,
  );

  if (!projects.length) warnings.push('No projects found under the Projects section');

  return {
    detectedAt: new Date().toISOString(),
    mode: 'all-projects',
    warnings,
    projects,
  };
}

function findScrollableAncestor(node) {
  let current = node;
  while (current && current !== document.body) {
    const style = window.getComputedStyle(current);
    const overflowY = style.overflowY || style.overflow;
    if (/(auto|scroll)/.test(overflowY) && current.scrollHeight > current.clientHeight) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

function getLoadedProjectPageName() {
  const h1 = document.querySelector('main h1');
  if (h1 && textFromNode(h1)) return textFromNode(h1);

  const activeSidebarProject = getVisibleProjectAnchors().find((project) => {
    const currentProjectId = getCurrentProjectIdFromUrl();
    return currentProjectId && project.href.includes(`/g/${currentProjectId}/project`);
  });

  return activeSidebarProject?.name || null;
}

function getLoadedProjectPagePanel() {
  return document.querySelector('main [role="tabpanel"]:not([hidden])');
}

function extractChatTitleFromProjectPageAnchor(anchor) {
  const specific =
    anchor.querySelector('.text-sm.font-medium') ||
    anchor.querySelector('[class*="font-medium"]') ||
    anchor.querySelector('.truncate') ||
    anchor;
  return textFromNode(specific) || anchor.getAttribute('aria-label') || 'Untitled Chat';
}

function getLoadedProjectPageChatsOnce(projectId, projectName) {
  const panel = getLoadedProjectPagePanel();
  if (!panel) return [];

  const anchors = Array.from(panel.querySelectorAll('a[href*="/c/"]'));
  return uniqueBy(
    anchors.map((a) => ({
      id: chatIdFromHref(a.getAttribute('href') || '', extractChatTitleFromProjectPageAnchor(a)),
      title: extractChatTitleFromProjectPageAnchor(a),
      href: normalizeHref(a.getAttribute('href') || ''),
      projectId,
      projectName,
    })),
    (chat) => chat.id,
  );
}

async function forceLoadAllProjectPageChats(projectId, projectName) {
  const panel = getLoadedProjectPagePanel();
  const scrollRoot = document.querySelector('[data-scroll-root]');
  const scrollers = [panel, findScrollableAncestor(panel), scrollRoot, document.scrollingElement || document.documentElement]
    .filter(Boolean);

  let lastCount = -1;
  let stablePasses = 0;

  for (let pass = 0; pass < 20; pass++) {
    const chats = getLoadedProjectPageChatsOnce(projectId, projectName);
    const count = chats.length;

    if (count === lastCount) stablePasses += 1;
    else {
      stablePasses = 0;
      lastCount = count;
    }

    const lastAnchor = panel?.querySelector('li:last-child a[href*="/c/"]');
    if (lastAnchor) {
      lastAnchor.scrollIntoView({ block: 'nearest' });
    } else {
      panel?.scrollIntoView({ block: 'nearest' });
    }

    for (const scroller of scrollers) {
      if (!scroller) continue;
      scroller.scrollTop = scroller.scrollHeight;
      scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
    }

    await sleep(500);

    if (stablePasses >= 3) {
      return getLoadedProjectPageChatsOnce(projectId, projectName);
    }
  }

  return getLoadedProjectPageChatsOnce(projectId, projectName);
}

async function scanLoadedProjectPageNav() {
  const warnings = [];
  const projectName = getLoadedProjectPageName();
  const projectId = projectIdFromHref(location.pathname, projectName || '');
  const chats = await forceLoadAllProjectPageChats(projectId, projectName);

  if (!projectName) warnings.push('Could not extract loaded project page title');
  if (!chats.length) warnings.push('No chats found in the loaded project page');

  return {
    detectedAt: new Date().toISOString(),
    mode: 'loaded-project-page',
    warnings,
    projects: projectName
      ? [{
          id: projectId,
          name: projectName,
          href: normalizeHref(location.href),
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

function getExpandedProjectLiForCurrentChat() {
  const currentChatId = getCurrentChatIdFromUrl();
  if (!currentChatId) return null;

  const section = getProjectsSection();
  if (!section) return null;

  return Array.from(section.querySelectorAll('ul > li')).find((li) => {
    const hasCurrentChat = Boolean(li.querySelector(`a[href*="/c/${currentChatId}"]`));
    const hasActiveProject = Boolean(li.querySelector(`a[href*="/g/g-p-"][href$="/project"][data-active]`));
    return hasCurrentChat || hasActiveProject;
  }) || null;
}

function scanCurrentProjectFromChatPageNav() {
  const warnings = [];
  const li = getExpandedProjectLiForCurrentChat();

  if (!li) {
    return {
      detectedAt: new Date().toISOString(),
      mode: 'current-project',
      warnings: ['Could not find an expanded current project in the sidebar'],
      projects: [],
      chats: [],
      ungroupedChats: [],
    };
  }

  const projectAnchor = li.querySelector(`a[href*="/g/g-p-"][href$="/project"]`);
  const projectName = projectAnchor
    ? textFromNode(projectAnchor.querySelector('div.truncate')) || textFromNode(projectAnchor)
    : null;
  const projectHref = projectAnchor ? normalizeHref(projectAnchor.getAttribute('href') || '') : '';
  const projectId = projectIdFromHref(projectHref, projectName || '');

  const chats = uniqueBy(
    Array.from(li.querySelectorAll('a[href*="/c/"]')).map((a) => ({
      id: chatIdFromHref(a.getAttribute('href') || '', textFromNode(a.querySelector('div.truncate') || a)),
      title: textFromNode(a.querySelector('div.truncate') || a) || 'Untitled Chat',
      href: normalizeHref(a.getAttribute('href') || ''),
      projectId,
      projectName,
    })),
    (chat) => chat.id,
  );

  if (!projectName) warnings.push('Could not extract current project title from sidebar');
  if (!chats.length) warnings.push('No chats found inside the expanded current project sidebar item');

  return {
    detectedAt: new Date().toISOString(),
    mode: 'current-project',
    warnings,
    projects: projectName
      ? [{
          id: projectId,
          name: projectName,
          href: projectHref,
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

async function scanCurrentProjectNav() {
  if (isProjectPage()) {
    return await scanLoadedProjectPageNav();
  }
  return scanCurrentProjectFromChatPageNav();
}

function scanStandaloneChatsNav() {
  const warnings = [];
  const projectAnchors = getVisibleProjectAnchors();
  const projectChatHrefSet = new Set();

  const expandedProjectLis = Array.from((getProjectsSection() || document).querySelectorAll('ul > li'));
  for (const li of expandedProjectLis) {
    for (const a of li.querySelectorAll('a[href*="/c/"]')) {
      projectChatHrefSet.add(normalizeHref(a.getAttribute('href') || ''));
    }
  }

  const allAnchors = uniqueBy(
    Array.from(document.querySelectorAll('a[href*="/c/"]')),
    (a) => normalizeHref(a.getAttribute('href') || ''),
  );

  const standaloneAnchors = allAnchors.filter((a) => {
    const href = normalizeHref(a.getAttribute('href') || '');
    if (!href.includes('/c/')) return false;
    if (projectChatHrefSet.has(href)) return false;
    const text = textFromNode(a.querySelector('div.truncate') || a);
    return Boolean(text);
  });

  const chats = uniqueBy(
    standaloneAnchors.map((a) => {
      const title = textFromNode(a.querySelector('div.truncate') || a) || 'Untitled Chat';
      return {
        id: chatIdFromHref(a.getAttribute('href') || '', title),
        title,
        href: normalizeHref(a.getAttribute('href') || ''),
        projectId: null,
        projectName: null,
      };
    }),
    (chat) => chat.id,
  );

  if (!projectAnchors.length) warnings.push('Projects section not found while scanning standalone chats');
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

function extractChatPayload() {
  const projectName = isProjectPage() ? getLoadedProjectPageName() : null;
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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (message.type === 'ping') return sendResponse({ ok: true });
    if (message.type === 'extract-chat') return sendResponse(extractChatPayload());
    if (message.type === 'scan-current-project-nav') return sendResponse(await scanCurrentProjectNav());
    if (message.type === 'scan-loaded-project-page-nav') return sendResponse(await scanLoadedProjectPageNav());
    if (message.type === 'scan-standalone-nav') return sendResponse(scanStandaloneChatsNav());
    if (message.type === 'discover-all-projects-nav') return sendResponse(await discoverAllProjectsNav());
    return sendResponse({ ok: false, error: 'Unknown content-script message type' });
  })();
  return true;
});
