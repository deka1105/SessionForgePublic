# SessionForge Browser

A custom browser that lets you stay logged into the **same website as
multiple different users at the same time**. Built on Electron, so every tab
runs in a real Chromium engine — but each tab's cookies, localStorage, and
IndexedDB live in their own isolated bucket.

See [**`useCases.md`**](./useCases.md) for 25 real-world situations this
solves — agency social-media management, role-matrix QA, family devices,
journalism source compartmentalization, and more.

## Download

Grab the latest installer for your platform:

- **macOS** — [SessionForge-5.0.0-beta.1.dmg](https://github.com/deka1105/SessionForgePublic/releases/latest/download/SessionForge-5.0.0-beta.1.dmg) *(Intel)* · [SessionForge-5.0.0-beta.1-arm64.dmg](https://github.com/deka1105/SessionForgePublic/releases/latest/download/SessionForge-5.0.0-beta.1-arm64.dmg) *(Apple Silicon)*
- **Windows** — [SessionForge.Setup.5.0.0-beta.1.exe](https://github.com/deka1105/SessionForgePublic/releases/latest/download/SessionForge.Setup.5.0.0-beta.1.exe)
- **Linux** — [SessionForge-5.0.0-beta.1.AppImage](https://github.com/deka1105/SessionForgePublic/releases/latest/download/SessionForge-5.0.0-beta.1.AppImage)

Builds are unsigned, so on first launch macOS Gatekeeper / Windows
SmartScreen will warn — right-click → Open (mac) or "More info → Run
anyway" (win). All releases: <https://github.com/deka1105/SessionForgePublic/releases>

```
┌─────────────────────────────────────────────────────────────┐
│  Sidebar — identities         │  Tabs (each bound to one    │
│  • Default                    │  identity)                  │
│  • Claude · Work     ●blue    │  ┌─ [Work] claude.ai ──┐    │
│  • Claude · Personal ●pink    │  ┌─ [Pers] claude.ai ──┐    │
│  • ChatGPT · Acct 1  ●green   │  ┌─ [Acct1] chatgpt..─┐     │
│                               │                             │
│  + New Identity               │  URL bar | Clone | … site … │
└─────────────────────────────────────────────────────────────┘
```

## Why this works

Electron's `<webview>` tag has a `partition` attribute. Any two webviews
with the **same** `partition="persist:<id>"` share storage; webviews with
**different** partitions have completely separate cookie jars, even when
loading the exact same URL.

```html
<webview src="https://claude.ai" partition="persist:user1"></webview>
<webview src="https://claude.ai" partition="persist:user2"></webview>
```

Both render claude.ai in parallel. They're two independent Chromium
sessions to the site. Log in as different users — neither knows about the
other.

Chromium persists each partition's storage under
`~/Library/Application Support/SessionForge Browser/Partitions/<id>/`.

## Run it

```bash
git clone https://github.com/deka1105/SessionForgePublic.git
cd SessionForgePublic
npm install
npm start
```

First launch creates a seed "Default" identity. Use the sidebar to add
more, then click any identity to open a tab as that user.

## What's in the box (MVP)

- ✅ Sidebar with named identities (create / rename / recolour / delete, with cookie wipe)
- ✅ Tab strip — each tab shows a coloured dot for its identity
- ✅ URL bar — type a URL or a search query
- ✅ Back / Forward / Reload
- ✅ **Clone** button — open the current URL with a brand-new identity, in
     one click. Two tabs on the same site, two separate logins.
- ✅ Persistent identity list (`~/Library/.../sessions.json`)

## Architecture

```
main.js          Electron main process
                   • creates BrowserWindow
                   • IPC: sessions:list / save / clear
                   • persists identity metadata to disk
preload.js       contextBridge → exposes window.api to the renderer
renderer/
  index.html     shell: sidebar + tab strip + URL bar + viewHost
  app.js         tab manager — owns the <webview> lifecycle, maps
                 identities → partitions
  style.css      dark theme
```

Renderer is sandboxed: `contextIsolation: true`, `nodeIntegration: false`.
The only Node-side surface it gets is `window.api` from `preload.js`.

## Version 4X (current)

| Feature                                                       | Status |
|---------------------------------------------------------------|--------|
| Tabs, identities, partitions                                  | ✅     |
| Identity rename / recolour                                    | ✅     |
| Identity Group Tabs (clustered tab strip)                     | ✅     |
| Build to `.dmg` / `.exe` via electron-builder                 | ✅     |
| Automation: coordinate-based record & replay                  | ✅     |
| Full-text typing (300+ char prompts)                          | ✅     |
| Script Gallery (save/edit/search/sort with metadata)          | ✅     |
| Scheduling (one-time & recurring)                             | ✅     |
| Multi-Run (different scripts per identity, parallel)          | ✅     |
| Visual element picker                                         | ✅     |
| Cosmetic polish (focus rings, transitions, terminal log)      | ✅     |

## Version 5X-Beta (in progress)

| Feature                                                       | Status |
|---------------------------------------------------------------|--------|
| Bookmarks (per-identity bookmark bar)                         | ✅     |
| Find-in-page (Ctrl+F / Cmd+F)                                | ✅     |
| Per-identity browsing history (searchable)                    | ✅     |
| Export / import identity (cookie + bookmark bundle)           | ✅     |
| Drag-tab-onto-identity to rebind                              | ✅     |
| Native menu bar (File / Edit / Window with shortcuts)         | ✅     |
| Identity-coloured tab borders                                 | ✅     |
| Sidebar tree (Identity → open tabs, collapsible)             | ✅     |
| Multi-Run redesign (Identity → Tab → Script → Schedule)      | ✅     |
| Per-tab scheduling with live countdown                        | ✅     |
| Run History gallery (waiting / running / complete stages)     | ✅     |
| Flexible schedule parser (1m, 5min, every 10m, 15:30, etc.)  | ✅     |
| Auto-update via Squirrel                                      | ⏳     |
| Script marketplace (share/import community scripts)           | ⏳     |
| Conditional automation (if element exists → do X, else Y)    | ⏳     |
| Screenshot diff (compare before/after automation runs)        | ⏳     |

## License

MIT — see [`LICENSE`](./LICENSE).
