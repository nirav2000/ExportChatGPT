const resultEl = document.getElementById('result');
const captureStateEl = document.getElementById('captureState');
const eligibilityEl = document.getElementById('eligibility');
const permissionEl = document.getElementById('permission');

const progressPhaseEl = document.getElementById('progressPhase');
const progressTotalEl = document.getElementById('progressTotal');
const progressCompletedEl = document.getElementById('progressCompleted');
const progressFailedEl = document.getElementById('progressFailed');
const progressCurrentChatEl = document.getElementById('progressCurrentChat');
const progressLogEl = document.getElementById('progressLog');
const errorsPanelEl = document.getElementById('errorsPanel');

const structureSummaryEl = document.getElementById('structureSummary');
const structureTreeEl = document.getElementById('structureTree');
const manualGroupInputEl = document.getElementById('manualGroupName');
const manualGroupStatusEl = document.getElementById('manualGroupStatus');

let progressPoller = null;
let currentScan = null;
let selectedProjectIds = new Set();
let selectedChatIds = new Set();
let manualGroups = {};
let exportedChatIds = new Set();
let capturedChatMeta = {};
let groupUiState = {};
let previousCapturedMeta = {};

function setState(state) {
  captureStateEl.textContent = state;
  captureStateEl.className = `chip ${state}`;
}

function renderErrors(failedChats) {
  if (!Array.isArray(failedChats) || !failedChats.length) {
    errorsPanelEl.textContent = 'No errors.';
    return;
  }

  errorsPanelEl.textContent = failedChats
    .map((item) => `• ${item.projectName || 'Ungrouped'} / ${item.title}\n  ${item.error || 'Unknown error'}`)
    .join('\n\n');
}

function renderProgress(snapshot) {
  const progress = snapshot?.progress;
  const summary = snapshot?.lastWorkspaceExport;

  progressPhaseEl.textContent = progress?.phase || summary?.mode || '-';
  progressTotalEl.textContent = String(progress?.total ?? summary?.total ?? 0);
  progressCompletedEl.textContent = String(progress?.completed ?? summary?.completed ?? 0);
  progressFailedEl.textContent = String(progress?.failed ?? summary?.failed ?? 0);
  progressCurrentChatEl.textContent = progress?.current || '-';
  progressLogEl.textContent = Array.isArray(progress?.logs) && progress.logs.length ? progress.logs.join('\n') : 'No activity yet.';
  renderErrors(summary?.failedChats || []);
}

