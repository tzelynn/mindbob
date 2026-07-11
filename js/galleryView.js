// GALLERY overlay: a grid of past doodles (from js/galleryStore.js) shown over
// doodle mode. Lazy-imported on first open. Grid -> tap a card -> viewer with
// download/delete. Rebuilt from a fresh store read on every open (same
// rebuild-from-storage pattern as moodDecorate.js).

import { getAllEntries, deleteEntry, galleryFilename } from "./galleryStore.js";

export function createGalleryView(refs, state) {
  const { galleryOverlay, galleryClose, galleryBody } = refs;

  let urls = []; // object URLs created for the current render — revoked on swap

  function revokeUrls() {
    for (const u of urls) URL.revokeObjectURL(u);
    urls = [];
  }

  function objectUrl(blob) {
    const u = URL.createObjectURL(blob);
    urls.push(u);
    return u;
  }

  async function renderGrid() {
    revokeUrls();
    galleryBody.innerHTML = "";
    const entries = await getAllEntries();
    if (!entries.length) {
      const p = document.createElement("p");
      p.className = "gallery-empty";
      p.textContent = "no past doodles yet — they collect here day by day";
      galleryBody.appendChild(p);
      return;
    }
    const grid = document.createElement("div");
    grid.className = "gallery-grid";
    for (const entry of entries) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "gallery-card";
      const img = document.createElement("img");
      img.src = objectUrl(entry.blob);
      img.alt = `doodle for ${entry.date}`;
      const word = document.createElement("span");
      word.className = "gallery-card-word";
      word.textContent = entry.word || "doodle";
      const date = document.createElement("span");
      date.className = "gallery-card-date";
      date.textContent = entry.date;
      card.append(img, word, date);
      card.addEventListener("click", () => renderViewer(entry));
      grid.appendChild(card);
    }
    galleryBody.appendChild(grid);
  }

  function renderViewer(entry) {
    revokeUrls();
    galleryBody.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "gallery-viewer";

    const img = document.createElement("img");
    img.src = objectUrl(entry.blob);
    img.alt = `doodle for ${entry.date}`;

    const meta = document.createElement("p");
    meta.className = "gallery-viewer-meta";
    meta.textContent = [entry.word, entry.date].filter(Boolean).join(" · ");

    const actions = document.createElement("div");
    actions.className = "gallery-viewer-actions";

    const back = document.createElement("button");
    back.type = "button";
    back.className = "tool-btn";
    back.textContent = "back";
    back.addEventListener("click", renderGrid);

    const download = document.createElement("a");
    download.className = "tool-btn";
    download.textContent = "download";
    download.href = objectUrl(entry.blob);
    download.download = galleryFilename(entry.word, entry.date, entry.type);

    const del = document.createElement("button");
    del.type = "button";
    del.className = "tool-btn";
    del.textContent = "delete";
    del.addEventListener("click", async () => {
      await deleteEntry(entry.date);
      renderGrid();
    });

    actions.append(back, download, del);
    wrap.append(img, meta, actions);
    galleryBody.appendChild(wrap);
  }

  function onKeydown(e) {
    if (e.key === "Escape") close();
  }

  function open() {
    galleryOverlay.hidden = false;
    document.addEventListener("keydown", onKeydown);
    renderGrid();
  }

  function close() {
    if (galleryOverlay.hidden) return;
    galleryOverlay.hidden = true;
    document.removeEventListener("keydown", onKeydown);
    revokeUrls();
    galleryBody.innerHTML = "";
  }

  function isOpen() {
    return !galleryOverlay.hidden;
  }

  galleryClose.addEventListener("click", close);

  return { open, close, isOpen };
}
