// SessionForge Browser — renderer.
//
// Mental model
// ─────────────
//   sessions[]   identities the user has created. Each {id, name, color} maps
//                onto a Chromium partition: persist:<id>.  Cookies/storage
//                are isolated *per session*.
//   tabs[]       open tabs. Each tab is bound to exactly one session — its
//                <webview> uses that session's partition. Two tabs can point
//                at the same URL but use different sessions, giving you two
//                independent logins to the same site.
//
// We keep one <webview> element per tab and toggle CSS visibility to switch.
// That preserves each tab's scroll/state across tab switches.

const $  = id => document.getElementById(id);
const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  for (const k of kids) e.append(k);
  return e;
};

const state = {
  sessions:        [],   // [{id, name, color}]
  tabs:            [],   // [{id, sessionId, url, title, webview}]
  activeTab:       null, // tab id
  lastTabPerSess:  {},   // sessionId → most-recently-activated tab id
  editingSessionId: null, // when the identity modal is open in "edit" mode
};

const DEFAULT_HOME = "https://duckduckgo.com";

// ── persistence ──────────────────────────────────────────────────────────
async function loadSessions() {
  state.sessions = await window.api.listSessions();
  renderSidebar();
}

async function persistSessions() {
  await window.api.saveSessions(state.sessions);
}

// Tabs are persisted to localStorage so that relaunching the app restores the
// same set of open pages per identity. We store only {sessionId, url, title}
// — tab ids are regenerated on each load. activeIndex points at the entry
// that should be focused after restore.
const TABS_KEY = "sfox.tabs";

function persistTabs() {
  const payload = {
    tabs: state.tabs.map(t => ({
      sessionId: t.sessionId, url: t.url, title: t.title, favicon: t.favicon ?? null,
    })),
    activeIndex: state.tabs.findIndex(t => t.id === state.activeTab),
  };
  localStorage.setItem(TABS_KEY, JSON.stringify(payload));
}

function restoreTabs() {
  let raw;
  try { raw = localStorage.getItem(TABS_KEY); } catch { return; }
  if (!raw) return;
  let saved;
  try { saved = JSON.parse(raw); } catch { return; }
  if (!saved?.tabs?.length) return;

  // Only restore tabs whose identity still exists; orphans (identity deleted
  // in a prior run) are silently dropped.
  const validSessionIds = new Set(state.sessions.map(s => s.id));
  const wanted = saved.tabs.filter(t => validSessionIds.has(t.sessionId));
  if (!wanted.length) return;

  for (const t of wanted) {
    openTab(t.sessionId, t.url);
    const last = state.tabs[state.tabs.length - 1];
    if (last && t.title && t.title !== "Loading…") last.title = t.title;
    if (last && t.favicon) last.favicon = t.favicon;
  }
  renderTabs();
  renderSidebar();    // refresh tiles with restored favicons

  // Re-focus the previously active tab if possible. activeIndex is in the
  // *original* saved array; map it back to the filtered+opened set.
  const wantedActive = saved.tabs[saved.activeIndex];
  if (wantedActive) {
    const filteredIdx = wanted.indexOf(wantedActive);
    if (filteredIdx >= 0 && state.tabs[filteredIdx]) {
      activateTab(state.tabs[filteredIdx].id);
    }
  }
}

