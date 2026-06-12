// SessionForge Browser — Automation Engine
//
// Drives the active tab's <webview> with scripted actions:
//   click(selector | x,y)   — click an element or coordinate
//   type(selector, text)    — focus an element and type into it
//   keystroke(keys)         — send keyboard shortcuts (e.g. "Ctrl+A")
//   navigate(url)           — load a URL in the active tab
//   wait(ms)                — pause between steps
//   screenshot()            — capture the page and save to disk
//   printPdf()              — export the page as PDF
//   scrollTo(x, y)         — scroll to position
//   waitForSelector(sel)    — wait until an element appears (max 10s)

const automation = (() => {

  // ── Helpers ─────────────────────────────────────────────────────────────
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
      if (params.selector) {
        await wv.executeJavaScript(`
          (() => {
            const el = document.querySelector(${JSON.stringify(params.selector)});
            if (!el) throw new Error("Element not found: ${params.selector}");
            el.click();
          })()
        `);
      } else if (params.x !== undefined && params.y !== undefined) {
        await wv.executeJavaScript(`
          (() => {
            const el = document.elementFromPoint(${params.x}, ${params.y});
            if (el) el.click();
            else {
              const ev = new MouseEvent('click', { clientX: ${params.x}, clientY: ${params.y}, bubbles: true });
              document.elementFromPoint(${params.x}, ${params.y})?.dispatchEvent(ev)
                ?? document.body.dispatchEvent(ev);
            }
          })()
        `);
      }
    },

    async type(params) {
      const wv = getActiveWebview();
      await wv.executeJavaScript(`
        (() => {
          const el = document.querySelector(${JSON.stringify(params.selector)});
          if (!el) throw new Error("Element not found: ${params.selector}");
          el.focus();
          el.value = ${JSON.stringify(params.text)};
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        })()
      `);
    },

    async keystroke(params) {
      const wv = getActiveWebview();
      const keys = params.keys; // e.g. "Ctrl+A", "Enter", "Tab"
      const parts = keys.split("+");
      const key = parts.pop();
      const modifiers = parts.map(m => m.toLowerCase());

      const opts = {
        type: "keyDown",
        keyCode: key,
        key: key,
        modifiers: modifiers,
      };

      // Use Electron's webContents input event API via webview
      await wv.executeJavaScript(`
        (() => {
          const ev = new KeyboardEvent('keydown', {
            key: ${JSON.stringify(key)},
            code: ${JSON.stringify("Key" + key.toUpperCase())},
            ctrlKey: ${modifiers.includes("ctrl")},
            shiftKey: ${modifiers.includes("shift")},
            altKey: ${modifiers.includes("alt")},
            metaKey: ${modifiers.includes("meta") || modifiers.includes("cmd")},
            bubbles: true
          });
          document.activeElement.dispatchEvent(ev);
          // Also fire keyup
          const up = new KeyboardEvent('keyup', {
            key: ${JSON.stringify(key)},
            bubbles: true
          });
          document.activeElement.dispatchEvent(up);
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
      const saved = await window.api.saveScreenshot(pngBase64);
      return saved;
    },

    async printPdf(_params) {
      const wv = getActiveWebview();
      const data = await wv.printToPDF({});
      const pdfBase64 = Buffer.from(data).toString("base64");
      const saved = await window.api.savePdf(pdfBase64);
      return saved;
    },

    async scrollTo(params) {
      const wv = getActiveWebview();
      await wv.executeJavaScript(`window.scrollTo(${params.x || 0}, ${params.y || 0})`);
    },

    async waitForSelector(params) {
      const wv = getActiveWebview();
      const timeout = params.timeout || 10000;
      await wv.executeJavaScript(`
        new Promise((resolve, reject) => {
          const sel = ${JSON.stringify(params.selector)};
          if (document.querySelector(sel)) { resolve(); return; }
          const observer = new MutationObserver(() => {
            if (document.querySelector(sel)) { observer.disconnect(); resolve(); }
          });
          observer.observe(document.body, { childList: true, subtree: true });
          setTimeout(() => { observer.disconnect(); reject(new Error("Timeout waiting for " + sel)); }, ${timeout});
        })
      `);
    },
  };

  // ── Script runner ─────────────────────────────────────────────────────
  async function runScript(steps, onStep) {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (onStep) onStep(i, step, "running");
      try {
        const executor = actions[step.action];
        if (!executor) throw new Error(`Unknown action: ${step.action}`);
        await executor(step.params || {});
        if (onStep) onStep(i, step, "done");
      } catch (err) {
        if (onStep) onStep(i, step, "error", err.message);
        throw err;
      }
    }
  }

  return { actions, runScript, getActiveWebview };
})();
