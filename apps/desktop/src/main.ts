const content = document.querySelector<HTMLDivElement>('#content');

const views: Record<string, string> = {
  archive: '<div class="card"><h2>Archive Browser</h2><p class="muted">Projects, chats, and standalone conversations will appear here.</p></div>',
  import: '<div class="card"><h2>Import Wizard</h2><p>Import official ZIP or capture bundles.</p></div>',
  export: '<div class="card"><h2>Export Jobs</h2><p>Queue full/project/chat exports with incremental mode.</p></div>',
  settings: '<div class="card"><h2>Settings</h2><p>Choose export root, privacy options, and diagnostics behavior.</p></div>',
  diagnostics: '<div class="card"><h2>Diagnostics</h2><p>Inspect missing assets and failed captures.</p></div>',
};

function render(view: string): void {
  if (!content) return;
  content.innerHTML = views[view] ?? views.archive;
}

for (const btn of document.querySelectorAll<HTMLButtonElement>('#sidebar button')) {
  btn.addEventListener('click', () => render(btn.dataset.view || 'archive'));
}

render('archive');