// ── sidebar tree (identity → open tabs) ──────────────────────────────────
function renderSidebar() {
  const ul = $("sessionList");
  ul.replaceChildren();
  for (const s of state.sessions) {
    const identityTabs = state.tabs.filter(t => t.sessionId === s.id);
    const isExpanded = state.sidebarExpanded?.[s.id] !== false; // default expanded

    const dot = el("span", { className: "swatch" });
    dot.style.setProperty("--swatch-color", s.color);

    const tabForFavicon =
      state.tabs.find(t => t.id === state.lastTabPerSess[s.id]) ??
      state.tabs.find(t => t.sessionId === s.id);
    if (tabForFavicon?.favicon) {
      dot.append(el("img", { className: "sess-favicon", src: tabForFavicon.favicon, alt: "" }));
    }

    // Identity header row
    const chevron = el("span", { className: "tree-chevron", textContent: isExpanded ? "⌄" : "›" });
    const tabCount = el("span", { className: "tree-count", textContent: `${identityTabs.length}` });

    const header = el("div", { className: "sess-item tree-header" },
      chevron,
      dot,
      el("span", { className: "sess-name", textContent: s.name }),
      tabCount,
      el("button", { className: "sess-add", title: `New tab in "${s.name}"`, textContent: "+",
                     onclick: e => { e.stopPropagation(); openTab(s.id); } }),
      el("button", { className: "sess-export", title: "Export identity", textContent: "↑",
                     onclick: e => { e.stopPropagation(); window.api.exportIdentity(s.id); } }),
      el("button", { className: "sess-edit", title: "Rename or recolour", textContent: "✎",
                     onclick: e => { e.stopPropagation(); openSessionModal({ editingId: s.id }); } }),
      el("button", { className: "sess-x", title: "Delete identity", textContent: "×",
                     onclick: e => { e.stopPropagation(); deleteSession(s.id); } }),
    );

    header.onclick = () => {
      if (!state.sidebarExpanded) state.sidebarExpanded = {};
      state.sidebarExpanded[s.id] = !isExpanded;
      renderSidebar();
    };

    // Drag-tab-onto-identity to rebind
    header.addEventListener("dragover", (e) => { e.preventDefault(); header.classList.add("drop-target"); });
    header.addEventListener("dragleave", () => header.classList.remove("drop-target"));
    header.addEventListener("drop", (e) => {
      e.preventDefault();
      header.classList.remove("drop-target");
      const tabId = e.dataTransfer.getData("text/plain");
      rebindTab(tabId, s.id);
    });

    const li = el("li", { className: "tree-node" });
    li.append(header);

    // Tab children (nested under the identity)
    if (isExpanded && identityTabs.length > 0) {
      const tabList = el("ul", { className: "tree-tabs" });
      for (const t of identityTabs) {
        const isActive = t.id === state.activeTab;
        const sched = state.tabSchedules?.[t.id];

        // Build schedule badge with icon, tooltip, and countdown
        const schedBadgeElements = [];
        if (sched) {
          const isRunning = sched.status === "running";
          let icon = isRunning ? "⏳" : "🕐";
          let tooltip = `${sched.scriptName} — ${isRunning ? "Running…" : sched.schedInput}`;
          let countdownText = "";

          if (!isRunning && sched.nextRunAt) {
            const remaining = Math.max(0, Math.round((sched.nextRunAt - Date.now()) / 1000));
            if (remaining <= 60 && remaining > 0) {
              countdownText = `${remaining}s`;
              tooltip = `${sched.scriptName} — in ${remaining}s`;
            }
          }

          const badge = el("span", {
            className: "tree-tab-sched-badge" + (isRunning ? " running" : ""),
            textContent: icon + (countdownText ? " " + countdownText : ""),
            title: tooltip,
          });
          schedBadgeElements.push(badge);
        }

        const tabItem = el("li", {
          className: "tree-tab" + (isActive ? " active" : ""),
          title: t.url,
        },
          el("span", { className: "tree-tab-title", textContent: t.title || t.url.slice(0, 25) }),
          ...schedBadgeElements,
          el("button", { className: "tree-tab-sched", title: "Schedule script on this tab", textContent: "⏰",
            onclick: (e) => { e.stopPropagation(); openTabSchedule(t.id, s.id); }
          }),
          el("button", { className: "tree-tab-close", title: "Close tab", textContent: "×",
            onclick: (e) => { e.stopPropagation(); closeTab(t.id); }
          }),
        );
        tabItem.onclick = () => activateTab(t.id);
        tabList.append(tabItem);
      }
      li.append(tabList);
    }

    // Empty state: an identity with no open tabs still needs an obvious way
    // to open one (e.g. after all its tabs were closed, or a fresh restore).
    if (isExpanded && identityTabs.length === 0) {
      const emptyList = el("ul", { className: "tree-tabs" });
      const openRow = el("li", { className: "tree-tab tree-tab-open", title: `Open a new tab in "${s.name}"` },
        el("span", { className: "tree-tab-title", textContent: "+ Open a tab" }),
      );
      openRow.onclick = () => openTab(s.id);
      emptyList.append(openRow);
      li.append(emptyList);
    }

    ul.append(li);
  }
}

// Per-tab scheduling state: { [tabId]: { scriptName, schedule, timer } }
if (!state.sidebarExpanded) state.sidebarExpanded = {};
if (!state.tabSchedules) state.tabSchedules = {};

