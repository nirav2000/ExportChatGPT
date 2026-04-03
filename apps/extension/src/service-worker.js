const STORAGE_KEYS = {
  currentProjectScan: 'currentProjectScan',
  captureState: 'captureState',
  progress: 'progress',
  lastWorkspaceExport: 'lastWorkspaceExport',
  selectedProjectIds: 'selectedProjectIds',
  selectedChatIds: 'selectedChatIds',
  manualGroups: 'manualGroups',
  exportedChatIds: 'exportedChatIds',
  capturedChatMeta: 'capturedChatMeta',
  cachedChatBundles: 'cachedChatBundles',
  groupUiState: 'groupUiState',
};

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

    let urlObj = null;
    try {
      urlObj = new URL(asset.originalUrl);
    } catch (_e) {}

    const isAllowedOrigin =
      !urlObj ||
      urlObj.origin === 'https://chatgpt.com' ||
      urlObj.origin === 'https://chat.openai.com' ||
      urlObj.origin.endsWith('.openai.com');

    if (!isAllowedOrigin) {
      return { ...asset, resolveStatus: 'skipped-third-party-origin' };
    }

    let credentials = 'omit';
    if (urlObj) {
      const isChatGPTOrigin =
        urlObj.origin === 'https://chatgpt.com' ||
        urlObj.origin === 'https://chat.openai.com' ||
        urlObj.origin.endsWith('.openai.com');
      credentials = isChatGPTOrigin ? 'include' : 'omit';
    }

    const response = await fetch(asset.originalUrl, { credentials });
    if (!response.ok) return { ...asset, resolveStatus: `http-${response.status}` };

    const buf = await response.arrayBuffer();
    return {
      ...asset,
      mimeType: response.headers.get('content-type') || asset.mimeType,
      sha256: await sha256Hex(buf),
      dataBase64: toBase64(buf),
      resolveStatus: 'resolved',
    };
  } catch (error) {
    const msg = String(error?.message || error || '');
    const resolveStatus = /cors|access-control-allow-origin|failed to fetch/i.test(msg)
      ? 'blocked-by-cors'
      : `error:${msg}`;
    return { ...asset, resolveStatus };
  }
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function ensureContentScript(tabId) {
  try {
    const pong = await chrome.tabs.sendMessage(tabId, { type: 'ping' });
    if (pong?.ok) return;
  } catch (_error) {}

  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['src/content-script.js'],
  });

  await new Promise((r) => setTimeout(r, 400));
}

