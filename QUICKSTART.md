# SessionForge Browser — Quickstart

Stay logged into the same website as **multiple different people at once**.
No more "log out, log back in, log out again" loop. No more cookie clearing.

---

## 1. Install

You need **Node.js 18+** (check with `node --version`).

```bash
git clone https://github.com/deka1105/SessionForgePublic.git
cd SessionForgePublic
npm install
```

> The install pulls Electron, which is ~250 MB. One-time cost.

---

## 2. Run

```bash
npm start
```

The browser window opens. Leave the terminal running — the app needs it.

---

## 3. Your first multi-login

We'll log into the same site as **two different users** in parallel.

1. **Create the first identity**
   - Click **+ New Identity** in the left sidebar
   - Name: `Work` (or whatever)
   - Pick a colour → **Create**
   - A new tab opens (default page: DuckDuckGo)
   - Type your site in the URL bar — e.g. `claude.ai` — press **Enter**
   - **Log in as user A**

2. **Create the second identity**
   - Click **+ New Identity** again
   - Name: `Personal`
   - Different colour → **Create**
   - New tab opens, again pointing at DuckDuckGo
   - Navigate to the same site — `claude.ai`
   - **Log in as user B**

3. **Switch between them**
   - Click any identity in the sidebar → jumps back to that identity's last tab
   - Or click tabs at the top — each has a coloured dot showing its identity
   - Both stay logged in *forever* (until you delete the identity or clear it manually)

---

## 4. The handy shortcuts

| Action                       | How                                                                    |
|------------------------------|------------------------------------------------------------------------|
| Switch identity              | Click the identity name in the sidebar                                  |
| New tab in same identity     | **+** button in the tab strip                                          |
| Clone tab in new identity    | **⎘ Clone** in the URL bar — open the same URL as a new user            |
| Close one tab                | **×** on the tab in the tab strip                                       |
| Delete identity entirely     | Hover the identity → click **×** (wipes cookies, can't undo)            |
| Collapse / expand sidebar    | **‹ / ›** handle on the sidebar's edge, or **⌘B**                       |
| Reload                       | **↻** in the URL bar                                                    |
| Back / Forward               | **‹** / **›** in the URL bar                                            |

Hovering an identity reveals its delete action.

---

## 5. Maximising screen space

The whole sidebar collapses with the **‹** handle on its right edge (or
**⌘B**). Tabs and the URL bar stay put, the webview gets the full window.
Hit **›** or **⌘B** again to bring it back. Your preference is remembered
across launches.

---

## 6. Where things live on disk

| Thing                     | Path                                                                  |
|---------------------------|-----------------------------------------------------------------------|
| Identity list             | `~/Library/Application Support/sessionforge-browser/sessions.json`    |
| Cookies, storage, cache   | `~/Library/Application Support/sessionforge-browser/Partitions/<id>/` |

Each identity gets its own partition folder. That's where the multi-login
magic lives — every partition is a completely isolated cookie jar.

---

## 7. Tips and gotchas

- **Web pages don't sync between identities.** That's the entire point. If
  you bookmark something in "Work", it's not visible from "Personal".
- **Some sites detect automation.** If a site refuses to load, try clicking
  the page → hitting reload, or open it in a different identity. Each
  partition has its own fingerprint, so sometimes a fresh identity passes
  where an older one fails.
- **Two-factor authentication** works exactly like a normal browser — codes
  go to the email/phone tied to *that* account, not yours overall.
- **Closing the app** keeps everything intact. Re-open and you'll come back
  to your identity list with all logins still good.
- **Quitting from the dock** (Cmd+Q) is the cleanest exit. Force-quitting
  while a page is mid-write can corrupt a session — same as any browser.

---

## 8. If something breaks

Run with developer tools and renderer-console forwarding:

```bash
SFOX_DEVTOOLS=1 npm start
```

The DevTools window opens automatically, and any renderer errors are also
printed in your terminal. Copy whatever you see and share it.

To start completely fresh (wipe **all** identities and logins):

```bash
rm -rf "$HOME/Library/Application Support/sessionforge-browser"
```

Then `npm start` again — first launch reseeds a single "Default" identity.

---

## 9. What's next

See [`README.md`](./README.md) for architecture and the roadmap of features
on deck (bookmarks, history, electron-builder packaging into a `.dmg`, etc.).