// Refresh sidebar every second when schedules are active (for countdown display)
setInterval(() => {
  if (Object.keys(state.tabSchedules).length > 0) renderSidebar();
}, 1000);

async function openTabSchedule(tabId, sessionId) {
  const scripts = await window.api.listScripts();
  if (!scripts.length) { alert("Save some scripts first"); return; }

  const overlay = document.createElement("div");
  overlay.className = "auto-prompt-overlay";
  const options = scripts.map(sc => `<option value="${sc.filename}">${sc.name}</option>`).join("");

  overlay.innerHTML = `
    <div class="auto-prompt-box" style="width:360px;">
      <div class="auto-prompt-title">Schedule Script on This Tab</div>
      <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px;">Script</label>
      <select class="auto-prompt-input" id="ts-script">${options}</select>
      <label style="font-size:11px;color:var(--muted);display:block;margin:10px 0 4px;">Schedule</label>
      <input class="auto-prompt-input" id="ts-schedule" placeholder="e.g. every 10m, in 5m, 15:30">
      <div class="auto-prompt-actions">
        <button class="auto-prompt-cancel">Cancel</button>
        <button class="auto-prompt-ok">Schedule</button>
      </div>
    </div>
  `;
  document.body.append(overlay);

  await new Promise((resolve) => {
    overlay.querySelector(".auto-prompt-cancel").onclick = () => { overlay.remove(); resolve(); };
    overlay.querySelector(".auto-prompt-ok").onclick = () => {
      const filename = overlay.querySelector("#ts-script").value;
      const schedInput = overlay.querySelector("#ts-schedule").value.trim();
      overlay.remove();
      if (!filename || !schedInput) { resolve(); return; }

      const script = scripts.find(s => s.filename === filename);
      if (!script?.steps) { resolve(); return; }

      scheduleOnTab(tabId, sessionId, script, schedInput);
      resolve();
    };
  });
}

function scheduleOnTab(tabId, sessionId, script, schedInput) {
  const parsed = parseScheduleStr(schedInput);
  if (!parsed) return;

  // Cancel existing schedule on this tab
  if (state.tabSchedules[tabId]?.timer) {
    clearInterval(state.tabSchedules[tabId].timer);
    clearTimeout(state.tabSchedules[tabId].timer);
  }

  const tab = state.tabs.find(t => t.id === tabId);
  if (!tab) return;

  const runOnce = () => {
    const wv = tab.webview;
    automation.runScriptOnWebview(wv, script.steps, null);
  };

  let timer;
  if (parsed.type === "once") {
    timer = setTimeout(() => { runOnce(); delete state.tabSchedules[tabId]; renderSidebar(); }, parsed.delay);
  } else if (parsed.type === "recurring") {
    timer = setInterval(runOnce, parsed.interval);
  } else if (parsed.type === "daily") {
    timer = setInterval(() => {
      const now = new Date();
      if (now.getHours() === parsed.hours && now.getMinutes() === parsed.minutes && now.getSeconds() < 30) runOnce();
    }, 30000);
  }

  state.tabSchedules[tabId] = { scriptName: script.name, schedInput, timer };
  renderSidebar();
}

function parseScheduleStr(input) {
  let m = input.match(/^in\s+(\d+)\s*(s|m|h)$/i);
  if (m) return { type: "once", delay: parseInt(m[1]) * { s: 1000, m: 60000, h: 3600000 }[m[2].toLowerCase()] };
  m = input.match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/i);
  if (m) {
    let h = parseInt(m[1]); const min = parseInt(m[2]);
    if (m[3]?.toLowerCase() === "pm" && h < 12) h += 12;
    if (m[3]?.toLowerCase() === "am" && h === 12) h = 0;
    const now = new Date();
    const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, min);
    if (target <= now) target.setDate(target.getDate() + 1);
    return { type: "once", delay: target - now };
  }
  m = input.match(/^every\s+(\d+)\s*(s|m|h)$/i);
  if (m) return { type: "recurring", interval: parseInt(m[1]) * { s: 1000, m: 60000, h: 3600000 }[m[2].toLowerCase()] };
  m = input.match(/^every\s+day\s+at\s+(\d{1,2}):(\d{2})$/i);
  if (m) return { type: "daily", hours: parseInt(m[1]), minutes: parseInt(m[2]) };
  return null;
}

