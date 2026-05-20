# SessionForge Browser

A custom browser that lets you stay logged into the **same website as
multiple different users at the same time**. Built on Electron, so every tab
runs in a real Chromium engine — but each tab's cookies, localStorage, and
IndexedDB live in their own isolated bucket.

## Download

Grab the latest installer for your platform:

- **macOS** — [SessionForge-0.1.0.dmg](https://github.com/deka1105/SessionForgePublic/releases/latest/download/SessionForge-0.1.0.dmg) *(Intel)* · [SessionForge-0.1.0-arm64.dmg](https://github.com/deka1105/SessionForgePublic/releases/latest/download/SessionForge-0.1.0-arm64.dmg) *(Apple Silicon)*
- **Windows** — [SessionForge.Setup.0.1.0.exe](https://github.com/deka1105/SessionForgePublic/releases/latest/download/SessionForge.Setup.0.1.0.exe)
- **Linux** — [SessionForge-0.1.0.AppImage](https://github.com/deka1105/SessionForgePublic/releases/latest/download/SessionForge-0.1.0.AppImage)

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

- ✅ Sidebar with named identities (create / delete, with cookie wipe)
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

## Roadmap

| Feature                                                       | Status |
|---------------------------------------------------------------|--------|
| Tabs, identities, partitions                                  | ✅     |
| Bookmarks                                                     | ⏳     |
| Per-identity history                                          | ⏳     |
| Identity-coloured tab borders                                 | ⏳     |
| Find-in-page                                                  | ⏳     |
| Native menu bar (File / Edit / Window)                        | ⏳     |
| Auto-update via Squirrel                                      | ⏳     |
| Identity groups ("Work" / "Personal" containers)              | ⏳     |
| Drag-tab-onto-identity to rebind                              | ⏳     |
| Export / import an identity (cookie bundle)                   | ⏳     |
| Build to `.dmg` / `.exe` via electron-builder                 | ⏳     |

## License

MIT — see [`LICENSE`](./LICENSE).
