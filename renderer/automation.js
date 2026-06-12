// SessionForge Browser — Automation Engine (v2: coordinate-based)
//
// Records and replays user interactions by screen coordinates.
// Type action injects full text at once (supports 300+ char prompts).

const automation = (() => {

  function getActiveWebview() {
    const tab = state.tabs.find(t => t.id === state.activeTab);
    if (!tab) throw new Error("No active tab");
    return tab.webview;
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ── Action executors ──────────────────────────────────────────────────
  const actions = {
    async click(params) {
      const wv = getActiveWebview();
      const x = Math.round(params.x || 0);
      const y = Math.round(params.y || 0);
      await wv.executeJavaScript(`
        (() => {
          const x = ${x}, y = ${y};
          const el = document.elementFromPoint(x, y) || document.body;
          const opts = {
            clientX: x, clientY: y, screenX: x, screenY: y,
            bubbles: true, cancelable: true, view: window
          };
          el.dispatchEvent(new PointerEvent('pointerdown', opts));
          el.dispatchEvent(new MouseEvent('mousedown', opts));
          el.dispatchEvent(new PointerEvent('pointerup', opts));
          el.dispatchEvent(new MouseEvent('mouseup', opts));
          el.dispatchEvent(new MouseEvent('click', opts));
          if (el.focus) el.focus();
        })()
      `);
    },

    async type(params) {
      const wv = getActiveWebview();
      const text = params.text || "";
      // Inject the full text into the currently focused element.
      // Works with regular inputs, textareas, contentEditable, and
      // framework-controlled components (React, Vue, etc).
      await wv.executeJavaScript(`
        (() => {
          const text = ${JSON.stringify(text)};
          const el = document.activeElement;
          if (!el) return;

          if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
            // Use native setter to bypass React/Vue controlled component guards
            const proto = el.tagName === 'INPUT'
              ? window.HTMLInputElement.prototype
              : window.HTMLTextAreaElement.prototype;
            const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
            const curVal = el.value || '';
            const start = el.selectionStart ?? curVal.length;
            const end = el.selectionEnd ?? start;
            const newVal = curVal.slice(0, start) + text + curVal.slice(end);

            if (setter) setter.call(el, newVal);
            else el.value = newVal;

            el.selectionStart = el.selectionEnd = start + text.length;

            // Fire events that frameworks listen to
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            // React 16+ uses a synthetic event system; trigger native input event
            const nativeEvent = new InputEvent('input', {
              bubbles: true, cancelable: true, inputType: 'insertText', data: text
            });
            el.dispatchEvent(nativeEvent);
          } else if (el.isContentEditable) {
            // contentEditable (used by many modern editors like ProseMirror, Lexical)
            document.execCommand('insertText', false, text);
          } else {
            // Last resort: try the element that looks like an editor
            const editors = document.querySelectorAll(
              '[contenteditable="true"], textarea, input[type="text"], input:not([type])'
            );
            const last = editors[editors.length - 1];
            if (last) {
              last.focus();
              if (last.isContentEditable) {
                document.execCommand('insertText', false, text);
              } else {
                const setter2 = Object.getOwnPropertyDescriptor(
                  last.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value'
                )?.set;
                if (setter2) setter2.call(last, (last.value || '') + text);
                else last.value = (last.value || '') + text;
                last.dispatchEvent(new Event('input', { bubbles: true }));
                last.dispatchEvent(new Event('change', { bubbles: true }));
              }
            }
          }
        })()
      `);
    },

    async keystroke(params) {
      const wv = getActiveWebview();
      const keys = params.keys || "Enter";
      const parts = keys.split("+");
      const key = parts.pop();
      const mods = parts.map(m => m.toLowerCase());

      await wv.executeJavaScript(`
        (() => {
          const el = document.activeElement || document.body;
          const opts = {
            key: ${JSON.stringify(key)},
            code: ${JSON.stringify(key.length === 1 ? "Key" + key.toUpperCase() : key)},
            keyCode: ${key === "Enter" ? 13 : key === "Tab" ? 9 : key === "Escape" ? 27 : key === "Backspace" ? 8 : key.length === 1 ? key.charCodeAt(0) : 0},
            which: ${key === "Enter" ? 13 : key === "Tab" ? 9 : key === "Escape" ? 27 : key === "Backspace" ? 8 : key.length === 1 ? key.charCodeAt(0) : 0},
            ctrlKey: ${mods.includes("ctrl") || mods.includes("control")},
            shiftKey: ${mods.includes("shift")},
            altKey: ${mods.includes("alt")},
            metaKey: ${mods.includes("meta") || mods.includes("cmd")},
            bubbles: true, cancelable: true
          };
          el.dispatchEvent(new KeyboardEvent('keydown', opts));
          el.dispatchEvent(new KeyboardEvent('keypress', opts));
          el.dispatchEvent(new KeyboardEvent('keyup', opts));
          if (${JSON.stringify(key)} === 'Enter' && el.form) {
            el.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
          }
        })()
      `);
    },

    async navigate(params) {
      const wv = getActiveWebview();
      wv.loadURL(params.url);
      await new Promise(resolve => {
        wv.addEventListener("did-finish-load", resolve, { once: true });
      });
    },

    async wait(params) {
      await sleep(params.ms || 1000);
    },

    async screenshot(_params) {
      const wv = getActiveWebview();
      const image = await wv.capturePage();
      const pngBase64 = image.toPNG().toString("base64");
      return await window.api.saveScreenshot(pngBase64);
    },

    async printPdf(_params) {
      const wv = getActiveWebview();
      const data = await wv.printToPDF({});
      const pdfBase64 = Buffer.from(data).toString("base64");
      return await window.api.savePdf(pdfBase64);
    },

    async scroll(params) {
      const wv = getActiveWebview();
      await wv.executeJavaScript(`window.scrollBy(${params.dx || 0}, ${params.dy || 0})`);
    },
  };

  // ── Recording ─────────────────────────────────────────────────────────
  // New approach: we DON'T try to record keystrokes as text.
  // Instead we record clicks + special keys only. When the user stops
  // recording, we snapshot the value of whichever input was last focused
  // and create a "type" step with that full text. This means the user
  // can type, paste, autocomplete — whatever — and we capture the result.

  let recording = false;
  let recordedSteps = [];
  let recordListeners = null;

  function startRecording(onStep) {
    const tab = state.tabs.find(t => t.id === state.activeTab);
    if (!tab) return;
    const wv = tab.webview;
    recording = true;
    recordedSteps = [];

    wv.executeJavaScript(`
      (() => {
        if (window.__sfRecording) return;
        window.__sfRecording = true;
        window.__sfRecordQueue = [];
        window.__sfLastFocusedInput = null;
        window.__sfLastInputValueBefore = '';

        // Track which input the user interacts with
        document.addEventListener('focus', (e) => {
          const el = e.target;
          if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable) {
            // If we had a previous input that changed, save it
            if (window.__sfLastFocusedInput && window.__sfLastFocusedInput !== el) {
              const prev = window.__sfLastFocusedInput;
              const val = prev.isContentEditable ? prev.textContent : prev.value;
              if (val && val !== window.__sfLastInputValueBefore) {
                window.__sfRecordQueue.push({
                  action: 'type',
                  params: { text: val.slice(window.__sfLastInputValueBefore.length) },
                  ts: Date.now()
                });
              }
            }
            window.__sfLastFocusedInput = el;
            window.__sfLastInputValueBefore = el.isContentEditable ? el.textContent : (el.value || '');
          }
        }, true);

        document.addEventListener('click', (e) => {
          window.__sfRecordQueue.push({ action: 'click', params: { x: e.clientX, y: e.clientY }, ts: Date.now() });
        }, true);

        document.addEventListener('keydown', (e) => {
          if (['Control','Shift','Alt','Meta'].includes(e.key)) return;
          // Only record non-printable / modified keys
          if (e.key.length > 1 || e.ctrlKey || e.altKey || e.metaKey) {
            const mods = [];
            if (e.ctrlKey) mods.push('Ctrl');
            if (e.shiftKey) mods.push('Shift');
            if (e.altKey) mods.push('Alt');
            if (e.metaKey) mods.push('Cmd');
            mods.push(e.key);
            window.__sfRecordQueue.push({ action: 'keystroke', params: { keys: mods.join('+') }, ts: Date.now() });
          }
        }, true);
      })()
    `);

    recordListeners = setInterval(async () => {
      try {
        const events = await wv.executeJavaScript(`
          (() => {
            const q = window.__sfRecordQueue || [];
            window.__sfRecordQueue = [];
            return q;
          })()
        `);
        for (const ev of events) {
          recordedSteps.push(ev);
          if (onStep) onStep(ev);
        }
      } catch { /* ignore */ }
    }, 300);
  }

  function stopRecording() {
    recording = false;
    if (recordListeners) { clearInterval(recordListeners); recordListeners = null; }

    const tab = state.tabs.find(t => t.id === state.activeTab);
    if (!tab) return recordedSteps;

    // Flush: capture whatever text is in the last focused input
    tab.webview.executeJavaScript(`
      (() => {
        const el = window.__sfLastFocusedInput;
        if (el) {
          const val = el.isContentEditable ? el.textContent : (el.value || '');
          const before = window.__sfLastInputValueBefore || '';
          if (val && val !== before) {
            window.__sfRecordQueue = window.__sfRecordQueue || [];
            window.__sfRecordQueue.push({
              action: 'type',
              params: { text: val.slice(before.length) },
              ts: Date.now()
            });
          }
        }
        window.__sfRecording = false;
        const finalQ = window.__sfRecordQueue || [];
        window.__sfRecordQueue = [];
        delete window.__sfLastFocusedInput;
        delete window.__sfLastInputValueBefore;
        return finalQ;
      })()
    `).then((finalEvents) => {
      for (const ev of finalEvents) recordedSteps.push(ev);
    }).catch(() => {});

    // Give it a moment to flush, then return
    // (Caller should use the returned steps after a brief await)

    // Insert waits between steps based on timing gaps
    const withWaits = [];
    for (let i = 0; i < recordedSteps.length; i++) {
      if (i > 0 && recordedSteps[i].ts && recordedSteps[i - 1].ts) {
        const gap = recordedSteps[i].ts - recordedSteps[i - 1].ts;
        if (gap > 500) withWaits.push({ action: "wait", params: { ms: Math.min(gap, 5000) } });
      }
      const { ts, ...step } = recordedSteps[i];
      withWaits.push(step);
    }
    return withWaits;
  }

  function isRecording() { return recording; }

  // ── Script runner ─────────────────────────────────────────────────────
  async function runScript(steps, onStep) {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (onStep) onStep(i, step, "running");
      try {
        const executor = actions[step.action];
        if (!executor) throw new Error(`Unknown action: ${step.action}`);
        await executor(step.params || {});
        await sleep(150);
        if (onStep) onStep(i, step, "done");
      } catch (err) {
        if (onStep) onStep(i, step, "error", err.message);
        throw err;
      }
    }
  }

  return { actions, runScript, startRecording, stopRecording, isRecording, getActiveWebview };
})();