async function createSession(name, color) {
  const id = crypto.randomUUID().slice(0, 8);
  state.sessions.push({ id, name, color });
  await persistSessions();
  renderSidebar();
  return id;
}

async function deleteSession(id) {
  if (!confirm("Delete this identity?  All its cookies and logins will be wiped.")) return;
  // Close any open tabs bound to this identity first.
  for (const t of [...state.tabs]) if (t.sessionId === id) closeTab(t.id);
  state.sessions = state.sessions.filter(s => s.id !== id);
  await persistSessions();
  await window.api.clearSession(id);
  renderSidebar();
}

// ── tabs ─────────────────────────────────────────────────────────────────
function openTab(sessionId, url = DEFAULT_HOME) {
  const id      = crypto.randomUUID().slice(0, 8);
  const session = state.sessions.find(s => s.id === sessionId);
  if (!session) return;

  // A <webview> can't change its `partition` after attach, so we set it now.
  const wv = document.createElement("webview");
  wv.setAttribute("partition", `persist:${sessionId}`);
  wv.setAttribute("src", url);
  wv.setAttribute("allowpopups", "");
  wv.className = "view";
  $("viewHost").append(wv);

  const tab = { id, sessionId, url, title: "Loading…", favicon: null, webview: wv };
  state.tabs.push(tab);

  // Wire up webview events so the URL bar + tab title track navigation.
  // Each event persists tabs so a relaunch restores the latest URL/title.
  wv.addEventListener("page-title-updated",  e => { tab.title = e.title; renderTabs(); persistTabs(); });
  wv.addEventListener("did-navigate",        e => { tab.url = e.url; if (id === state.activeTab) $("urlInput").value = e.url; persistTabs(); recordHistory(sessionId, e.url, tab.title); });
  wv.addEventListener("did-navigate-in-page",e => { tab.url = e.url; if (id === state.activeTab) $("urlInput").value = e.url; persistTabs(); });
  wv.addEventListener("page-favicon-updated",e => { tab.favicon = e.favicons?.[0] ?? null; renderSidebar(); persistTabs(); });
  wv.addEventListener("found-in-page", e => {
    if (id === state.activeTab && e.result) {
      $("findCount").textContent = `${e.result.activeMatchOrdinal}/${e.result.matches}`;
    }
  });

  activateTab(id);
  persistTabs();
}

function activateTab(id) {
  state.activeTab = id;
  for (const t of state.tabs) t.webview.classList.toggle("active", t.id === id);
  const t = state.tabs.find(t => t.id === id);
  if (t) {
    state.lastTabPerSess[t.sessionId] = id;  // remember focus per identity
    $("urlInput").value = t.url;
    const s = state.sessions.find(s => s.id === t.sessionId);
    if (s) {
      $("sessionChip").textContent      = s.name;
      $("sessionChip").style.background = s.color + "22";  // 13% alpha
      $("sessionChip").style.color      = s.color;
    }
  }
  $("emptyState").hidden = state.tabs.length > 0;
  renderTabs();
  renderSidebar();   // keep tree counts / active highlight / empty states fresh
  renderBookmarksBar();
  persistTabs();
}

/**
 * Sidebar click handler.
 *
 * Clicking an identity should *switch to* that identity's session, not blow
 * away the user's place. So we activate the tab they were last on for that
 * identity. Only if there are no tabs for the identity do we open a fresh one.
 */
function focusIdentity(sessionId) {
  const lastId  = state.lastTabPerSess[sessionId];
  const lastTab = lastId && state.tabs.find(t => t.id === lastId);
  if (lastTab) { activateTab(lastTab.id); return; }

  const anyTab = state.tabs.find(t => t.sessionId === sessionId);
  if (anyTab) { activateTab(anyTab.id); return; }

  openTab(sessionId);
}

function closeTab(id) {
  const i = state.tabs.findIndex(t => t.id === id);
  if (i < 0) return;
  const closing = state.tabs[i];
  closing.webview.remove();
  state.tabs.splice(i, 1);

  // Drop the last-focus pointer if it pointed at the closed tab; fall back
  // to any other tab for the same identity if one survives.
  if (state.lastTabPerSess[closing.sessionId] === id) {
    const sibling = state.tabs.find(t => t.sessionId === closing.sessionId);
    if (sibling) state.lastTabPerSess[closing.sessionId] = sibling.id;
    else delete state.lastTabPerSess[closing.sessionId];
  }

  if (state.activeTab === id) {
    state.activeTab = state.tabs[i]?.id ?? state.tabs[i - 1]?.id ?? null;
  }
  if (state.activeTab) activateTab(state.activeTab);
  else { $("urlInput").value = ""; $("sessionChip").textContent = ""; $("emptyState").hidden = false; }
  renderTabs();
  renderSidebar();
  persistTabs();
}