function sanitizeId(input) {
  return String(input || 'untitled')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function sanitizeFilePart(input) {
  return String(input || 'untitled')
    .replace(/[<>:"/\\|?*]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

async function getStoredState() {
  const data = await chrome.storage.local.get(Object.values(STORAGE_KEYS));
  return {
    ...data,
    selectedChatIds: data.selectedChatIds || [],
    selectedProjectIds: data.selectedProjectIds || [],
    manualGroups: data.manualGroups || {},
    exportedChatIds: data.exportedChatIds || [],
    capturedChatMeta: data.capturedChatMeta || {},
    cachedChatBundles: data.cachedChatBundles || {},
    groupUiState: data.groupUiState || {},
  };
}

function buildProjectsFromChats(chats) {
  const projectMap = new Map();
  const ungroupedChats = [];

  for (const chat of chats) {
    if (!chat.projectId || !chat.projectName) {
      ungroupedChats.push({ ...chat, projectId: null, projectName: null });
      continue;
    }
    if (!projectMap.has(chat.projectId)) {
      projectMap.set(chat.projectId, {
        id: chat.projectId,
        name: chat.projectName,
        chats: [],
      });
    }
    projectMap.get(chat.projectId).chats.push({
      id: chat.id,
      title: chat.title,
      href: chat.href,
    });
  }

  const projects = Array.from(projectMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  for (const project of projects) {
    project.chats.sort((a, b) => a.title.localeCompare(b.title));
  }

  ungroupedChats.sort((a, b) => a.title.localeCompare(b.title));
  return { projects, ungroupedChats };
}

function applyManualGroupsToScan(scan, manualGroups) {
  const baseChats = [...(scan?.chats || []), ...(scan?.ungroupedChats || [])];
  const mergedChats = baseChats.map((chat) => {
    const manual = manualGroups[chat.id];
    if (!manual) return { ...chat, manualGroup: false };
    return {
      ...chat,
      projectId: manual.projectId,
      projectName: manual.projectName,
      manualGroup: true,
    };
  });

  const rebuilt = buildProjectsFromChats(mergedChats);
  return {
    detectedAt: scan?.detectedAt || new Date().toISOString(),
    mode: scan?.mode || 'current-project',
    warnings: scan?.warnings || [],
    chats: mergedChats.filter((c) => c.projectId && c.projectName),
    ungroupedChats: rebuilt.ungroupedChats,
    projects: rebuilt.projects,
  };
}

function mergeProjectScans(existingScan, newScan) {
  if (!existingScan) return newScan;
  if (!newScan) return existingScan;

  const projectMap = new Map();

  function upsertProject(project) {
    if (!project?.id) return;

    if (!projectMap.has(project.id)) {
      projectMap.set(project.id, {
        id: project.id,
        name: project.name,
        chats: [],
      });
    }

    const target = projectMap.get(project.id);
    if (project.name) target.name = project.name;

    const seen = new Set((target.chats || []).map((chat) => chat.id));
    for (const chat of project.chats || []) {
      if (!seen.has(chat.id)) {
        target.chats.push({ ...chat });
        seen.add(chat.id);
      }
    }

    target.chats.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  }

  for (const project of existingScan.projects || []) upsertProject(project);
  for (const project of newScan.projects || []) upsertProject(project);

  const projects = Array.from(projectMap.values()).sort((a, b) =>
    (a.name || '').localeCompare(b.name || '')
  );

  const groupedChatIds = new Set(
    projects.flatMap((project) => (project.chats || []).map((chat) => chat.id))
  );

  const ungroupedMap = new Map();

  function upsertUngrouped(chat) {
    if (!chat?.id || groupedChatIds.has(chat.id)) return;
    ungroupedMap.set(chat.id, { ...chat, projectId: null, projectName: null });
  }

  for (const chat of existingScan.ungroupedChats || []) upsertUngrouped(chat);
  for (const chat of newScan.ungroupedChats || []) upsertUngrouped(chat);

  const ungroupedChats = Array.from(ungroupedMap.values()).sort((a, b) =>
    (a.title || '').localeCompare(b.title || '')
  );

  const chats = projects.flatMap((project) =>
    (project.chats || []).map((chat) => ({
      ...chat,
      projectId: project.id,
      projectName: project.name,
    }))
  );

  return {
    detectedAt: newScan.detectedAt || new Date().toISOString(),
    mode: 'current-project',
    warnings: Array.from(new Set([...(existingScan.warnings || []), ...(newScan.warnings || [])])),
    chats,
    ungroupedChats,
    projects,
  };
}

async function captureFromTab(tabId, discovered = null) {
  await ensureContentScript(tabId);
  const result = await chrome.tabs.sendMessage(tabId, { type: 'extract-chat' });

  const chatId = discovered?.id || `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const inferredProjectName = discovered?.projectName || result?.projectName || null;
  const inferredProjectId = discovered?.projectId || (inferredProjectName ? `project-${sanitizeId(inferredProjectName)}` : null);

  const messages = (result?.messages || []).map((m) => ({ ...m, chatId }));
  const assetsRaw = (result?.assets || []).map((a, i) => ({
    ...a,
    chatId,
    id: a.id || `${chatId}-asset-${i + 1}`,
  }));

  const assets = [];
  for (const asset of assetsRaw) {
    assets.push(await resolveAssetBytes(asset));
  }

  return {
    bundleVersion: 1,
    capturedAt: new Date().toISOString(),
    workspace: { id: 'default', name: 'Default Workspace', sourceType: 'live_capture' },
    projects: inferredProjectName
      ? [{ id: inferredProjectId, workspaceId: 'default', name: inferredProjectName, sourceType: 'live_capture' }]
      : [],
    chats: [
      {
        id: chatId,
        workspaceId: 'default',
        projectId: inferredProjectId,
        title: discovered?.title || result?.title || 'Untitled Chat',
        sourceType: 'live_capture',
        fingerprint: result?.fingerprint || `${messages.length}:${assets.length}`,
        updatedAt: new Date().toISOString(),
      },
    ],
    messages,
    assets,
    attachments: result?.attachments || [],
    warnings: result?.warnings || [],
  };
}

async function captureWithRetry(tabId, chat, extraDelayMs = 9000) {
  let bundle = await captureFromTab(tabId, chat);
  if ((bundle.messages?.length || 0) > 0) return bundle;

  await new Promise((r) => setTimeout(r, extraDelayMs));
  bundle = await captureFromTab(tabId, chat);
  return bundle;
}

function alreadyCaptured(chat, capturedChatMeta, cachedChatBundles) {
  const meta = capturedChatMeta[chat.id];
  const hasMessages = typeof meta?.messageCount === 'number' && meta.messageCount > 0;
  const hasBundle = Boolean(cachedChatBundles[chat.id]);
  return hasMessages || hasBundle;
}

async function runScopedScan(rawMessageType, phaseLabel) {
  try {
    const tab = await getActiveTab();
    if (!tab?.id) return { ok: false, error: 'No active tab found' };

    await ensureContentScript(tab.id);
    const rawScan = await chrome.tabs.sendMessage(tab.id, { type: rawMessageType });

    const stored = await getStoredState();
    const prepared = applyManualGroupsToScan(rawScan, stored.manualGroups);
    const combinedScan = mergeProjectScans(stored.currentProjectScan, prepared);

    const scopedChats =
      rawMessageType === 'scan-current-project-nav'
        ? [...(prepared.chats || [])]
        : [...(prepared.ungroupedChats || [])];

    const selectedProjectIds =
      rawMessageType === 'scan-current-project-nav' && prepared.projects?.length
        ? [prepared.projects[0].id]
        : [];

    const capturedChatMeta = { ...(stored.capturedChatMeta || {}) };
    const cachedChatBundles = { ...(stored.cachedChatBundles || {}) };

    const chatsToCapture = scopedChats.filter((chat) => !alreadyCaptured(chat, capturedChatMeta, cachedChatBundles));

    const progress = {
      phase: phaseLabel,
      total: chatsToCapture.length,
      completed: 0,
      failed: 0,
      current: '',
      logs: [
        `Chats found in this scan: ${scopedChats.length}`,
        `Already captured: ${scopedChats.length - chatsToCapture.length}`,
        `To capture now: ${chatsToCapture.length}`,
      ],
    };

    await chrome.storage.local.set({
      [STORAGE_KEYS.captureState]: 'capturing',
      [STORAGE_KEYS.progress]: progress,
      [STORAGE_KEYS.currentProjectScan]: combinedScan,
      [STORAGE_KEYS.selectedProjectIds]: selectedProjectIds,
      [STORAGE_KEYS.selectedChatIds]: chatsToCapture.map((c) => c.id),
    });

    if (!chatsToCapture.length) {
      await chrome.storage.local.set({
        [STORAGE_KEYS.currentProjectScan]: combinedScan,
        [STORAGE_KEYS.captureState]: 'complete',
        [STORAGE_KEYS.progress]: {
          ...progress,
          phase: `${phaseLabel}-complete`,
          current: '',
          logs: [...progress.logs, 'All chats in this scan were already captured.'],
        },
        [STORAGE_KEYS.selectedProjectIds]: selectedProjectIds,
        [STORAGE_KEYS.selectedChatIds]: scopedChats
          .filter((c) => !stored.exportedChatIds.includes(c.id))
          .map((c) => c.id),
        [STORAGE_KEYS.capturedChatMeta]: capturedChatMeta,
        [STORAGE_KEYS.cachedChatBundles]: cachedChatBundles,
      });

      return { ok: true, scan: combinedScan, skippedAlreadyScanned: true };
    }

    for (let i = 0; i < chatsToCapture.length; i++) {
      const chat = chatsToCapture[i];
      const label = `${chat.projectName || 'Standalone'} / ${chat.title}`;
      progress.current = label;
      progress.logs.unshift(`Scanning ${i + 1}/${chatsToCapture.length}: ${label}`);
      progress.logs = progress.logs.slice(0, 60);
      await chrome.storage.local.set({ [STORAGE_KEYS.progress]: progress });

      try {
        await chrome.tabs.update(tab.id, { url: chat.href });
        await new Promise((r) => setTimeout(r, 4500));
        await ensureContentScript(tab.id);

        let bundle = await captureFromTab(tab.id, chat);
        if ((bundle.messages?.length || 0) === 0) {
          progress.logs.unshift(`Retrying zero-message page with longer wait: ${label}`);
          progress.logs = progress.logs.slice(0, 60);
          await chrome.storage.local.set({ [STORAGE_KEYS.progress]: progress });
          bundle = await captureWithRetry(tab.id, chat, 9000);
        }

        const messageCount = bundle.messages?.length || 0;
        const assetCount = bundle.assets?.length || 0;

        capturedChatMeta[chat.id] = {
          messageCount,
          assetCount,
          capturedAt: new Date().toISOString(),
          changed: true,
        };
        cachedChatBundles[chat.id] = bundle;

        progress.completed += 1;
        progress.logs.unshift(`✅ ${label} [${messageCount} msgs]`);
      } catch (error) {
        progress.failed += 1;
        progress.logs.unshift(`❌ ${label}: ${error.message || String(error)}`);
      }

      progress.logs = progress.logs.slice(0, 60);
      await chrome.storage.local.set({
        [STORAGE_KEYS.progress]: progress,
        [STORAGE_KEYS.capturedChatMeta]: capturedChatMeta,
        [STORAGE_KEYS.cachedChatBundles]: cachedChatBundles,
      });
    }

    const selectedChatIds = scopedChats
      .filter((c) => !stored.exportedChatIds.includes(c.id))
      .map((c) => c.id);

    await chrome.storage.local.set({
      [STORAGE_KEYS.currentProjectScan]: combinedScan,
      [STORAGE_KEYS.captureState]: progress.failed ? 'partial' : 'complete',
      [STORAGE_KEYS.progress]: {
        ...progress,
        phase: `${phaseLabel}-complete`,
        current: '',
      },
      [STORAGE_KEYS.selectedProjectIds]: selectedProjectIds,
      [STORAGE_KEYS.selectedChatIds]: selectedChatIds,
      [STORAGE_KEYS.capturedChatMeta]: capturedChatMeta,
      [STORAGE_KEYS.cachedChatBundles]: cachedChatBundles,
    });

    return { ok: true, scan: combinedScan };
  } catch (error) {
    await chrome.storage.local.set({ [STORAGE_KEYS.captureState]: 'failed' });
    return { ok: false, error: error.message || String(error) };
  }
}

async function scanCurrentProject() {
  return runScopedScan('scan-current-project-nav', 'scan-current-project');
}

async function scanStandaloneChats() {
  return runScopedScan('scan-standalone-nav', 'scan-standalone-chats');
}

async function setManualGroup(selectedChatIds, projectName, overwriteExisting) {
  const stored = await getStoredState();
  const manualGroups = { ...stored.manualGroups };

  const normalizedName = String(projectName || '').trim();
  if (!normalizedName) return { ok: false, error: 'Project/group name is empty.' };

  const projectId = `project-${sanitizeId(normalizedName)}`;

  const conflicts = [];
  for (const chatId of selectedChatIds || []) {
    const existing = manualGroups[chatId];
    if (existing && existing.projectName !== normalizedName) {
      conflicts.push({ chatId, existingProjectName: existing.projectName });
    }
  }

  if (conflicts.length && !overwriteExisting) {
    return { ok: false, needsConfirm: true, conflicts };
  }

  for (const chatId of selectedChatIds || []) {
    manualGroups[chatId] = { projectId, projectName: normalizedName };
  }

  const currentProjectScan = stored.currentProjectScan
    ? applyManualGroupsToScan(stored.currentProjectScan, manualGroups)
    : null;

  await chrome.storage.local.set({
    [STORAGE_KEYS.manualGroups]: manualGroups,
    [STORAGE_KEYS.currentProjectScan]: currentProjectScan,
  });

  return { ok: true, projectId, projectName: normalizedName };
}

async function clearManualGroup(selectedChatIds) {
  const stored = await getStoredState();
  const manualGroups = { ...stored.manualGroups };

  for (const chatId of selectedChatIds || []) {
    delete manualGroups[chatId];
  }

  const currentProjectScan = stored.currentProjectScan
    ? applyManualGroupsToScan(stored.currentProjectScan, manualGroups)
    : null;

  await chrome.storage.local.set({
    [STORAGE_KEYS.manualGroups]: manualGroups,
    [STORAGE_KEYS.currentProjectScan]: currentProjectScan,
  });

  return { ok: true };
}

async function downloadJsonObject(obj, filename) {
  const dataStr = 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(obj, null, 2));
  await chrome.downloads.download({
    url: dataStr,
    filename,
    saveAs: false,
  });
}

async function exportSelectedChats(selectedChatIds = null, recaptureOnly = false) {
  const stored = await getStoredState();
  const currentProjectScan = stored.currentProjectScan;
  const projectChats = currentProjectScan?.chats || [];
  const ungroupedChats = currentProjectScan?.ungroupedChats || [];
  const allChats = [...projectChats, ...ungroupedChats];

  if (!allChats.length) {
    return { ok: false, error: 'No scanned chats available. Use a scan button first.' };
  }

  const selectedSet = new Set(selectedChatIds || []);
  const chats = selectedSet.size ? allChats.filter((c) => selectedSet.has(c.id)) : [];
  if (!chats.length) {
    return { ok: false, error: 'No selected chats available for export.' };
  }

  const progress = {
    phase: recaptureOnly ? 'recapture-selected-chats' : 'selected-chat-export',
    total: chats.length,
    completed: 0,
    failed: 0,
    current: '',
    logs: [],
  };

  await chrome.storage.local.set({ [STORAGE_KEYS.captureState]: 'capturing', [STORAGE_KEYS.progress]: progress });

  const failedChats = [];
  const exportedChatIds = new Set(stored.exportedChatIds || []);
  const remainingSelected = new Set(stored.selectedChatIds || []);
  const capturedChatMeta = { ...(stored.capturedChatMeta || {}) };
  const cachedChatBundles = { ...(stored.cachedChatBundles || {}) };

  for (let i = 0; i < chats.length; i++) {
    const chat = chats[i];
    const label = `${chat.projectName || 'Standalone'} / ${chat.title}`;
    progress.current = label;
    progress.logs.unshift(`${recaptureOnly ? 'Re-capturing' : 'Exporting'} ${i + 1}/${chats.length}: ${label}`);
    progress.logs = progress.logs.slice(0, 60);
    await chrome.storage.local.set({ [STORAGE_KEYS.progress]: progress });

    try {
      let bundle = cachedChatBundles[chat.id];

      if (recaptureOnly || !bundle) {
        const sourceTab = await getActiveTab();
        if (!sourceTab?.id) throw new Error('No active tab found');
        await chrome.tabs.update(sourceTab.id, { url: chat.href });
        await new Promise((r) => setTimeout(r, 4500));
        await ensureContentScript(sourceTab.id);
        bundle = await captureFromTab(sourceTab.id, chat);
        if ((bundle.messages?.length || 0) === 0) {
          progress.logs.unshift(`Retrying zero-message page with longer wait: ${label}`);
          progress.logs = progress.logs.slice(0, 60);
          await chrome.storage.local.set({ [STORAGE_KEYS.progress]: progress });
          bundle = await captureWithRetry(sourceTab.id, chat, 9000);
        }
        cachedChatBundles[chat.id] = bundle;
      }

      const messageCount = bundle.messages?.length || 0;
      const assetCount = bundle.assets?.length || 0;

      capturedChatMeta[chat.id] = {
        messageCount,
        assetCount,
        capturedAt: new Date().toISOString(),
        changed: true,
      };

      if (!recaptureOnly) {
        const folderRoot = chat.projectName
          ? `projects/${sanitizeFilePart(chat.projectName)}`
          : 'ungrouped';

        await downloadJsonObject(
          bundle,
          `project-archivist-export/${folderRoot}/${String(i + 1).padStart(3, '0')} - ${sanitizeFilePart(chat.title)}.json`,
        );
        exportedChatIds.add(chat.id);
        remainingSelected.delete(chat.id);
      }

      progress.completed += 1;
      progress.logs.unshift(`✅ ${label} [${messageCount} msgs]`);
    } catch (error) {
      progress.failed += 1;
      failedChats.push({
        title: chat.title,
        projectName: chat.projectName,
        href: chat.href,
        error: error.message || String(error),
      });
      progress.logs.unshift(`❌ ${label}: ${error.message || String(error)}`);
    }

    progress.logs = progress.logs.slice(0, 60);
    await chrome.storage.local.set({
      [STORAGE_KEYS.progress]: progress,
      [STORAGE_KEYS.exportedChatIds]: Array.from(exportedChatIds),
      [STORAGE_KEYS.selectedChatIds]: Array.from(remainingSelected),
      [STORAGE_KEYS.capturedChatMeta]: capturedChatMeta,
      [STORAGE_KEYS.cachedChatBundles]: cachedChatBundles,
    });
  }

  await chrome.storage.local.set({
    [STORAGE_KEYS.captureState]: failedChats.length ? 'partial' : 'complete',
    [STORAGE_KEYS.lastWorkspaceExport]: {
      exportedAt: new Date().toISOString(),
      total: chats.length,
      completed: progress.completed,
      failed: progress.failed,
      failedChats,
      mode: recaptureOnly ? 'recapture-selected-chats' : 'selected-chats',
    },
    [STORAGE_KEYS.progress]: {
      ...progress,
      phase: 'export-complete',
      current: '',
    },
  });

  return {
    ok: true,
    summary: {
      total: chats.length,
      completed: progress.completed,
      failed: progress.failed,
      failedChats,
      recaptureOnly,
    },
  };
}

async function exportSelectedGroups(selectedProjectIds = []) {
  const stored = await getStoredState();
  const currentProjectScan = stored.currentProjectScan;
  const projects = currentProjectScan?.projects || [];
  const selectedProjects = projects.filter((p) => selectedProjectIds.includes(p.id));

  if (!selectedProjects.length) {
    return { ok: false, error: 'No selected groups available for export.' };
  }

  let total = 0;
  let completed = 0;
  let failed = 0;
  const failedChats = [];

  for (const project of selectedProjects) {
    const chatIds = (project.chats || []).map((c) => c.id);
    total += chatIds.length;
    const res = await exportSelectedChats(chatIds, false);
    if (!res.ok) {
      failed += chatIds.length;
      failedChats.push({ title: project.name, projectName: project.name, error: res.error || 'Unknown error' });
      continue;
    }
    completed += res.summary?.completed || 0;
    failed += res.summary?.failed || 0;
    failedChats.push(...(res.summary?.failedChats || []));
  }

  return {
    ok: true,
    summary: {
      total,
      completed,
      failed,
      failedChats,
      mode: 'selected-groups',
    },
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (message.type === 'scan-current-project') return sendResponse(await scanCurrentProject());
    if (message.type === 'scan-standalone-chats') return sendResponse(await scanStandaloneChats());

    if (message.type === 'export-selected-groups') {
      return sendResponse(await exportSelectedGroups(message.selectedProjectIds || []));
    }

    if (message.type === 'export-selected-chats') {
      return sendResponse(await exportSelectedChats(message.selectedChatIds, false));
    }

    if (message.type === 'recapture-selected-chats') {
      return sendResponse(await exportSelectedChats(message.selectedChatIds, true));
    }

    if (message.type === 'set-manual-group') {
      return sendResponse(await setManualGroup(message.selectedChatIds, message.projectName, message.overwriteExisting));
    }

    if (message.type === 'clear-manual-group') {
      return sendResponse(await clearManualGroup(message.selectedChatIds));
    }

    if (message.type === 'update-selection') {
      await chrome.storage.local.set({
        [STORAGE_KEYS.selectedProjectIds]: message.selectedProjectIds ?? [],
        [STORAGE_KEYS.selectedChatIds]: message.selectedChatIds ?? [],
        [STORAGE_KEYS.groupUiState]: message.groupUiState ?? {},
      });
      return sendResponse({ ok: true });
    }

    if (message.type === 'get-last-capture') {
      const data = await getStoredState();
      return sendResponse({ ok: true, ...data });
    }

    return sendResponse({ ok: false, error: 'Unknown message type' });
  })();
  return true;
});
