(function(){const t=document.createElement("link").relList;if(t&&t.supports&&t.supports("modulepreload"))return;for(const n of document.querySelectorAll('link[rel="modulepreload"]'))a(n);new MutationObserver(n=>{for(const c of n)if(c.type==="childList")for(const s of c.addedNodes)s.tagName==="LINK"&&s.rel==="modulepreload"&&a(s)}).observe(document,{childList:!0,subtree:!0});function i(n){const c={};return n.integrity&&(c.integrity=n.integrity),n.referrerPolicy&&(c.referrerPolicy=n.referrerPolicy),n.crossOrigin==="use-credentials"?c.credentials="include":n.crossOrigin==="anonymous"?c.credentials="omit":c.credentials="same-origin",c}function a(n){if(n.ep)return;n.ep=!0;const c=i(n);fetch(n.href,c)}})();async function u(e,t={},i){return window.__TAURI_INTERNALS__.invoke(e,t,i)}async function Q(e={}){return typeof e=="object"&&Object.freeze(e),await u("plugin:dialog|open",{options:e})}const g=document.querySelector("#content"),q="project-archivist.autoImportFolder",D="project-archivist.autoImportEnabled",M="project-archivist.exportRoot",U="/Users/n/Downloads/project-archivist-export/";let C=null,F=!1,b="archive",I="",h=new Set,p=new Set,x=new Set;function L(e,t){return`<div class="card"><h2>${e}</h2>${t}</div>`}function S(){return localStorage.getItem(q)||""}function T(){return localStorage.getItem(D)==="true"}function z(e){localStorage.setItem(q,e)}function K(e){localStorage.setItem(D,e?"true":"false")}function A(){return localStorage.getItem(M)||U}function R(e){localStorage.setItem(M,e)}function P(e,t){const i=document.getElementById(e);i&&(i.textContent=t)}async function k(){b==="archive"&&await f()}async function N(e=!1){if(!(F||!T())){F=!0;try{const t=await u("auto_import_capture_folder",{folderPath:S()});(e||!t.startsWith("Imported 0 new file(s)"))&&b==="settings"&&P("autoImportResult",t),t.startsWith("Imported 0 new file(s)")||await k()}catch(t){const i=`Auto-import failed: ${t.message}`;b==="settings"&&P("autoImportResult",i)}finally{F=!1}}}function J(){C!==null&&(window.clearInterval(C),C=null),T()&&(C=window.setInterval(()=>{N(!1)},5e3))}function y(e){return String(e).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;")}function W(e){const t=p.has(e.id)?"checked":"",i=e.changed?'<span class="badge changed">changed</span>':"";return`<li class="chat-row ${e.changed?"changed":""}">
    <label>
      <input type="checkbox" class="chat-check" data-chat-id="${y(e.id)}" ${t} />
      <span>${y(e.title)} <span class="muted">[${e.message_count} msgs, ${e.image_count} imgs]</span> ${i}</span>
    </label>
  </li>`}function G(e){const t=x.has(e.id),i=h.has(e.id)?"checked":"",a=e.changed?'<span class="badge changed">changed</span>':"";return`<div class="project-block ${e.changed?"changed":""}">
    <div class="project-head">
      <button class="collapse-btn" data-project-id="${y(e.id)}">${t?"▸":"▾"}</button>
      <label class="grow">
        <input type="checkbox" class="project-check" data-project-id="${y(e.id)}" ${i} />
        <strong>${y(e.name)}</strong> <span class="muted">(${e.chats.length} chats)</span> ${a}
      </label>
    </div>
    <div class="project-body ${t?"collapsed":""}">
      <ul>${e.chats.map(W).join("")}</ul>
    </div>
  </div>`}async function f(){var a,n,c,s,E,w,B,_,$;if(b="archive",!g)return;const e=await u("list_archive_tree"),t=e.projects.filter(r=>{const o=`${r.name} ${r.chats.map(l=>l.title).join(" ")}`.toLowerCase();return!I||o.includes(I.toLowerCase())}),i=e.standalone.filter(r=>{const o=`${r.title}`.toLowerCase();return!I||o.includes(I.toLowerCase())});g.innerHTML=L("Archive Browser",`
    <style>
      .toolbar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}
      .toolbar input,.toolbar select{padding:8px}
      .toolbar .grow-input{flex:1;min-width:240px}
      .project-block{border:1px solid #334155;border-radius:10px;padding:8px;margin:10px 0;background:#0f172a}
      .project-block.changed{border-color:#f59e0b;box-shadow: inset 0 0 0 1px rgba(245,158,11,.25)}
      .project-head{display:flex;align-items:center;gap:8px}
      .project-body.collapsed{display:none}
      .collapse-btn{width:auto;padding:2px 8px}
      .grow{flex:1}
      .chat-row.changed{background:rgba(245,158,11,.08);border-radius:6px}
      .badge{display:inline-block;padding:1px 6px;border-radius:999px;border:1px solid #475569;font-size:11px}
      .badge.changed{border-color:#f59e0b;color:#fde68a}
      .muted{color:#94a3b8}
      ul{margin:8px 0 0;padding-left:20px}
      .actions{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}
    </style>
    <div class="toolbar">
      <input id="archiveSearchInput" class="grow-input" placeholder="Search projects or chats" value="${y(I)}" />
      <input id="archiveExportRootInput" class="grow-input" placeholder="Export root folder" value="${y(A())}" />
      <select id="archiveExportMode">
        <option value="incremental">incremental</option>
        <option value="force" selected>force</option>
      </select>
    </div>
    <div class="actions">
      <button id="selectAllBtn">Select all visible</button>
      <button id="clearSelectionBtn">Unselect all</button>
      <button id="runArchiveAutoImportBtn">Auto import now</button>
      <button id="exportSelectedBtn">Export selected</button>
      <button id="deleteSelectedBtn">Remove selected from archive</button>
      <button id="expandAllBtn">Expand all</button>
      <button id="collapseAllBtn">Collapse all</button>
    </div>
    <div id="archiveTree">
      ${t.map(G).join("")}
      <div class="project-block ${i.some(r=>r.changed)?"changed":""}">
        <div class="project-head">
          <button class="collapse-btn" data-project-id="__standalone__">${x.has("__standalone__")?"▸":"▾"}</button>
          <strong>Standalone chats</strong> <span class="muted">(${i.length} chats)</span>
        </div>
        <div class="project-body ${x.has("__standalone__")?"collapsed":""}">
          <ul>${i.map(W).join("")}</ul>
        </div>
      </div>
    </div>
    <pre id="archiveActionResult" class="muted"></pre>
    <div class="muted">Exports generate <code>Project Archivist Export/index.html</code> and a launcher at <code>index.html</code> in the chosen root folder.</div>
    `),(a=document.getElementById("archiveSearchInput"))==null||a.addEventListener("input",async r=>{I=r.target.value,await f()}),(n=document.getElementById("archiveExportRootInput"))==null||n.addEventListener("change",r=>{const o=r.target.value.trim();o&&R(o)});for(const r of document.querySelectorAll(".collapse-btn"))r.addEventListener("click",async()=>{const o=r.dataset.projectId||"";x.has(o)?x.delete(o):x.add(o),await f()});for(const r of document.querySelectorAll(".project-check"))r.addEventListener("change",()=>{const o=r.dataset.projectId||"",l=t.find(d=>d.id===o);if(l){if(r.checked){h.add(o);for(const d of l.chats)p.add(d.id)}else{h.delete(o);for(const d of l.chats)p.delete(d.id)}f()}});for(const r of document.querySelectorAll(".chat-check"))r.addEventListener("change",()=>{const o=r.dataset.chatId||"";r.checked?p.add(o):p.delete(o)});(c=document.getElementById("selectAllBtn"))==null||c.addEventListener("click",async()=>{for(const r of t){h.add(r.id);for(const o of r.chats)p.add(o.id)}for(const r of i)p.add(r.id);await f()}),(s=document.getElementById("clearSelectionBtn"))==null||s.addEventListener("click",async()=>{h.clear(),p.clear(),await f()}),(E=document.getElementById("runArchiveAutoImportBtn"))==null||E.addEventListener("click",async()=>{const r=document.getElementById("archiveActionResult"),o=S().trim();if(!o){r&&(r.textContent="Set a watched folder in Settings first.");return}try{r&&(r.textContent=`Importing JSON files from ${o} ...`);const l=await u("auto_import_capture_folder",{folderPath:o});await f();const d=document.getElementById("archiveActionResult");d&&(d.textContent=l)}catch(l){r&&(r.textContent=`Auto-import failed: ${l.message}`)}}),(w=document.getElementById("expandAllBtn"))==null||w.addEventListener("click",async()=>{x.clear(),await f()}),(B=document.getElementById("collapseAllBtn"))==null||B.addEventListener("click",async()=>{x=new Set(t.map(r=>r.id).concat("__standalone__")),await f()}),(_=document.getElementById("deleteSelectedBtn"))==null||_.addEventListener("click",async()=>{var d;const r=document.getElementById("archiveActionResult");if(!h.size&&!p.size){r&&(r.textContent="Select at least one project or chat first.");return}const o=(((d=document.getElementById("archiveExportRootInput"))==null?void 0:d.value)||A()).trim();if(o&&R(o),!!window.confirm("Remove the selected projects/chats from the archive and delete their exported files from disk?"))try{r&&(r.textContent="Removing selected items...");const m=await u("delete_archive_items",{projectIds:Array.from(h),chatIds:Array.from(p),rootDir:o});h.clear(),p.clear(),await f();const v=document.getElementById("archiveActionResult");v&&(v.textContent=m)}catch(m){r&&(r.textContent=`Delete failed: ${m.message}`),console.error(m)}}),($=document.getElementById("exportSelectedBtn"))==null||$.addEventListener("click",async()=>{var d,m;const r=document.getElementById("archiveActionResult");if(!h.size&&!p.size){r&&(r.textContent="Select at least one project or chat first.");return}const o=(((d=document.getElementById("archiveExportRootInput"))==null?void 0:d.value)||A()).trim();if(!o){r&&(r.textContent="Enter an export root folder first.");return}R(o);const l=(((m=document.getElementById("archiveExportMode"))==null?void 0:m.value)||"force").trim();try{r&&(r.textContent="Exporting selected items...");const v=await u("export_selected_archive",{rootDir:o,mode:l,projectIds:Array.from(h),chatIds:Array.from(p)});await f();const j=document.getElementById("archiveActionResult");j&&(j.textContent=`${v} Check ${o}/index.html`)}catch(v){r&&(r.textContent=`Export failed: ${v.message}`),console.error(v)}})}async function Y(e){const t=document.getElementById("importResult"),i=document.getElementById("bundleInput");if(i)try{const a=await e.text();i.value=a,t&&(t.textContent=`Loaded ${e.name}`)}catch(a){t&&(t.textContent=`Failed to read file: ${a.message}`)}}async function X(e){return new Promise((t,i)=>{e.file(a=>t([a]),a=>i(a))})}async function V(e){const t=[];for(;;){const i=await new Promise((a,n)=>{e.readEntries(c=>a(c),c=>n(c))});if(!i.length)break;t.push(...i)}return t}async function H(e){if(!e)return[];if(e.isFile)return await X(e);if(e.isDirectory){const t=e.createReader(),i=await V(t);return(await Promise.all(i.map(n=>H(n)))).flat()}return[]}async function Z(e){if(!e)return[];const t=Array.from(e.items||[]);return t.some(a=>typeof a.webkitGetAsEntry=="function")?(await Promise.all(t.map(async n=>{var s;const c=(s=n.webkitGetAsEntry)==null?void 0:s.call(n);return await H(c)}))).flat():Array.from(e.files||[])}function ee(){var E,w,B,_,$,r;if(b="import",!g)return;g.innerHTML=L("Import Wizard",`<h3>Import capture bundle JSON</h3>
    <div class="import-actions">
      <button id="pickBundleFileBtn">Select JSON file(s)</button>
      <button id="pickBundleFolderBtn">Select folder of JSON files</button>
      <button id="chooseImportFolderBtn">Open folder into app</button>
      <input id="bundleFileInput" type="file" accept=".json,application/json" multiple hidden />
      <input id="bundleFolderInput" type="file" webkitdirectory directory multiple hidden />
    </div>

    <div id="dropZone" class="drop-zone">
      <strong>Drop JSON file(s) or a folder here</strong>
      <p class="muted">Folders are searched recursively for <code>.json</code> files</p>
    </div>

    <textarea id="bundleInput" rows="12" style="width:100%"></textarea>
    <div class="import-actions">
      <button id="importBundleBtn">Import capture bundle</button>
      <button id="clearBundleBtn">Clear</button>
    </div>

    <h3>Import official ChatGPT export ZIP</h3>
    <input id="officialZipPath" placeholder="/path/to/chatgpt-export.zip" style="width:100%" />
    <div class="import-actions"><button id="importOfficialBtn">Import official ZIP</button></div>

    <pre id="importResult" class="muted"></pre>`);const e=document.getElementById("bundleFileInput"),t=document.getElementById("bundleFolderInput"),i=document.getElementById("dropZone"),a=document.getElementById("bundleInput"),n=document.getElementById("importResult");let c=[];async function s(o){const l=Array.from(o||[]).filter(d=>d.name.toLowerCase().endsWith(".json"));if(!l.length){c=[],a&&(a.value=""),n&&(n.textContent="No JSON files selected.");return}if(c=l,l.length===1){await Y(l[0]);return}a&&(a.value=""),n&&(n.textContent=`Loaded ${l.length} JSON files. Click “Import capture bundle” to import them all.`)}(E=document.getElementById("pickBundleFileBtn"))==null||E.addEventListener("click",()=>e==null?void 0:e.click()),(w=document.getElementById("pickBundleFolderBtn"))==null||w.addEventListener("click",()=>t==null?void 0:t.click()),(B=document.getElementById("chooseImportFolderBtn"))==null||B.addEventListener("click",async()=>{try{const o=await Q({directory:!0,multiple:!1,defaultPath:S()||A()});if(typeof o!="string"||!o.trim())return;n&&(n.textContent=`Importing JSON files from ${o} ...`),z(o);const l=await u("auto_import_capture_folder",{folderPath:o});n&&(n.textContent=l),await k()}catch(o){n&&(n.textContent=`Folder import failed: ${o.message}`)}}),e==null||e.addEventListener("change",async()=>{await s(e.files)}),t==null||t.addEventListener("change",async()=>{await s(t.files)}),i==null||i.addEventListener("dragover",o=>{o.preventDefault(),o.stopPropagation(),i.classList.add("dragover")}),i==null||i.addEventListener("dragleave",o=>{o.preventDefault(),o.stopPropagation(),i.classList.remove("dragover")}),i==null||i.addEventListener("drop",async o=>{o.preventDefault(),o.stopPropagation(),i.classList.remove("dragover");const l=await Z(o.dataTransfer);await s(l)}),(_=document.getElementById("clearBundleBtn"))==null||_.addEventListener("click",()=>{a&&(a.value=""),e&&(e.value=""),t&&(t.value=""),c=[],n&&(n.textContent="")}),($=document.getElementById("importBundleBtn"))==null||$.addEventListener("click",async()=>{try{if(c.length>1){let d=0,m=0;for(const v of c)try{const j=await v.text();await u("import_capture_bundle",{bundleJson:j}),d+=1}catch{m+=1}n&&(n.textContent=`Imported ${d} bundle(s), failed ${m}.`),c=[],await k();return}const o=(a==null?void 0:a.value)||"",l=await u("import_capture_bundle",{bundleJson:o});n&&(n.textContent=l),c=[],await k()}catch(o){n&&(n.textContent=`Import failed: ${o.message}`)}}),(r=document.getElementById("importOfficialBtn"))==null||r.addEventListener("click",async()=>{const o=document.getElementById("officialZipPath").value;try{const l=await u("import_official_export_zip",{zipPath:o});n&&(n.textContent=l),await k()}catch(l){n&&(n.textContent=`Official import failed: ${l.message}`)}})}function te(){var e,t,i;b="export",g&&(g.innerHTML=L("Export Jobs",`<label>Export root folder: <input id="exportRoot" value="${y(A())}" placeholder="/path/to/export/folder" /></label>
    <label>Mode:
      <select id="exportMode">
        <option value="incremental">incremental</option>
        <option value="force" selected>force</option>
      </select>
    </label>
    <div class="import-actions">
      <button id="queueExportBtn">Queue workspace export</button>
      <button id="runNowExportBtn">Queue and run now</button>
      <button id="runExportsBtn">Run queued/failed exports</button>
    </div>
    <pre id="exportResult" class="muted"></pre>`),(e=document.getElementById("queueExportBtn"))==null||e.addEventListener("click",async()=>{const a=document.getElementById("exportRoot").value.trim(),n=document.getElementById("exportMode").value,c=document.getElementById("exportResult");if(!a){c&&(c.textContent="Export root folder is required.");return}R(a);try{c&&(c.textContent="Queueing export job...");const s=await u("queue_export_job",{target:"workspace",mode:n,rootDir:a});c&&(c.textContent=s)}catch(s){c&&(c.textContent=`Export queue failed: ${s.message}`)}}),(t=document.getElementById("runNowExportBtn"))==null||t.addEventListener("click",async()=>{const a=document.getElementById("exportRoot").value.trim(),n=document.getElementById("exportMode").value,c=document.getElementById("exportResult");if(!a){c&&(c.textContent="Export root folder is required.");return}R(a);try{c&&(c.textContent="Queueing export job...");const s=await u("queue_export_job",{target:"workspace",mode:n,rootDir:a});c&&(c.textContent=`${s}
Running export jobs...`);const E=await u("run_pending_export_jobs");c&&(c.textContent=`${s}
${E}`)}catch(s){c&&(c.textContent=`Running exports failed: ${s.message}`)}}),(i=document.getElementById("runExportsBtn"))==null||i.addEventListener("click",async()=>{const a=document.getElementById("exportResult");try{a&&(a.textContent="Running queued/failed exports...");const n=await u("run_pending_export_jobs");a&&(a.textContent=n)}catch(n){a&&(a.textContent=`Running exports failed: ${n.message}`)}}))}function oe(){var e,t;b="settings",g&&(g.innerHTML=L("Settings",`<p>Privacy mode is always local-first.</p>
    <ul>
      <li>No telemetry</li>
      <li>No cloud sync</li>
      <li>Explicit export path only</li>
    </ul>

    <h3>Auto-import watched folder</h3>
    <label>Watched folder:
      <input id="watchedFolderInput" value="${y(S())}" placeholder="/path/to/capture/folder" style="width:100%" />
    </label>
    <label>
      <input id="autoImportEnabledInput" type="checkbox" ${T()?"checked":""} />
      Enable auto-import polling every 5 seconds
    </label>
    <div class="import-actions">
      <button id="saveAutoImportSettingsBtn">Save settings</button>
      <button id="runAutoImportNowBtn">Run auto-import now</button>
    </div>
    <pre id="autoImportResult" class="muted"></pre>`),(e=document.getElementById("saveAutoImportSettingsBtn"))==null||e.addEventListener("click",()=>{const i=document.getElementById("watchedFolderInput").value.trim(),a=document.getElementById("autoImportEnabledInput").checked;z(i),K(a),J(),P("autoImportResult",`Saved. Watching: ${S()||"(none)"} (${a?"enabled":"disabled"})`)}),(t=document.getElementById("runAutoImportNowBtn"))==null||t.addEventListener("click",async()=>{await N(!0)}))}async function ne(){if(b="diagnostics",!g)return;const e=await u("diagnostics_health"),t=await u("diagnostics_report");g.innerHTML=L("Diagnostics",`<p>SQLite status: <strong>${e.status}</strong></p>
      <ul>
        <li>Queued jobs: ${t.queued_jobs}</li>
        <li>Failed jobs: ${t.failed_jobs}</li>
        <li>Resumable jobs: ${t.resumable_jobs}</li>
        <li>Missing exports: ${t.missing_markdown_exports}</li>
      </ul>`)}const O={archive:f,import:ee,export:te,settings:oe,diagnostics:ne};for(const e of document.querySelectorAll("#sidebar button"))e.addEventListener("click",async()=>{var i;const t=e.dataset.view||"archive";b=t,await((i=O[t])==null?void 0:i.call(O))});J();N(!1);f();