function renderTabs() {
  const root = $("tabs");
  root.replaceChildren();

  // Group tabs by identity (preserving within-group order).
  const groups = new Map();
  for (const t of state.tabs) {
    if (!groups.has(t.sessionId)) groups.set(t.sessionId, []);
    groups.get(t.sessionId).push(t);
  }

  for (const [sessionId, tabs] of groups) {
    const s = state.sessions.find(s => s.id === sessionId);

    // Identity group container
    const group = el("div", { className: "tab-group" });
    group.style.setProperty("--group-color", s?.color ?? "var(--accent)");

    // Group header: identity name + add-tab-in-group button
    const header = el("div", { className: "tab-group-header" },
      el("span", { className: "tab-group-dot" }),
      el("span", { className: "tab-group-name", textContent: s?.name ?? "?" }),
      el("button", {
        className: "tab-group-add", title: `New tab in "${s?.name}"`, textContent: "+",
        onclick: e => { e.stopPropagation(); openTab(sessionId); },
      }),
    );
    group.append(header);

    // Individual tabs in this group
    for (const t of tabs) {
      const node = el("div", {
        className: "tab" + (t.id === state.activeTab ? " active" : ""),
        title:     `${s?.name ?? "?"} — ${t.url}`,
        draggable: true,
        onclick:   () => activateTab(t.id),
      },
        el("span",   { className: "tab-title", textContent: t.title || t.url }),
        el("button", { className: "tab-x", textContent: "×",
                       onclick: e => { e.stopPropagation(); closeTab(t.id); } }),
      );
      node.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/plain", t.id);
        e.dataTransfer.effectAllowed = "move";
      });
      group.append(node);
    }

    root.append(group);
  }
}

// ── URL bar ──────────────────────────────────────────────────────────────
function navigate(rawInput) {
  const url = normalizeUrl(rawInput);
  const t   = state.tabs.find(t => t.id === state.activeTab);
  if (t) {
    t.webview.loadURL(url);
    t.url = url;
    persistTabs();
    return;
  }
  // No active tab — open a fresh one. Pick the most recently focused
  // identity if any; otherwise the first identity in the sidebar.
  const recentSess = Object.keys(state.lastTabPerSess)[0];
  const sid = recentSess ?? state.sessions[0]?.id;
  if (sid) openTab(sid, url);
}

