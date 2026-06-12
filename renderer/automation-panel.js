// SessionForge Browser — Automation Panel UI
//
// A slide-out panel for building, saving, and running automation scripts.
// Each script is a list of steps; each step has an action + params.

const automationPanel = (() => {
  let panelEl = null;
  let currentSteps = [];
  let isRunning = false;

  const ACTION_DEFS = [
    { action: "click",            label: "Click",             fields: [{ key: "selector", label: "CSS Selector", placeholder: "#btn-login" }, { key: "x", label: "X (optional)", type: "number" }, { key: "y", label: "Y (optional)", type: "number" }] },
    { action: "type",             label: "Type Text",         fields: [{ key: "selector", label: "CSS Selector", placeholder: "input[name=email]" }, { key: "text", label: "Text to type" }] },
    { action: "keystroke",        label: "Keystroke",         fields: [{ key: "keys", label: "Keys", placeholder: "Ctrl+A, Enter, Tab" }] },
    { action: "navigate",         label: "Navigate",          fields: [{ key: "url", label: "URL", placeholder: "https://example.com" }] },
    { action: "wait",             label: "Wait",              fields: [{ key: "ms", label: "Milliseconds", type: "number", placeholder: "1000" }] },
    { action: "waitForSelector",  label: "Wait for Element",  fields: [{ key: "selector", label: "CSS Selector" }, { key: "timeout", label: "Timeout (ms)", type: "number", placeholder: "10000" }] },
    { action: "screenshot",       label: "Screenshot",        fields: [] },
    { action: "printPdf",         label: "Print to PDF",      fields: [] },
    { action: "scrollTo",         label: "Scroll To",         fields: [{ key: "x", label: "X", type: "number", placeholder: "0" }, { key: "y", label: "Y", type: "number", placeholder: "500" }] },
  ];

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
        <button class="auto-btn auto-run" title="Run script">▶ Run</button>
        <button class="auto-btn auto-save" title="Save script">💾 Save</button>
        <button class="auto-btn auto-load" title="Load script">📂 Load</button>
        <button class="auto-btn auto-clear" title="Clear steps">🗑 Clear</button>
      </div>
      <div class="auto-steps"></div>
      <div class="auto-add-step">
        <select class="auto-action-select">
          ${ACTION_DEFS.map(a => `<option value="${a.action}">${a.label}</option>`).join("")}
        </select>
        <button class="auto-btn auto-add-btn">+ Add Step</button>
      </div>
      <div class="auto-log"></div>
    `;
    document.getElementById("app").append(panelEl);

    // Wire events
    panelEl.querySelector(".auto-close").onclick = () => toggle(false);
    panelEl.querySelector(".auto-run").onclick = run;
    panelEl.querySelector(".auto-save").onclick = save;
    panelEl.querySelector(".auto-load").onclick = load;
    panelEl.querySelector(".auto-clear").onclick = () => { currentSteps = []; renderSteps(); };
    panelEl.querySelector(".auto-add-btn").onclick = addStep;
  }

  function toggle(show) {
    if (!panelEl) create();
    const visible = show ?? !panelEl.classList.contains("open");
    panelEl.classList.toggle("open", visible);
  }

  function addStep() {
    const action = panelEl.querySelector(".auto-action-select").value;
    const def = ACTION_DEFS.find(a => a.action === action);
    const params = {};
    def.fields.forEach(f => { params[f.key] = ""; });
    currentSteps.push({ action, params });
    renderSteps();
  }

  function renderSteps() {
    const container = panelEl.querySelector(".auto-steps");
    container.replaceChildren();

    currentSteps.forEach((step, i) => {
      const def = ACTION_DEFS.find(a => a.action === step.action);
      const stepEl = document.createElement("div");
      stepEl.className = "auto-step";
      stepEl.dataset.index = i;

      let fieldsHtml = "";
      def.fields.forEach(f => {
        const val = step.params[f.key] ?? "";
        fieldsHtml += `<label class="auto-field-label">${f.label}
          <input class="auto-field" data-key="${f.key}" type="${f.type || "text"}"
                 value="${val}" placeholder="${f.placeholder || ""}">
        </label>`;
      });

      stepEl.innerHTML = `
        <div class="auto-step-header">
          <span class="auto-step-num">${i + 1}</span>
          <span class="auto-step-label">${def.label}</span>
          <span class="auto-step-status"></span>
          <button class="auto-step-del" title="Remove step">×</button>
        </div>
        <div class="auto-step-fields">${fieldsHtml}</div>
      `;

      // Remove button
      stepEl.querySelector(".auto-step-del").onclick = () => {
        currentSteps.splice(i, 1);
        renderSteps();
      };

      // Field change bindings
      stepEl.querySelectorAll(".auto-field").forEach(input => {
        input.oninput = () => {
          const key = input.dataset.key;
          step.params[key] = input.type === "number" ? Number(input.value) : input.value;
        };
      });

      container.append(stepEl);
    });
  }

  function log(msg, type = "info") {
    const logEl = panelEl.querySelector(".auto-log");
    const line = document.createElement("div");
    line.className = `auto-log-line auto-log-${type}`;
    line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    logEl.append(line);
    logEl.scrollTop = logEl.scrollHeight;
  }

  async function run() {
    if (isRunning) return;
    if (!currentSteps.length) { log("No steps to run", "warn"); return; }
    isRunning = true;
    panelEl.querySelector(".auto-run").textContent = "⏸ Running…";
    log("Starting automation…", "info");

    // Clear previous statuses
    panelEl.querySelectorAll(".auto-step-status").forEach(el => { el.textContent = ""; el.className = "auto-step-status"; });

    try {
      await automation.runScript(currentSteps, (i, step, status, err) => {
        const statusEl = panelEl.querySelectorAll(".auto-step-status")[i];
        if (status === "running") {
          statusEl.textContent = "⏳";
          statusEl.className = "auto-step-status running";
          log(`Step ${i + 1}: ${step.action}…`);
        } else if (status === "done") {
          statusEl.textContent = "✓";
          statusEl.className = "auto-step-status done";
        } else if (status === "error") {
          statusEl.textContent = "✗";
          statusEl.className = "auto-step-status error";
          log(`Step ${i + 1} failed: ${err}`, "error");
        }
      });
      log("Automation complete!", "success");
    } catch (err) {
      log(`Stopped: ${err.message}`, "error");
    }

    isRunning = false;
    panelEl.querySelector(".auto-run").textContent = "▶ Run";
  }

  async function save() {
    const name = prompt("Script name:");
    if (!name) return;
    const filename = await window.api.saveScript(name, currentSteps);
    log(`Saved: ${filename}`, "success");
  }

  async function load() {
    const scripts = await window.api.listScripts();
    if (!scripts.length) { log("No saved scripts", "warn"); return; }

    const names = scripts.map((s, i) => `${i + 1}. ${s.name}`).join("\n");
    const pick = prompt(`Load which script?\n\n${names}\n\nEnter number:`);
    if (!pick) return;
    const idx = parseInt(pick, 10) - 1;
    if (idx < 0 || idx >= scripts.length) { log("Invalid selection", "warn"); return; }

    currentSteps = scripts[idx].steps;
    renderSteps();
    log(`Loaded: ${scripts[idx].name}`, "info");
  }

  return { toggle, create };
})();
