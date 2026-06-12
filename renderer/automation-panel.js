// SessionForge Browser — Automation Panel UI
//
// A slide-out panel for building, saving, and running automation scripts.
// Each script is a list of steps; each step has an action + params.

const automationPanel = (() => {
  let panelEl = null;
  let currentSteps = [];
  let isRunning = false;

  const ACTION_DEFS = [
    { action: "click",            label: "Click",             fields: [{ key: "selector", label: "Element", placeholder: "Click 🎯 Pick to select", picker: true }, { key: "x", label: "X (optional)", type: "number" }, { key: "y", label: "Y (optional)", type: "number" }] },
    { action: "type",             label: "Type Text",         fields: [{ key: "selector", label: "Element", placeholder: "Click 🎯 Pick to select", picker: true }, { key: "text", label: "Text to type" }] },
    { action: "keystroke",        label: "Keystroke",         fields: [{ key: "keys", label: "Keys", placeholder: "Ctrl+A, Enter, Tab" }] },
    { action: "navigate",         label: "Navigate",          fields: [{ key: "url", label: "URL", placeholder: "https://example.com" }] },
    { action: "wait",             label: "Wait",              fields: [{ key: "ms", label: "Milliseconds", type: "number", placeholder: "1000" }] },
    { action: "waitForSelector",  label: "Wait for Element",  fields: [{ key: "selector", label: "Element", placeholder: "Click 🎯 Pick to select", picker: true }, { key: "timeout", label: "Timeout (ms)", type: "number", placeholder: "10000" }] },
    { action: "screenshot",       label: "Screenshot",        fields: [] },
    { action: "printPdf",         label: "Print to PDF",      fields: [] },
    { action: "scrollTo",         label: "Scroll To",         fields: [{ key: "x", label: "X", type: "number", placeholder: "0" }, { key: "y", label: "Y", type: "number", placeholder: "500" }] },
  ];

  // ── Element Picker ─────────────────────────────────────────────────────
  // Injects a visual picker into the active webview. User clicks an element
  // and we compute a readable, unique selector for it.
  let pickerCallback = null;

  function startPicker(onPicked) {
    const tab = state.tabs.find(t => t.id === state.activeTab);
    if (!tab) return;
    const wv = tab.webview;
    pickerCallback = onPicked;

    // Inject picker overlay into the webview
    wv.executeJavaScript(`
      (() => {
        if (window.__sfPickerActive) return;
        window.__sfPickerActive = true;

        const overlay = document.createElement('div');
        overlay.id = '__sf_picker_overlay';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;cursor:crosshair;';
        document.body.appendChild(overlay);

        const highlight = document.createElement('div');
        highlight.id = '__sf_picker_highlight';
        highlight.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483646;border:2px solid #6ea8ff;background:rgba(110,168,255,.15);border-radius:3px;transition:all .05s;display:none;';
        document.body.appendChild(highlight);

        const label = document.createElement('div');
        label.id = '__sf_picker_label';
        label.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;background:#0f1115;color:#e7ecf3;font:11px monospace;padding:3px 7px;border-radius:4px;white-space:nowrap;display:none;';
        document.body.appendChild(label);

        function bestSelector(el) {
          if (el.id) return '#' + CSS.escape(el.id);
          // Try unique attribute selectors
          for (const attr of ['name', 'data-testid', 'aria-label', 'placeholder', 'type']) {
            const val = el.getAttribute(attr);
            if (val) {
              const sel = el.tagName.toLowerCase() + '[' + attr + '=' + JSON.stringify(val) + ']';
              if (document.querySelectorAll(sel).length === 1) return sel;
            }
          }
          // nth-child path (last resort but always unique)
          const parts = [];
          let node = el;
          while (node && node !== document.body) {
            const parent = node.parentElement;
            if (!parent) break;
            const siblings = [...parent.children].filter(c => c.tagName === node.tagName);
            if (siblings.length > 1) {
              const idx = siblings.indexOf(node) + 1;
              parts.unshift(node.tagName.toLowerCase() + ':nth-of-type(' + idx + ')');
            } else {
              parts.unshift(node.tagName.toLowerCase());
            }
            node = parent;
            // Stop early if unique
            const candidate = parts.join(' > ');
            if (document.querySelectorAll(candidate).length === 1) return candidate;
          }
          return parts.join(' > ');
        }

        function describeEl(el) {
          let desc = el.tagName.toLowerCase();
          if (el.id) desc += '#' + el.id;
          else if (el.className && typeof el.className === 'string') desc += '.' + el.className.trim().split(/\\s+/).slice(0,2).join('.');
          const text = (el.textContent || '').trim().slice(0, 30);
          if (text) desc += ' "' + text + '"';
          return desc;
        }

        overlay.addEventListener('mousemove', (e) => {
          overlay.style.pointerEvents = 'none';
          const target = document.elementFromPoint(e.clientX, e.clientY);
          overlay.style.pointerEvents = '';
          if (!target || target === overlay || target === highlight) return;
          const rect = target.getBoundingClientRect();
          highlight.style.display = 'block';
          highlight.style.top = rect.top + 'px';
          highlight.style.left = rect.left + 'px';
          highlight.style.width = rect.width + 'px';
          highlight.style.height = rect.height + 'px';
          label.style.display = 'block';
          label.style.top = Math.max(0, rect.top - 22) + 'px';
          label.style.left = rect.left + 'px';
          label.textContent = describeEl(target);
        });

        overlay.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          overlay.style.pointerEvents = 'none';
          const target = document.elementFromPoint(e.clientX, e.clientY);
          overlay.style.pointerEvents = '';
          const selector = bestSelector(target);
          // Cleanup
          overlay.remove();
          highlight.remove();
          label.remove();
          window.__sfPickerActive = false;
          // Return result via console (captured by host)
          window.__sfPickerResult = selector;
        });

        // ESC to cancel
        document.addEventListener('keydown', function esc(e) {
          if (e.key === 'Escape') {
            overlay.remove(); highlight.remove(); label.remove();
            window.__sfPickerActive = false;
            window.__sfPickerResult = '';
            document.removeEventListener('keydown', esc);
          }
        });
      })()
    `);

    // Poll for result (webview doesn't have direct callback channel to renderer)
    const poll = setInterval(async () => {
      try {
        const result = await wv.executeJavaScript(`window.__sfPickerResult`);
        if (result !== undefined) {
          clearInterval(poll);
          await wv.executeJavaScript(`delete window.__sfPickerResult`);
          if (pickerCallback && result) pickerCallback(result);
          pickerCallback = null;
        }
      } catch { /* webview navigated or closed — stop polling */ clearInterval(poll); }
    }, 200);
  }

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
        const pickerBtn = f.picker
          ? `<button class="auto-pick-btn" data-step="${i}" data-key="${f.key}" title="Pick element visually">🎯 Pick</button>`
          : "";
        fieldsHtml += `<label class="auto-field-label">${f.label}
          <span class="auto-field-row">
            <input class="auto-field" data-key="${f.key}" type="${f.type || "text"}"
                   value="${val}" placeholder="${f.placeholder || ""}">
            ${pickerBtn}
          </span>
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

      // Picker buttons
      stepEl.querySelectorAll(".auto-pick-btn").forEach(btn => {
        btn.onclick = () => {
          const stepIdx = Number(btn.dataset.step);
          const key = btn.dataset.key;
          btn.textContent = "⏳ Picking…";
          startPicker((selector) => {
            currentSteps[stepIdx].params[key] = selector;
            renderSteps();
            log(`Picked: ${selector}`, "success");
          });
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