function normalizeUrl(input) {
  const v = input.trim();
  if (/^https?:\/\//i.test(v))       return v;
  if (/^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(v)) return "https://" + v;   // looks like a domain
  return "https://duckduckgo.com/?q=" + encodeURIComponent(v);        // fall through to search
}

// ── identity modal (create + edit) ───────────────────────────────────────
// One dialog serves both flows. `editingId` toggles between them: when set,
// the modal pre-fills with that identity's name/color and "Create" becomes
// "Save". `state.editingSessionId` is the source of truth the submit handler
// consults to decide which branch to take.
function openSessionModal({ editingId = null } = {}) {
  state.editingSessionId = editingId;
  const s = editingId ? state.sessions.find(s => s.id === editingId) : null;

  $("sessionModalTitle").textContent = s ? "Edit Identity" : "New Identity";
  $("createSessionBtn").textContent  = s ? "Save"          : "Create";
  $("newSessionName").value          = s?.name  ?? "";
  $("newSessionColor").value         = s?.color ?? randomColor();
  $("newSessionModal").showModal();
}

async function updateSession(id, name, color) {
  const s = state.sessions.find(s => s.id === id);
  if (!s) return;
  s.name  = name;
  s.color = color;
  await persistSessions();
  renderSidebar();
  renderTabs();                                  // tab dots use s.color
  if (state.activeTab) activateTab(state.activeTab);  // refresh chip
}

$("newSessionBtn").onclick = () => openSessionModal();

// Clear edit mode whenever the dialog closes (cancel, ESC, or submit).
$("newSessionModal").addEventListener("close", () => {
  state.editingSessionId = null;
});

$("newSessionForm").addEventListener("submit", async (e) => {
  // dialog form auto-closes; we only act on the "ok" path.
  if ($("newSessionForm").returnValue !== "ok" &&
      e.submitter?.value !== "ok") return;
  const name  = $("newSessionName").value.trim();
  const color = $("newSessionColor").value;
  if (!name) return;

  if (state.editingSessionId) {
    await updateSession(state.editingSessionId, name, color);
  } else {
    const id = await createSession(name, color);
    openTab(id);
  }
});

function randomColor() {
  const palette = ["#6ea8ff","#4ade80","#facc15","#f472b6","#fb923c","#a78bfa","#22d3ee"];
  return palette[Math.floor(Math.random() * palette.length)];
}

// ── event wiring ─────────────────────────────────────────────────────────
$("newTabBtn").onclick = () => {
  // New tab uses the current active tab's identity, or the first identity.
  const sid = state.tabs.find(t => t.id === state.activeTab)?.sessionId ?? state.sessions[0]?.id;
  if (sid) openTab(sid);
};

$("backBtn").onclick   = () => state.tabs.find(t => t.id === state.activeTab)?.webview.goBack();
$("fwdBtn").onclick    = () => state.tabs.find(t => t.id === state.activeTab)?.webview.goForward();
$("reloadBtn").onclick = () => state.tabs.find(t => t.id === state.activeTab)?.webview.reload();

$("urlInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") navigate($("urlInput").value);
});

$("cloneBtn").onclick = async () => {
  // "Clone in new identity" — same URL, brand-new partition, fresh login state.
  const t = state.tabs.find(t => t.id === state.activeTab);
  if (!t) return;
  const name = prompt("Name for the new identity?", "Clone of " + (state.sessions.find(s => s.id === t.sessionId)?.name ?? ""));
  if (!name) return;
  const id = await createSession(name, randomColor());
  openTab(id, t.url);
};

// ── sidebar collapse ─────────────────────────────────────────────────────
// Always boot expanded — a launch where the sidebar is hidden looks broken
// (identities seem missing). The toggle only applies within the running
// session, which keeps the affordance discoverable.
function setSidebarCollapsed(collapsed) {
  document.getElementById("app").classList.toggle("sidebar-collapsed", collapsed);
  $("sidebarToggle").textContent = collapsed ? "›" : "‹";
}

$("sidebarToggle").onclick = () => {
  const isCollapsed = document.getElementById("app").classList.contains("sidebar-collapsed");
  setSidebarCollapsed(!isCollapsed);
};

// ⌘B / Ctrl+B — toggle sidebar.
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
    e.preventDefault();
    $("sidebarToggle").click();
  }
});

// Clear any legacy persisted collapse state from earlier builds.
localStorage.removeItem("sfox.sidebarCollapsed");

// ── automation panel toggle ─────────────────────────────────────────────
$("automationBtn").onclick = () => automationPanel.toggle();

// ⌘⇧A / Ctrl+Shift+A — toggle automation panel.
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "a") {
    e.preventDefault();
    automationPanel.toggle();
  }
});

// ── drag-tab-onto-identity (rebind) ──────────────────────────────────────
function rebindTab(tabId, newSessionId) {
  const tab = state.tabs.find(t => t.id === tabId);
  if (!tab || tab.sessionId === newSessionId) return;
  const url = tab.url;
  closeTab(tabId);
  openTab(newSessionId, url);
}

// ── bookmarks (per-identity) ─────────────────────────────────────────────
async function renderBookmarksBar() {
  const bar = $("bookmarksBar");
  bar.replaceChildren();
  const t = state.tabs.find(t => t.id === state.activeTab);
  if (!t) return;
  const bookmarks = await window.api.getBookmarks(t.sessionId);
  for (const bm of bookmarks) {
    const btn = el("button", { className: "bookmark-chip", title: bm.url, textContent: bm.title || bm.url.slice(0, 20) });
    btn.onclick = () => navigate(bm.url);
    btn.oncontextmenu = async (e) => {
      e.preventDefault();
      await window.api.removeBookmark(t.sessionId, bm.id);
      renderBookmarksBar();
    };
    bar.append(btn);
  }
}