function htmlEscape(s) {
  return String(s || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

async function persistSelection() {
  await chrome.runtime.sendMessage({
    type: 'update-selection',
    selectedProjectIds: Array.from(selectedProjectIds),
    selectedChatIds: Array.from(selectedChatIds),
    groupUiState,
  });
}

function projectHasChanges(project) {
  const chats = project.chats || [];
  for (const chat of chats) {
    const current = capturedChatMeta[chat.id];
    const prev = previousCapturedMeta[chat.id];
    if (!prev && current) return true;
    if (prev && current && prev.messageCount !== current.messageCount) return true;
    if (current?.changed) return true;
  }
  return false;
}

function groupExpandedDefault(project) {
  return projectHasChanges(project) || selectedProjectIds.has(project.id);
}

function chatBadge(chat) {
  const badges = [];
  const meta = capturedChatMeta[chat.id];
  const prev = previousCapturedMeta[chat.id];

  if (meta?.messageCount != null) badges.push(`<span class="badge count">[${meta.messageCount} msgs]</span>`);
  if (!prev && meta) badges.push('<span class="badge changed">new</span>');
  else if (prev && meta && prev.messageCount !== meta.messageCount) badges.push('<span class="badge changed">updated</span>');
  if (exportedChatIds.has(chat.id)) badges.push('<span class="badge exported">exported</span>');
  if (manualGroups[chat.id]) badges.push('<span class="badge manual">manual</span>');
  return badges.join(' ');
}

function renderChatItem(chat) {
  const checked = selectedChatIds.has(chat.id);
  return `
    <li>
      <label class="checkbox-row">
        <input type="checkbox" class="chat-checkbox" data-chat-id="${htmlEscape(chat.id)}" ${checked ? 'checked' : ''} />
        <span>${htmlEscape(chat.title)} ${chatBadge(chat)}</span>
      </label>
    </li>
  `;
}

function renderGroup(project, extraClass = '') {
  const chats = project.chats || [];
  const changed = projectHasChanges(project);
  const expanded = groupUiState[project.id] ?? groupExpandedDefault(project);

  return `
    <div class="tree-project ${extraClass} ${changed ? 'changed' : ''} ${chats.some(c => exportedChatIds.has(c.id)) ? 'exported' : ''}">
      <div class="tree-project-header">
        <span class="group-toggle" data-project-id="${htmlEscape(project.id)}">${expanded ? '▾' : '▸'}</span>
        <input type="checkbox" class="group-checkbox" data-project-id="${htmlEscape(project.id)}" ${selectedProjectIds.has(project.id) ? 'checked' : ''} />
        <h4 class="group-title" data-project-id="${htmlEscape(project.id)}" data-project-name="${htmlEscape(project.name)}">${htmlEscape(project.name)} ${changed ? '<span class="badge changed">changed</span>' : ''}</h4>
      </div>
      <div class="group-body ${expanded ? '' : 'collapsed'}" data-group-body="${htmlEscape(project.id)}">
        ${chats.length ? '<ul>' : '<div class="muted">No chats detected.</div>'}
        ${chats.map(renderChatItem).join('')}
        ${chats.length ? '</ul>' : ''}
      </div>
    </div>
  `;
}

async function renameGroupInline(projectId, oldName, titleEl) {
  const input = document.createElement('input');
  input.className = 'group-title-input';
  input.value = oldName;
  titleEl.replaceWith(input);
  input.focus();
  input.select();

  let done = false;

  const finish = async (commit) => {
    if (done) return;
    done = true;

    const newName = input.value.trim();
    if (commit && newName && newName !== oldName) {
      const project =
        projectId === 'ungrouped'
          ? { chats: currentScan?.ungroupedChats || [] }
          : (currentScan?.projects || []).find((p) => p.id === projectId);

      const ids = (project?.chats || []).map((c) => c.id);

      let response = await chrome.runtime.sendMessage({
        type: 'set-manual-group',
        selectedChatIds: ids,
        projectName: newName,
        overwriteExisting: false,
      });

      if (response?.needsConfirm) {
        const ok = window.confirm(`Some chats already have a different manual group. Overwrite with "${newName}"?`);
        if (ok) {
          response = await chrome.runtime.sendMessage({
            type: 'set-manual-group',
            selectedChatIds: ids,
            projectName: newName,
            overwriteExisting: true,
          });
        }
      }

      if (response?.ok) {
        manualGroupStatusEl.textContent = `Renamed group "${oldName}" to "${newName}".`;
        await refreshUi();
        return;
      }
    }

    await refreshUi();
  };

  input.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') await finish(true);
    if (e.key === 'Escape') await finish(false);
  });

  input.addEventListener('blur', async () => {
    await finish(true);
  });
}

function renderStructure(scan) {
  currentScan = scan || null;

  if (!scan) {
    structureSummaryEl.textContent = 'No project scan yet.';
    structureTreeEl.innerHTML = '';
    return;
  }

  const projects = scan.projects || [];
  const ungrouped = scan.ungroupedChats || [];
  structureSummaryEl.textContent = `Projects: ${projects.length} • Project chats: ${(scan.chats || []).length} • Ungrouped: ${ungrouped.length}`;

  let html = '';

  for (const project of projects) {
    html += renderGroup(project);
  }

  html += renderGroup(
    {
      id: 'ungrouped',
      name: 'Ungrouped / No project',
      chats: ungrouped,
    },
    'ungrouped'
  );

  structureTreeEl.innerHTML = html;

  for (const toggle of structureTreeEl.querySelectorAll('.group-toggle')) {
    toggle.addEventListener('click', async (e) => {
      const projectId = e.target.dataset.projectId;
      if (!projectId) return;

      const currentProject =
        projectId === 'ungrouped'
          ? { id: 'ungrouped', chats: currentScan?.ungroupedChats || [] }
          : (currentScan?.projects || []).find((p) => p.id === projectId);

      const expanded = !(groupUiState[projectId] ?? groupExpandedDefault(currentProject || { id: projectId, chats: [] }));
      groupUiState[projectId] = expanded;
      renderStructure(currentScan);
      await persistSelection();
    });
  }

  for (const title of structureTreeEl.querySelectorAll('.group-title')) {
    title.addEventListener('dblclick', async () => {
      const projectId = title.dataset.projectId;
      const projectName = title.dataset.projectName || '';
      if (!projectId || projectId === 'ungrouped') return;
      await renameGroupInline(projectId, projectName, title);
    });
  }

  for (const groupBox of structureTreeEl.querySelectorAll('.group-checkbox')) {
    groupBox.addEventListener('change', async (e) => {
      const projectId = e.target.dataset.projectId;
      if (!projectId) return;

      if (e.target.checked) selectedProjectIds.add(projectId);
      else selectedProjectIds.delete(projectId);

      const project =
        projectId === 'ungrouped'
          ? { chats: currentScan?.ungroupedChats || [] }
          : (currentScan?.projects || []).find((p) => p.id === projectId);

      for (const chat of project?.chats || []) {
        if (e.target.checked) selectedChatIds.add(chat.id);
        else selectedChatIds.delete(chat.id);
      }

      await persistSelection();
      renderStructure(currentScan);
    });
  }

  for (const checkbox of structureTreeEl.querySelectorAll('.chat-checkbox')) {
    checkbox.addEventListener('change', async (e) => {
      const chatId = e.target.dataset.chatId;
      if (!chatId) return;

      if (e.target.checked) selectedChatIds.add(chatId);
      else selectedChatIds.delete(chatId);

      await persistSelection();
    });
  }
}

