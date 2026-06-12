// SessionForge Browser — Script Gallery
//
// Full-screen gallery for browsing, editing, and managing saved automation scripts.
// Each script stores: name, description, website, created, modified, steps.

const scriptGallery = (() => {
  let galleryEl = null;
  let scripts = [];

  function create() {
    galleryEl = document.createElement("div");
    galleryEl.id = "scriptGallery";
    galleryEl.className = "gallery";
    galleryEl.innerHTML = `
      <header class="gallery-header">
        <h2>Scripts</h2>
        <input class="gallery-search" type="text" placeholder="Search…">
        <select class="gallery-sort">
          <option value="recent">Recent</option>
          <option value="alpha">A–Z</option>
          <option value="steps">Steps</option>
        </select>
        <button class="gallery-close">×</button>
      </header>
      <div class="gallery-grid"></div>
    `;
    // Append inside the automation panel so it overlays the steps area
    const panel = document.getElementById("automationPanel");
    if (panel) panel.append(galleryEl);
    else document.body.append(galleryEl);

    galleryEl.querySelector(".gallery-close").onclick = () => toggle(false);
    galleryEl.querySelector(".gallery-search").oninput = () => renderGrid();
    galleryEl.querySelector(".gallery-sort").onchange = () => renderGrid();
  }

  function toggle(show) {
    if (!galleryEl) create();
    const visible = show ?? !galleryEl.classList.contains("open");
    galleryEl.classList.toggle("open", visible);
    if (visible) refresh();
  }

  async function refresh() {
    scripts = await window.api.listScripts();
    renderGrid();
  }

  function renderGrid() {
    const grid = galleryEl.querySelector(".gallery-grid");
    grid.replaceChildren();

    const filter = (galleryEl.querySelector(".gallery-search").value || "").toLowerCase();
    const sortBy = galleryEl.querySelector(".gallery-sort").value;

    let filtered = scripts.filter(s => {
      return !filter || s.name?.toLowerCase().includes(filter) ||
        s.description?.toLowerCase().includes(filter) ||
        s.website?.toLowerCase().includes(filter);
    });

    if (sortBy === "recent") filtered.sort((a, b) => (b.modified || "").localeCompare(a.modified || ""));
    else if (sortBy === "alpha") filtered.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    else if (sortBy === "steps") filtered.sort((a, b) => (b.steps?.length || 0) - (a.steps?.length || 0));

    if (!filtered.length) {
      grid.innerHTML = `<div class="gallery-empty">No scripts saved yet.<br>Record an automation and save it to see it here.</div>`;
      return;
    }

    for (const script of filtered) {
      const card = document.createElement("div");
      card.className = "gallery-card";

      const created = script.created ? new Date(script.created).toLocaleDateString() : "—";
      const modified = script.modified ? new Date(script.modified).toLocaleDateString() : "—";
      const stepCount = script.steps?.length || 0;

      card.innerHTML = `
        <div class="gallery-card-header">
          <span class="gallery-card-name">${esc(script.name || "Untitled")}</span>
          <span class="gallery-card-steps">${stepCount} steps</span>
        </div>
        ${script.website ? `<div class="gallery-card-website">${esc(script.website)}</div>` : ""}
        ${script.description ? `<div class="gallery-card-desc">${esc(script.description)}</div>` : ""}
        <div class="gallery-card-meta">
          <span>Created: ${created}</span>
          <span>Modified: ${modified}</span>
        </div>
        <div class="gallery-card-actions">
          <button class="gallery-btn gallery-use" title="Load into automation panel">▶ Use</button>
          <button class="gallery-btn gallery-edit" title="Edit script details">✎ Edit</button>
          <button class="gallery-btn gallery-del" title="Delete script">🗑</button>
        </div>
      `;

      card.querySelector(".gallery-use").onclick = () => useScript(script);
      card.querySelector(".gallery-edit").onclick = () => editScript(script);
      card.querySelector(".gallery-del").onclick = () => deleteScript(script);

      grid.append(card);
    }
  }

  function esc(str) {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function useScript(script) {
    // Load into the automation panel and close gallery
    automationPanel.loadSteps(script.steps, script.name);
    toggle(false);
  }

  async function editScript(script) {
    // Show edit modal
    const overlay = document.createElement("div");
    overlay.className = "gallery-modal-overlay";
    overlay.innerHTML = `
      <div class="gallery-modal">
        <h3>Edit Script</h3>
        <label class="gallery-modal-label">Name
          <input class="gallery-modal-input" id="ge-name" value="${esc(script.name || "")}">
        </label>
        <label class="gallery-modal-label">Website
          <input class="gallery-modal-input" id="ge-website" placeholder="e.g. chatgpt.com" value="${esc(script.website || "")}">
        </label>
        <label class="gallery-modal-label">Description
          <textarea class="gallery-modal-textarea" id="ge-desc" rows="3" placeholder="What does this script do?">${esc(script.description || "")}</textarea>
        </label>
        <div class="gallery-modal-actions">
          <button class="gallery-btn ge-cancel">Cancel</button>
          <button class="gallery-btn ge-save">Save</button>
        </div>
      </div>
    `;
    document.body.append(overlay);

    return new Promise((resolve) => {
      overlay.querySelector(".ge-cancel").onclick = () => { overlay.remove(); resolve(); };
      overlay.querySelector(".ge-save").onclick = async () => {
        const name = overlay.querySelector("#ge-name").value.trim() || script.name;
        const website = overlay.querySelector("#ge-website").value.trim();
        const description = overlay.querySelector("#ge-desc").value.trim();
        await window.api.saveScript({
          filename: script.filename,
          name,
          website,
          description,
          created: script.created,
          steps: script.steps,
        });
        overlay.remove();
        await refresh();
        resolve();
      };
    });
  }

  async function deleteScript(script) {
    // Confirm with a mini dialog
    const overlay = document.createElement("div");
    overlay.className = "gallery-modal-overlay";
    overlay.innerHTML = `
      <div class="gallery-modal gallery-modal-sm">
        <h3>Delete "${esc(script.name)}"?</h3>
        <p style="color:var(--muted);font-size:12px;margin:8px 0 16px;">This cannot be undone.</p>
        <div class="gallery-modal-actions">
          <button class="gallery-btn ge-cancel">Cancel</button>
          <button class="gallery-btn ge-del-confirm">Delete</button>
        </div>
      </div>
    `;
    document.body.append(overlay);

    overlay.querySelector(".ge-cancel").onclick = () => overlay.remove();
    overlay.querySelector(".ge-del-confirm").onclick = async () => {
      await window.api.deleteScript(script.filename);
      overlay.remove();
      await refresh();
    };
  }

  return { toggle, refresh };
})();
