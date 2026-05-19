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

// ── sidebar (identities) ─────────────────────────────────────────────────
function renderSidebar() {
  const ul = $("sessionList");
  ul.replaceChildren();
  for (const s of state.sessions) {
    const dot = el("span", { className: "swatch" });
    // Use a CSS variable so the same colour can be applied as either fill
    // (expanded dot) or border (collapsed tile) without inline-style fights.
    dot.style.setProperty("--swatch-color", s.color);

    // Overlay the favicon of the identity's most-relevant tab on top of the
    // colour swatch — useful in the collapsed icon-rail where the tile is
    // the only signal of what site is open.
    const tabForFavicon =
      state.tabs.find(t => t.id === state.lastTabPerSess[s.id]) ??
      state.tabs.find(t => t.sessionId === s.id);
    if (tabForFavicon?.favicon) {
      dot.append(el("img", { className: "sess-favicon", src: tabForFavicon.favicon, alt: "" }));
    }

    const li = el("li", { className: "sess-item", title: `Switch to "${s.name}"` },
      dot,
      el("span", { className: "sess-name", textContent: s.name }),
      el("button", { className: "sess-x", title: "Delete identity (wipes cookies)", textContent: "×",
                     onclick: e => { e.stopPropagation(); deleteSession(s.id); } }),
    );
    li.onclick = () => focusIdentity(s.id);
    ul.append(li);
  }
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
  wv.addEventListener("did-navigate",        e => { tab.url   = e.url;   if (id === state.activeTab) $("urlInput").value = e.url; persistTabs(); });
  wv.addEventListener("did-navigate-in-page",e => { tab.url   = e.url;   if (id === state.activeTab) $("urlInput").value = e.url; persistTabs(); });
  wv.addEventListener("page-favicon-updated",e => { tab.favicon = e.favicons?.[0] ?? null; renderSidebar(); persistTabs(); });

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
  persistTabs();
}

function renderTabs() {
  const root = $("tabs");
  root.replaceChildren();
  for (const t of state.tabs) {
    const s   = state.sessions.find(s => s.id === t.sessionId);
    const dot = el("span", { className: "tab-dot" });
    if (s) dot.style.background = s.color;
    const node = el("div", {
      className: "tab" + (t.id === state.activeTab ? " active" : ""),
      title:     `${s?.name ?? "?"} — ${t.url}`,
      onclick:   () => activateTab(t.id),
    },
      dot,
      el("span",   { className: "tab-title", textContent: t.title || t.url }),
      el("button", { className: "tab-x", textContent: "×",
                     onclick: e => { e.stopPropagation(); closeTab(t.id); } }),
    );
    root.append(node);
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

// ── identity modal ───────────────────────────────────────────────────────
$("newSessionBtn").onclick = () => {
  $("newSessionName").value  = "";
  $("newSessionColor").value = randomColor();
  $("newSessionModal").showModal();
};

$("newSessionForm").addEventListener("submit", async (e) => {
  // dialog form auto-closes; we only act on the "ok" path.
  if ($("newSessionForm").returnValue !== "ok" &&
      e.submitter?.value !== "ok") return;
  const name  = $("newSessionName").value.trim();
  const color = $("newSessionColor").value;
  if (!name) return;
  const id = await createSession(name, color);
  openTab(id);
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

// ── boot ─────────────────────────────────────────────────────────────────
loadSessions().then(restoreTabs);