async function updatePermissionState() {
  const granted = await chrome.permissions.contains({
    origins: ['https://chatgpt.com/*', 'https://chat.openai.com/*'],
  });
  permissionEl.textContent = granted ? 'permission: granted' : 'permission: missing';
}

async function updateEligibility() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const ok = Boolean(
    tab?.url?.startsWith('https://chatgpt.com/') || tab?.url?.startsWith('https://chat.openai.com/'),
  );
  eligibilityEl.textContent = ok ? 'ready' : 'not-chatgpt';
}

async function getSnapshot() {
  return chrome.runtime.sendMessage({ type: 'get-last-capture' });
}

async function refreshUi() {
  const snapshot = await getSnapshot();
  if (snapshot?.captureState) setState(snapshot.captureState);

  previousCapturedMeta = { ...capturedChatMeta };
  selectedProjectIds = new Set(snapshot?.selectedProjectIds || Array.from(selectedProjectIds));
  selectedChatIds = new Set(snapshot?.selectedChatIds || Array.from(selectedChatIds));
  manualGroups = snapshot?.manualGroups || {};
  exportedChatIds = new Set(snapshot?.exportedChatIds || []);
  capturedChatMeta = snapshot?.capturedChatMeta || {};
  groupUiState = snapshot?.groupUiState || groupUiState || {};

  renderStructure(snapshot?.currentProjectScan);
  renderProgress(snapshot);

  if (snapshot?.lastWorkspaceExport) {
    resultEl.textContent = JSON.stringify(snapshot.lastWorkspaceExport, null, 2);
    return;
  }
  if (snapshot?.currentProjectScan) {
    resultEl.textContent = JSON.stringify(snapshot.currentProjectScan, null, 2);
    return;
  }
  if (snapshot?.lastCapture) {
    resultEl.textContent = JSON.stringify(snapshot.lastCapture, null, 2);
    return;
  }
  resultEl.textContent = 'No capture yet.';
}

function startPolling() {
  stopPolling();
  progressPoller = setInterval(() => {
    void refreshUi();
  }, 1000);
}

function stopPolling() {
  if (progressPoller) {
    clearInterval(progressPoller);
    progressPoller = null;
  }
}

async function doCapture() {
  setState('capturing');
  resultEl.textContent = 'Capturing current chat...';
  const response = await chrome.runtime.sendMessage({ type: 'capture-current-chat' });
  if (!response?.ok) {
    setState('failed');
    resultEl.textContent = `Capture failed: ${response?.error || 'Unknown error'}`;
    return;
  }
  await refreshUi();
}

async function doScanProject() {
  setState('scanning');
  resultEl.textContent = 'Scanning current project...';
  startPolling();
  try {
    const response = await chrome.runtime.sendMessage({ type: 'scan-current-project' });
    if (!response?.ok) {
      setState('failed');
      resultEl.textContent = `Project scan failed: ${response?.error || 'Unknown error'}`;
      return;
    }
    await refreshUi();
  } finally {
    stopPolling();
  }
}

async function doExportCurrentChat() {
  setState('downloading');
  const response = await chrome.runtime.sendMessage({ type: 'download-last-bundle' });
  if (!response?.ok) {
    setState('failed');
    resultEl.textContent = `Download failed: ${response?.error || 'Unknown error'}`;
    return;
  }
  await refreshUi();
}

async function doExportSelectedGroups() {
  setState('capturing');
  resultEl.textContent = 'Starting selected-groups export...';
  startPolling();
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'export-selected-groups',
      selectedProjectIds: Array.from(selectedProjectIds),
    });
    if (!response?.ok) {
      setState('failed');
      resultEl.textContent = `Starting selected-groups export...\n\nFailed: ${response?.error || 'Unknown error'}`;
      return;
    }
    await refreshUi();
  } finally {
    stopPolling();
  }
}

async function doExportSelectedChats() {
  setState('capturing');
  resultEl.textContent = 'Starting selected-chats export...';
  startPolling();
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'export-selected-chats',
      selectedChatIds: Array.from(selectedChatIds),
    });
    if (!response?.ok) {
      setState('failed');
      resultEl.textContent = `Starting selected-chats export...\n\nFailed: ${response?.error || 'Unknown error'}`;
      return;
    }
    await refreshUi();
  } finally {
    stopPolling();
  }
}

