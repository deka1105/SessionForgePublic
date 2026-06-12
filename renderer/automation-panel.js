// SessionForge Browser — Automation Panel UI (v2: coordinate-based + record)
//
// Record interactions → replay at same coordinates. No CSS selectors needed.
// Features: record, reorder steps, change step type, schedule runs.

const automationPanel = (() => {
  let panelEl = null;
  let currentSteps = [];
  let isRunning = false;
  let schedulerTimer = null;

  const ACTION_DEFS = [
    { action: "click",      label: "Click",       fields: [{ key: "x", label: "X", type: "number" }, { key: "y", label: "Y", type: "number" }] },
    { action: "type",       label: "Type",        fields: [{ key: "text", label: "Text" }] },
    { action: "keystroke",  label: "Key",         fields: [{ key: "keys", label: "Keys", placeholder: "Enter, Ctrl+A, Tab" }] },
    { action: "navigate",   label: "Go to URL",   fields: [{ key: "url", label: "URL", placeholder: "https://..." }] },
    { action: "wait",       label: "Wait",        fields: [{ key: "ms", label: "ms", type: "number", placeholder: "1000" }] },
    { action: "screenshot", label: "Screenshot",  fields: [] },
    { action: "printPdf",   label: "Print PDF",   fields: [] },
    { action: "scroll",     label: "Scroll",      fields: [{ key: "dx", label: "↔", type: "number", placeholder: "0" }, { key: "dy", label: "↕", type: "number", placeholder: "300" }] },
  ];

  // ── Custom prompt (replaces blocked window.prompt) ────────────────────
  function showPrompt(title, placeholder = "") {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "auto-prompt-overlay";
      overlay.innerHTML = `
        <div class="auto-prompt-box">
          <div class="auto-prompt-title">${title}</div>
          <input class="auto-prompt-input" type="text" placeholder="${placeholder}" autofocus>
          <div class="auto-prompt-actions">
            <button class="auto-prompt-cancel">Cancel</button>
            <button class="auto-prompt-ok">OK</button>
          </div>
        </div>
      `;
      document.body.append(overlay);

      const input = overlay.querySelector(".auto-prompt-input");
      const ok = () => { const val = input.value.trim(); overlay.remove(); resolve(val || null); };
      const cancel = () => { overlay.remove(); resolve(null); };

      overlay.querySelector(".auto-prompt-ok").onclick = ok;
      overlay.querySelector(".auto-prompt-cancel").onclick = cancel;
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") ok();
        if (e.key === "Escape") cancel();
      });
      setTimeout(() => input.focus(), 50);
    });
  }

  // ── Create panel ──────────────────────────────────────────────────────
  function create() {
    panelEl = document.createElement("aside");
    panelEl.id = "automationPanel";
    panelEl.className = "auto-panel";
    panelEl.innerHTML = `
      <header class="auto-header">
        <h3>Automation</h3>
        <button class="auto-close" title="Close panel">×</button>
      </header>
      <div class="auto-toolbar">
        <button class="auto-btn auto-record" title="Record interactions">⏺ Record</button>
        <button class="auto-btn auto-run" title="Run script">▶ Run</button>
        <button class="auto-btn auto-save" title="Save script">💾 Save</button>
        <button class="auto-btn auto-load" title="Load script">📂 Load</button>
        <button class="auto-btn auto-schedule" title="Schedule this script">⏰</button>
        <button class="auto-btn auto-multi" title="Run scripts on multiple identities">⚡ Multi</button>
        <button class="auto-btn auto-history" title="Run history">📜</button>
      </div>
      <div class="auto-steps"></div>
      <div class="auto-add-step">
        <select class="auto-action-select">
          ${ACTION_DEFS.map(a => `<option value="${a.action}">${a.label}</option>`).join("")}
        </select>
        <button class="auto-btn auto-add-btn">+ Add</button>
        <button class="auto-btn auto-clear-btn" title="Clear all steps">🗑</button>
      </div>
      <div class="auto-schedule-bar" style="display:none;">
        <span class="auto-schedule-info"></span>
        <button class="auto-btn auto-schedule-cancel">✕ Cancel</button>
      </div>
      <div class="auto-log"></div>
    `;
    document.getElementById("app").append(panelEl);

    panelEl.querySelector(".auto-close").onclick = () => toggle(false);
    panelEl.querySelector(".auto-record").onclick = toggleRecord;
    panelEl.querySelector(".auto-run").onclick = run;
    panelEl.querySelector(".auto-save").onclick = save;
    panelEl.querySelector(".auto-load").onclick = load;
    panelEl.querySelector(".auto-schedule").onclick = schedulePrompt;
    panelEl.querySelector(".auto-multi").onclick = openMultiRun;
    panelEl.querySelector(".auto-history").onclick = showRunHistory;
    panelEl.querySelector(".auto-add-btn").onclick = addStep;
    panelEl.querySelector(".auto-clear-btn").onclick = () => { currentSteps = []; renderSteps(); };
    panelEl.querySelector(".auto-schedule-cancel").onclick = cancelSchedule;
  }

  function toggle(show) {
    if (!panelEl) create();
    const visible = show ?? !panelEl.classList.contains("open");
    panelEl.classList.toggle("open", visible);
  }

  // ── Recording ─────────────────────────────────────────────────────────
  async function toggleRecord() {
    const btn = panelEl.querySelector(".auto-record");
    if (automation.isRecording()) {
      btn.textContent = "⏳ Saving…";
      document.body.classList.remove("is-recording");
      const steps = automation.stopRecording();
      await new Promise(r => setTimeout(r, 500));
      currentSteps.push(...steps);
      renderSteps();
      btn.textContent = "⏺ Record";
      btn.classList.remove("recording");
      log(`Recorded ${steps.length} steps`, "success");
    } else {
      automation.startRecording((ev) => {
        log(`Rec: ${ev.action} ${ev.params.x !== undefined ? `(${ev.params.x},${ev.params.y})` : (ev.params.keys || ev.params.text || "")}`, "info");
      });
      btn.textContent = "⏹ Stop";
      btn.classList.add("recording");
      document.body.classList.add("is-recording");
      log("Recording… interact with the page, then press Stop", "info");
    }
  }

  // ── Add step manually ─────────────────────────────────────────────────
  function addStep() {
    const action = panelEl.querySelector(".auto-action-select").value;
    const def = ACTION_DEFS.find(a => a.action === action);
    const params = {};
    def.fields.forEach(f => { params[f.key] = ""; });
    currentSteps.push({ action, params });
    renderSteps();
  }

  // ── Render steps ──────────────────────────────────────────────────────
  function renderSteps() {
    const container = panelEl.querySelector(".auto-steps");
    container.replaceChildren();

    currentSteps.forEach((step, i) => {
      const def = ACTION_DEFS.find(a => a.action === step.action);
      const stepEl = document.createElement("div");
      stepEl.className = "auto-step";
      stepEl.dataset.action = step.action;

      let summary = "";
      if (step.action === "click") summary = `(${step.params.x}, ${step.params.y})`;
      else if (step.action === "type") summary = `"${(step.params.text || "").slice(0, 20)}"`;
      else if (step.action === "keystroke") summary = step.params.keys || "";
      else if (step.action === "navigate") summary = (step.params.url || "").slice(0, 25);
      else if (step.action === "wait") summary = `${step.params.ms || 0}ms`;
      else if (step.action === "scroll") summary = `↕${step.params.dy || 0}`;

      let fieldsHtml = "";
      if (def) {
        def.fields.forEach(f => {
          const val = step.params[f.key] ?? "";
          fieldsHtml += `<label class="auto-field-label">${f.label}
            <input class="auto-field" data-key="${f.key}" type="${f.type || "text"}"
                   value="${val}" placeholder="${f.placeholder || ""}">
          </label>`;
        });
      }

      const actionOptions = ACTION_DEFS.map(a =>
        `<option value="${a.action}" ${a.action === step.action ? "selected" : ""}>${a.label}</option>`
      ).join("");

      stepEl.innerHTML = `
        <div class="auto-step-header">
          <span class="auto-step-num">${i + 1}</span>
          <select class="auto-step-type" title="Change step type">${actionOptions}</select>
          <span class="auto-step-summary">${summary}</span>
          <span class="auto-step-status"></span>
          <button class="auto-step-up" title="Move up" ${i === 0 ? "disabled" : ""}>↑</button>
          <button class="auto-step-down" title="Move down" ${i === currentSteps.length - 1 ? "disabled" : ""}>↓</button>
          <button class="auto-step-del" title="Remove">×</button>
        </div>
        <div class="auto-step-fields">${fieldsHtml}</div>
      `;

      stepEl.querySelector(".auto-step-type").onchange = (e) => {
        const newAction = e.target.value;
        const newDef = ACTION_DEFS.find(a => a.action === newAction);
        const newParams = {};
        newDef.fields.forEach(f => { newParams[f.key] = step.params[f.key] ?? ""; });
        currentSteps[i] = { action: newAction, params: newParams };
        renderSteps();
      };

      stepEl.querySelector(".auto-step-up").onclick = () => {
        if (i === 0) return;
        [currentSteps[i - 1], currentSteps[i]] = [currentSteps[i], currentSteps[i - 1]];
        renderSteps();
      };
      stepEl.querySelector(".auto-step-down").onclick = () => {
        if (i >= currentSteps.length - 1) return;
        [currentSteps[i], currentSteps[i + 1]] = [currentSteps[i + 1], currentSteps[i]];
        renderSteps();
      };

      stepEl.querySelector(".auto-step-del").onclick = () => {
        currentSteps.splice(i, 1);
        renderSteps();
      };

      stepEl.querySelectorAll(".auto-field").forEach(input => {
        input.oninput = () => {
          const key = input.dataset.key;
          step.params[key] = input.type === "number" ? Number(input.value) : input.value;
        };
      });

      container.append(stepEl);
    });
  }

  // ── Scheduling ────────────────────────────────────────────────────────
  async function schedulePrompt() {
    if (!currentSteps.length) { log("Add steps first", "warn"); return; }
    const input = await showPrompt(
      "Schedule automation:\n• 'in 5m' — run once in 5 minutes\n• '15:30' — run once at 3:30 PM\n• 'every 10m' — recurring\n• 'every day at 09:00'",
      "e.g. every 10m"
    );
    if (!input) return;
    const parsed = parseSchedule(input);
    if (!parsed) { log("Could not parse: " + input, "error"); return; }
    setSchedule(parsed);
  }

  function parseSchedule(input) {
    if (!input) return null;
    const v = input.trim().toLowerCase();

    // "in 5m" / "in 30s" / "in 2h" / "in 5 min"
    let m = v.match(/^in\s+(\d+)\s*(s(?:ec)?|m(?:in)?|h(?:r|our)?)\w*$/);
    if (m) return { type: "once", delay: parseInt(m[1]) * { s: 1000, m: 60000, h: 3600000 }[m[2][0]] };

    // "15:30" or "3:00pm"
    m = v.match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/);
    if (m) {
      let h = parseInt(m[1]); const min = parseInt(m[2]);
      if (m[3] === "pm" && h < 12) h += 12;
      if (m[3] === "am" && h === 12) h = 0;
      const now = new Date();
      const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, min);
      if (target <= now) target.setDate(target.getDate() + 1);
      return { type: "once", delay: target - now };
    }

    // "every 10m" / "every 5 min"
    m = v.match(/^every\s+(\d+)\s*(s(?:ec)?|m(?:in)?|h(?:r|our)?)\w*$/);
    if (m) return { type: "recurring", interval: parseInt(m[1]) * { s: 1000, m: 60000, h: 3600000 }[m[2][0]] };

    // "every day at 09:00"
    m = v.match(/^every\s+day\s+at\s+(\d{1,2}):(\d{2})$/);
    if (m) return { type: "daily", hours: parseInt(m[1]), minutes: parseInt(m[2]) };

    // Bare duration: "1m", "5min", "30s", "2h" → recurring
    m = v.match(/^(\d+)\s*(s(?:ec)?|m(?:in)?|h(?:r|our)?)\w*$/);
    if (m) return { type: "recurring", interval: parseInt(m[1]) * { s: 1000, m: 60000, h: 3600000 }[m[2][0]] };

    // Plain number: "10" → every 10 minutes
    m = v.match(/^(\d+)$/);
    if (m) return { type: "recurring", interval: parseInt(m[1]) * 60000 };

    return null;
  }

  function setSchedule(schedule) {
    cancelSchedule(true);
    const stepsSnapshot = JSON.parse(JSON.stringify(currentSteps));
    const bar = panelEl.querySelector(".auto-schedule-bar");
    const info = panelEl.querySelector(".auto-schedule-info");

    if (schedule.type === "once") {
      const when = new Date(Date.now() + schedule.delay);
      info.textContent = `Run at ${when.toLocaleTimeString()}`;
      bar.style.display = "flex";
      schedulerTimer = setTimeout(() => { log("Scheduled run…", "info"); runSteps(stepsSnapshot); bar.style.display = "none"; }, schedule.delay);
      log(`Scheduled for ${when.toLocaleTimeString()}`, "success");
    } else if (schedule.type === "recurring") {
      const label = schedule.interval >= 60000 ? `${schedule.interval / 60000}m` : `${schedule.interval / 1000}s`;
      info.textContent = `Every ${label}`;
      bar.style.display = "flex";
      schedulerTimer = setInterval(() => { log("Recurring run…", "info"); runSteps(stepsSnapshot); }, schedule.interval);
      log(`Recurring every ${label}`, "success");
    } else if (schedule.type === "daily") {
      const t = `${String(schedule.hours).padStart(2,"0")}:${String(schedule.minutes).padStart(2,"0")}`;
      info.textContent = `Daily at ${t}`;
      bar.style.display = "flex";
      schedulerTimer = setInterval(() => {
        const now = new Date();
        if (now.getHours() === schedule.hours && now.getMinutes() === schedule.minutes && now.getSeconds() < 30) {
          log("Daily run…", "info");
          runSteps(stepsSnapshot);
        }
      }, 30000);
      log(`Daily at ${t}`, "success");
    }
  }

  function cancelSchedule(silent) {
    if (schedulerTimer) { clearInterval(schedulerTimer); clearTimeout(schedulerTimer); schedulerTimer = null; }
    if (panelEl) panelEl.querySelector(".auto-schedule-bar").style.display = "none";
    if (!silent) log("Schedule cancelled", "info");
  }

  // ── Run ───────────────────────────────────────────────────────────────
  async function runSteps(steps) {
    try {
      await automation.runScript(steps, (i, step, status, err) => {
        if (!panelEl) return;
        const statusEls = panelEl.querySelectorAll(".auto-step-status");
        const statusEl = statusEls[i];
        if (!statusEl) return;
        if (status === "running") { statusEl.textContent = "⏳"; statusEl.className = "auto-step-status running"; }
        else if (status === "done") { statusEl.textContent = "✓"; statusEl.className = "auto-step-status done"; }
        else if (status === "error") { statusEl.textContent = "✗"; statusEl.className = "auto-step-status error"; log(`Step ${i+1}: ${err}`, "error"); }
      });
    } catch (e) { log(`Failed: ${e.message}`, "error"); }
  }

  async function run() {
    if (isRunning) return;
    if (!currentSteps.length) { log("No steps", "warn"); return; }
    isRunning = true;
    panelEl.querySelector(".auto-run").textContent = "⏸ Running…";
    panelEl.querySelectorAll(".auto-step-status").forEach(el => { el.textContent = ""; el.className = "auto-step-status"; });
    log("Running…", "info");
    await runSteps(currentSteps);
    isRunning = false;
    panelEl.querySelector(".auto-run").textContent = "▶ Run";
    log("Done!", "success");
  }

  // ── Save / Load / Gallery ──────────────────────────────────────────────
  async function save() {
    if (!currentSteps.length) { log("No steps to save", "warn"); return; }
    // Show a save form with metadata fields
    const overlay = document.createElement("div");
    overlay.className = "auto-prompt-overlay";
    overlay.innerHTML = `
      <div class="auto-prompt-box" style="width:380px;">
        <div class="auto-prompt-title">Save Script</div>
        <label style="display:block;font-size:11px;color:var(--muted);margin-bottom:4px;">Name</label>
        <input class="auto-prompt-input" id="save-name" placeholder="My Automation" autofocus>
        <label style="display:block;font-size:11px;color:var(--muted);margin:10px 0 4px;">Website</label>
        <input class="auto-prompt-input" id="save-website" placeholder="e.g. chatgpt.com, claude.ai">
        <label style="display:block;font-size:11px;color:var(--muted);margin:10px 0 4px;">Description</label>
        <textarea class="auto-prompt-input" id="save-desc" rows="2" style="resize:vertical;" placeholder="What does this script do?"></textarea>
        <div class="auto-prompt-actions">
          <button class="auto-prompt-cancel">Cancel</button>
          <button class="auto-prompt-ok">Save</button>
        </div>
      </div>
    `;
    document.body.append(overlay);

    const nameInput = overlay.querySelector("#save-name");
    setTimeout(() => nameInput.focus(), 50);

    await new Promise((resolve) => {
      overlay.querySelector(".auto-prompt-ok").onclick = async () => {
        const name = nameInput.value.trim();
        if (!name) { nameInput.style.borderColor = "var(--danger)"; return; }
        const website = overlay.querySelector("#save-website").value.trim();
        const description = overlay.querySelector("#save-desc").value.trim();
        const filename = await window.api.saveScript({ name, website, description, steps: currentSteps });
        overlay.remove();
        log(`Saved: ${name}`, "success");
        resolve();
      };
      overlay.querySelector(".auto-prompt-cancel").onclick = () => { overlay.remove(); resolve(); };
      nameInput.addEventListener("keydown", (e) => { if (e.key === "Escape") { overlay.remove(); resolve(); } });
    });
  }

  function load() {
    // Open the script gallery
    scriptGallery.toggle(true);
  }

  // Called by the gallery when user clicks "Use" on a script
  function loadSteps(steps, name) {
    currentSteps = JSON.parse(JSON.stringify(steps));
    renderSteps();
    log(`Loaded: ${name}`, "info");
  }

  // ── Log ───────────────────────────────────────────────────────────────
  function log(msg, type = "info") {
    if (!panelEl) return;
    const logEl = panelEl.querySelector(".auto-log");
    const line = document.createElement("div");
    line.className = `auto-log-line auto-log-${type}`;
    line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    logEl.append(line);
    logEl.scrollTop = logEl.scrollHeight;
  }

  // ── Run History ────────────────────────────────────────────────────────
  const runHistory = []; // [{timestamp, identity, tab, script, status, schedInput}]
  let lastUsedScript = "";

  function showRunHistory() {
    if (!panelEl) return;
    const existing = panelEl.querySelector(".run-history-panel");
    if (existing) { existing.remove(); return; }

    const panel = document.createElement("div");
    panel.className = "run-history-panel";
    panel.innerHTML = `<div class="rh-header"><h4>Run History</h4><button class="rh-close">×</button></div><div class="rh-list"></div>`;
    panel.querySelector(".rh-close").onclick = () => panel.remove();
    panelEl.append(panel);

    const list = panel.querySelector(".rh-list");
    if (!runHistory.length) { list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--muted);font-size:11px;">No runs yet</div>'; return; }

    for (const run of [...runHistory].reverse()) {
      const statusIcon = run.status === "waiting" ? "⏳" : run.status === "running" ? "⚙️" : run.status === "error" ? "✗" : "✓";
      const statusClass = `rh-status-${run.status || "complete"}`;
      const item = document.createElement("div");
      item.className = "rh-item";
      item.innerHTML = `
        <span class="rh-status-badge ${statusClass}">${statusIcon}</span>
        <span class="rh-identity">${run.identity || "?"}</span>
        <span class="rh-script">${run.script}</span>
        ${run.schedInput ? `<span class="rh-sched-label">${run.schedInput}</span>` : ""}
        <span class="rh-time">${new Date(run.timestamp).toLocaleTimeString()}</span>
      `;
      list.append(item);
    }
  }

  // ── Multi-Run: Identity → Tab → Script → Schedule per row ─────────────
  async function openMultiRun() {
    const scripts = await window.api.listScripts();
    if (!scripts.length) { log("Save some scripts first", "warn"); return; }

    const overlay = document.createElement("div");
    overlay.className = "auto-prompt-overlay";

    const scriptOptions = scripts.map(sc =>
      `<option value="${sc.filename}" ${sc.filename === lastUsedScript ? "selected" : ""}>${sc.name}</option>`
    ).join("");

    // Only show identities that have open tabs
    const identitiesWithTabs = state.sessions.filter(s => state.tabs.some(t => t.sessionId === s.id));
    if (!identitiesWithTabs.length) { log("No open tabs in any identity", "warn"); return; }

    const identityRows = identitiesWithTabs.map(s => {
      const identityTabs = state.tabs.filter(t => t.sessionId === s.id);
      const tabOptions = identityTabs.map(t =>
        `<option value="${t.id}">${(t.title || t.url).slice(0, 30)}</option>`
      ).join("");
      // Pre-select if only 1 tab
      const preSelected = identityTabs.length === 1;

      return `
        <div class="multi-row" data-session="${s.id}">
          <span class="multi-dot" style="background:${s.color}"></span>
          <span class="multi-name">${s.name}</span>
          <select class="multi-tab-select" data-session="${s.id}">
            ${preSelected ? "" : '<option value="">Tab…</option>'}
            ${tabOptions}
          </select>
          <select class="multi-script-select" data-session="${s.id}">
            <option value="">Script…</option>
            ${scriptOptions}
          </select>
          <input class="multi-sched-input" placeholder="now" title="Schedule (1m, every 5m, 15:30)">
          <button class="multi-remove" title="Remove">×</button>
        </div>
      `;
    }).join("");

    // Active schedules
    const activeScheds = Object.entries(state.tabSchedules || {}).map(([tabId, sched]) => {
      const tab = state.tabs.find(t => t.id === tabId);
      const identity = tab ? state.sessions.find(s => s.id === tab.sessionId) : null;
      return `<div class="multi-active-sched">
        <span class="multi-dot" style="background:${identity?.color || '#888'}"></span>
        <span>${identity?.name || "?"} → ${(tab?.title || "").slice(0,20)} → ${sched.scriptName} (${sched.schedInput})</span>
        <button class="multi-cancel-sched" data-tab="${tabId}">×</button>
      </div>`;
    }).join("");

    overlay.innerHTML = `
      <div class="auto-prompt-box" style="width:540px;">
        <div class="auto-prompt-title">Multi-Run</div>
        <div class="multi-col-headers"><span>Identity</span><span>Tab</span><span>Script</span><span>Schedule</span><span></span></div>
        <div class="multi-list">${identityRows}</div>
        ${activeScheds ? `<div class="multi-active-section"><label style="font-size:11px;color:var(--muted);display:block;margin-bottom:6px;">Active Schedules</label>${activeScheds}</div>` : ""}
        <div class="auto-prompt-actions">
          <button class="auto-prompt-cancel">Cancel</button>
          <button class="auto-btn" id="multi-history-btn">📜 History</button>
          <button class="auto-prompt-ok">Run</button>
        </div>
      </div>
    `;
    document.body.append(overlay);

    overlay.querySelectorAll(".multi-remove").forEach(btn => {
      btn.onclick = (e) => { e.stopPropagation(); btn.closest(".multi-row").remove(); };
    });
    overlay.querySelectorAll(".multi-cancel-sched").forEach(btn => {
      btn.onclick = () => {
        const tabId = btn.dataset.tab;
        if (state.tabSchedules[tabId]?.timer) { clearInterval(state.tabSchedules[tabId].timer); clearTimeout(state.tabSchedules[tabId].timer); }
        delete state.tabSchedules[tabId];
        btn.closest(".multi-active-sched").remove();
        renderSidebar();
        log("Schedule cancelled", "info");
      };
    });
    overlay.querySelector("#multi-history-btn").onclick = () => { overlay.remove(); showRunHistory(); };

    await new Promise((resolve) => {
      overlay.querySelector(".auto-prompt-cancel").onclick = () => { overlay.remove(); resolve(); };
      overlay.querySelector(".auto-prompt-ok").onclick = async () => {
        const rows = overlay.querySelectorAll(".multi-row");
        const assignments = [];
        for (const row of rows) {
          const sessionId = row.dataset.session;
          const tabId = row.querySelector(".multi-tab-select").value;
          const scriptFile = row.querySelector(".multi-script-select").value;
          const schedInput = row.querySelector(".multi-sched-input").value.trim() || "now";
          if (!scriptFile || !tabId) continue;
          const script = scripts.find(s => s.filename === scriptFile);
          if (!script?.steps) continue;
          lastUsedScript = scriptFile;
          assignments.push({ sessionId, tabId, steps: script.steps, scriptName: script.name, schedInput });
        }
        overlay.remove();
        if (!assignments.length) { log("No valid assignments", "warn"); resolve(); return; }

        const immediate = assignments.filter(a => a.schedInput === "now");
        const scheduled = assignments.filter(a => a.schedInput !== "now");

        if (immediate.length) await executeMultiRun(immediate);
        for (const a of scheduled) scheduleTabRun(a);
        resolve();
      };
    });
  }

  async function executeMultiRun(assignments) {
    log(`Multi-Run: ${assignments.length} tasks…`, "info");
    for (const a of assignments) {
      const histEntry = { timestamp: Date.now(), identity: state.sessions.find(s => s.id === a.sessionId)?.name, tab: state.tabs.find(t => t.id === a.tabId)?.title, script: a.scriptName, status: "running" };
      runHistory.push(histEntry);
    }

    const results = await automation.runMulti(assignments, (sessionId, scriptName, i, step, status, err) => {
      const identity = state.sessions.find(s => s.id === sessionId);
      if (status === "running") log(`[${identity?.name}] Step ${i+1}: ${step.action}…`);
      else if (status === "error") log(`[${identity?.name}] Step ${i+1}: ${err}`, "error");
    });

    for (const r of results) {
      const identity = state.sessions.find(s => s.id === r.sessionId);
      const histEntry = runHistory.find(h => h.script === r.scriptName && h.identity === identity?.name && h.status === "running");
      if (r.result === "done") {
        if (histEntry) { histEntry.status = "complete"; histEntry.timestamp = Date.now(); }
        log(`[${identity?.name}] ✓ ${r.scriptName} complete`, "success");
      } else {
        if (histEntry) { histEntry.status = "error"; }
        log(`[${identity?.name}] ✗ ${r.scriptName}: ${r.error}`, "error");
      }
    }
  }

  function scheduleTabRun(a) {
    const parsed = parseSchedule(a.schedInput);
    if (!parsed) { log(`Bad schedule "${a.schedInput}" for ${a.scriptName}`, "error"); return; }

    const identity = state.sessions.find(s => s.id === a.sessionId);
    const histEntry = { timestamp: Date.now(), identity: identity?.name, tab: state.tabs.find(t => t.id === a.tabId)?.title, script: a.scriptName, status: "waiting", schedInput: a.schedInput };
    runHistory.push(histEntry);

    const runFn = async () => {
      histEntry.status = "running";
      histEntry.timestamp = Date.now();
      if (state.tabSchedules[a.tabId]) state.tabSchedules[a.tabId].status = "running";
      renderSidebar();
      log(`[${identity?.name}] Running ${a.scriptName}…`, "info");
      const tab = state.tabs.find(t => t.id === a.tabId);
      if (!tab) { histEntry.status = "error"; return; }
      try {
        await automation.runScriptOnWebview(tab.webview, a.steps, null);
        histEntry.status = "complete";
        histEntry.timestamp = Date.now();
        if (state.tabSchedules[a.tabId]) state.tabSchedules[a.tabId].status = "waiting";
        renderSidebar();
        log(`[${identity?.name}] ✓ ${a.scriptName} done`, "success");
      } catch (e) {
        histEntry.status = "error";
        if (state.tabSchedules[a.tabId]) state.tabSchedules[a.tabId].status = "waiting";
        renderSidebar();
        log(`[${identity?.name}] ✗ ${a.scriptName}: ${e.message}`, "error");
      }
    };

    let timer;
    let nextRunAt = 0;
    let interval = 0;

    if (parsed.type === "once") {
      nextRunAt = Date.now() + parsed.delay;
      timer = setTimeout(() => { runFn(); delete state.tabSchedules[a.tabId]; renderSidebar(); }, parsed.delay);
      log(`Scheduled: ${a.scriptName} ${a.schedInput}`, "success");
    } else if (parsed.type === "recurring") {
      interval = parsed.interval;
      nextRunAt = Date.now() + interval;
      const wrappedRun = async () => { await runFn(); if (state.tabSchedules[a.tabId]) state.tabSchedules[a.tabId].nextRunAt = Date.now() + interval; };
      timer = setInterval(wrappedRun, interval);
      log(`Recurring: ${a.scriptName} ${a.schedInput}`, "success");
    } else if (parsed.type === "daily") {
      timer = setInterval(() => { const now = new Date(); if (now.getHours() === parsed.hours && now.getMinutes() === parsed.minutes && now.getSeconds() < 30) runFn(); }, 30000);
      log(`Daily: ${a.scriptName} at ${a.schedInput}`, "success");
    }

    state.tabSchedules[a.tabId] = { scriptName: a.scriptName, schedInput: a.schedInput, timer, status: "waiting", createdAt: Date.now(), nextRunAt, interval };
    renderSidebar();
  }

  return { toggle, create, loadSteps, showRunHistory };
})();