$("bookmarkBtn").onclick = async () => {
  const t = state.tabs.find(t => t.id === state.activeTab);
  if (!t) return;
  await window.api.addBookmark(t.sessionId, { url: t.url, title: t.title });
  $("bookmarkBtn").textContent = "★";
  renderBookmarksBar();
  setTimeout(() => { $("bookmarkBtn").textContent = "☆"; }, 1500);
};

// Cmd+D / Ctrl+D — bookmark
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "d") {
    e.preventDefault();
    $("bookmarkBtn").click();
  }
});

// ── per-identity history ─────────────────────────────────────────────────
function recordHistory(sessionId, url, title) {
  if (!url || url === "about:blank") return;
  window.api.addHistory(sessionId, { url, title: title || url });
}

async function openHistory() {
  const panel = $("historyPanel");
  panel.hidden = !panel.hidden;
  if (panel.hidden) return;
  await renderHistory();
}

async function renderHistory(filter = "") {
  const t = state.tabs.find(t => t.id === state.activeTab);
  if (!t) return;
  const entries = await window.api.getHistory(t.sessionId);
  const list = $("historyList");
  list.replaceChildren();
  const q = filter.toLowerCase();
  const filtered = entries.filter(e => !q || e.url?.toLowerCase().includes(q) || e.title?.toLowerCase().includes(q));
  for (const entry of filtered.slice(0, 100)) {
    const item = el("div", { className: "history-item" },
      el("span", { className: "history-title", textContent: entry.title || entry.url }),
      el("span", { className: "history-url", textContent: entry.url }),
      el("span", { className: "history-time", textContent: new Date(entry.timestamp).toLocaleString() }),
    );
    item.onclick = () => { navigate(entry.url); $("historyPanel").hidden = true; };
    list.append(item);
  }
}

$("historyBtn").onclick = openHistory;
$("historyClose").onclick = () => { $("historyPanel").hidden = true; };
$("historyClear").onclick = async () => {
  const t = state.tabs.find(t => t.id === state.activeTab);
  if (t) { await window.api.clearHistory(t.sessionId); renderHistory(); }
};
$("historySearch").oninput = (e) => renderHistory(e.target.value);

// ── export / import identity ─────────────────────────────────────────────
$("importBtn").onclick = async () => {
  const result = await window.api.importIdentity();
  if (result) {
    state.sessions.push(result);
    renderSidebar();
    openTab(result.id);
  }
};

// ── native menu bar handlers ─────────────────────────────────────────────
window.api.onMenu("menu:new-tab", () => {
  const sid = state.tabs.find(t => t.id === state.activeTab)?.sessionId ?? state.sessions[0]?.id;
  if (sid) openTab(sid);
});
window.api.onMenu("menu:new-identity", () => openSessionModal());
window.api.onMenu("menu:close-tab", () => { if (state.activeTab) closeTab(state.activeTab); });
window.api.onMenu("menu:find", () => openFind());
window.api.onMenu("menu:reload", () => state.tabs.find(t => t.id === state.activeTab)?.webview.reload());
window.api.onMenu("menu:toggle-sidebar", () => $("sidebarToggle").click());

// ── find-in-page ────────────────────────────────────────────────────────
function openFind() {
  $("findBar").hidden = false;
  $("findInput").value = "";
  $("findCount").textContent = "";
  $("findInput").focus();
}

function closeFind() {
  $("findBar").hidden = true;
  $("findInput").value = "";
  $("findCount").textContent = "";
  const t = state.tabs.find(t => t.id === state.activeTab);
  if (t) t.webview.stopFindInPage("clearSelection");
}

function doFind(forward = true) {
  const query = $("findInput").value;
  if (!query) return;
  const t = state.tabs.find(t => t.id === state.activeTab);
  if (!t) return;
  t.webview.findInPage(query, { forward, findNext: true });
}

$("findInput").addEventListener("input", () => doFind());
$("findInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { doFind(!e.shiftKey); e.preventDefault(); }
  if (e.key === "Escape") closeFind();
});
$("findNext").onclick = () => doFind(true);
$("findPrev").onclick = () => doFind(false);
$("findClose").onclick = closeFind;

// Cmd+F / Ctrl+F
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
    e.preventDefault();
    openFind();
  }
});

// ── boot ─────────────────────────────────────────────────────────────────
loadSessions().then(restoreTabs);