async function doRecaptureSelectedChats() {
  setState('capturing');
  resultEl.textContent = 'Re-capturing selected chats...';
  startPolling();
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'recapture-selected-chats',
      selectedChatIds: Array.from(selectedChatIds),
    });
    if (!response?.ok) {
      setState('failed');
      resultEl.textContent = `Re-capturing selected chats...\n\nFailed: ${response?.error || 'Unknown error'}`;
      return;
    }
    await refreshUi();
  } finally {
    stopPolling();
  }
}

async function applyManualGroup() {
  const name = manualGroupInputEl.value.trim();
  if (!name) {
    manualGroupStatusEl.textContent = 'Enter a project/group name first.';
    return;
  }

  const ids = Array.from(selectedChatIds);
  if (!ids.length) {
    manualGroupStatusEl.textContent = 'Select at least one chat first.';
    return;
  }

  let response = await chrome.runtime.sendMessage({
    type: 'set-manual-group',
    selectedChatIds: ids,
    projectName: name,
    overwriteExisting: false,
  });

  if (response?.needsConfirm) {
    const ok = window.confirm(
      `Some selected chats already have a different manual group. Overwrite those manual groupings with "${name}"?`
    );
    if (!ok) {
      manualGroupStatusEl.textContent = 'Manual grouping cancelled.';
      return;
    }

    response = await chrome.runtime.sendMessage({
      type: 'set-manual-group',
      selectedChatIds: ids,
      projectName: name,
      overwriteExisting: true,
    });
  }

  if (!response?.ok) {
    manualGroupStatusEl.textContent = `Manual grouping failed: ${response?.error || 'Unknown error'}`;
    return;
  }

  manualGroupStatusEl.textContent = `Assigned "${name}" to ${ids.length} selected chat(s).`;
  await refreshUi();
}

async function clearManualGroup() {
  const ids = Array.from(selectedChatIds);
  if (!ids.length) {
    manualGroupStatusEl.textContent = 'Select at least one chat first.';
    return;
  }

  const response = await chrome.runtime.sendMessage({
    type: 'clear-manual-group',
    selectedChatIds: ids,
  });

  if (!response?.ok) {
    manualGroupStatusEl.textContent = `Clear manual grouping failed: ${response?.error || 'Unknown error'}`;
    return;
  }

  manualGroupStatusEl.textContent = `Cleared manual grouping from ${ids.length} selected chat(s).`;
  await refreshUi();
}

document.getElementById('requestPerm')?.addEventListener('click', async () => {
  const granted = await chrome.permissions.request({
    origins: ['https://chatgpt.com/*', 'https://chat.openai.com/*'],
  });
  resultEl.textContent = granted ? 'Permission granted.' : 'Permission denied.';
  await updatePermissionState();
});

document.getElementById('scan')?.addEventListener('click', doCapture);
document.getElementById('exportChat')?.addEventListener('click', doExportCurrentChat);
document.getElementById('scanProject')?.addEventListener('click', doScanProject);
document.getElementById('exportSelectedGroups')?.addEventListener('click', doExportSelectedGroups);
document.getElementById('exportSelectedChats')?.addEventListener('click', doExportSelectedChats);
document.getElementById('recaptureSelectedChats')?.addEventListener('click', doRecaptureSelectedChats);
document.getElementById('applyManualGroup')?.addEventListener('click', applyManualGroup);
document.getElementById('clearManualGroup')?.addEventListener('click', clearManualGroup);

document.getElementById('checkAllVisible')?.addEventListener('click', async () => {
  if (!currentScan) return;
  for (const p of currentScan.projects || []) selectedProjectIds.add(p.id);
  for (const c of [...(currentScan.chats || []), ...(currentScan.ungroupedChats || [])]) {
    if (!exportedChatIds.has(c.id)) selectedChatIds.add(c.id);
  }
  renderStructure(currentScan);
  await persistSelection();
});

document.getElementById('uncheckAllVisible')?.addEventListener('click', async () => {
  selectedChatIds.clear();
  selectedProjectIds.clear();
  renderStructure(currentScan);
  await persistSelection();
});

document.getElementById('expandAllGroups')?.addEventListener('click', async () => {
  if (!currentScan) return;
  for (const p of [...(currentScan.projects || []).map(p => p.id), 'ungrouped']) {
    groupUiState[p] = true;
  }
  renderStructure(currentScan);
  await persistSelection();
});

document.getElementById('collapseAllGroups')?.addEventListener('click', async () => {
  if (!currentScan) return;
  for (const p of [...(currentScan.projects || []).map(p => p.id), 'ungrouped']) {
    groupUiState[p] = false;
  }
  renderStructure(currentScan);
  await persistSelection();
});

updatePermissionState();
updateEligibility();
refreshUi();
setState('ready');
