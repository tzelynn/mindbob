// BRAIN mode render: two cards — a monthly recurring checklist (checked items
// grey out and sink to the bottom, resetting each month) and an ad-hoc to-do
// list (items grey briefly, then vanish once done). Lazy-imported by main.js on
// first entry into brain mode (like nuggetsDecorate / moodDecorate). Rebuilds
// its subtree on every paint; reads fresh from brain.js each time.
import {
  readMonthly,
  addMonthlyTask,
  removeMonthlyTask,
  toggleMonthlyDone,
  readAdhoc,
  addAdhoc,
  removeAdhoc,
} from "./brain.js";

// How long a completed ad-hoc item stays greyed before it's removed (ms).
const ADHOC_FADE_MS = 350;

export function renderBrain(refs) {
  paint(refs);
}

export function clearBrain(refs) {
  refs.brainMonthly.innerHTML = "";
  refs.brainAdhoc.innerHTML = "";
}

function paint(refs) {
  buildMonthly(refs);
  buildAdhoc(refs);
}

// ---------- monthly section ----------
function buildMonthly(refs) {
  const wrap = refs.brainMonthly;
  wrap.innerHTML = "";

  const { tasks, done } = readMonthly();
  const doneSet = new Set(done);
  // Undone first, done last; stable within each group.
  const ordered = [
    ...tasks.filter((t) => !doneSet.has(t.id)),
    ...tasks.filter((t) => doneSet.has(t.id)),
  ];

  const list = document.createElement("ul");
  list.className = "brain-list";

  if (ordered.length === 0) {
    list.appendChild(emptyHint("no monthly to-dos yet"));
  } else {
    ordered.forEach((task) => {
      const checked = doneSet.has(task.id);
      const item = makeItem(task.text, checked, () => {
        toggleMonthlyDone(task.id);
        paint(refs);
      });
      const remove = removeBtn("remove monthly to-do", () => {
        removeMonthlyTask(task.id);
        paint(refs);
      });
      item.appendChild(remove);
      list.appendChild(item);
    });
  }
  wrap.appendChild(list);

  wrap.appendChild(
    makeAddForm("add a monthly to-do", wrap, (text) => {
      addMonthlyTask(text);
      paint(refs);
    })
  );
}

// ---------- ad-hoc section ----------
function buildAdhoc(refs) {
  const wrap = refs.brainAdhoc;
  wrap.innerHTML = "";

  const items = readAdhoc();
  const list = document.createElement("ul");
  list.className = "brain-list";

  if (items.length === 0) {
    list.appendChild(emptyHint("nothing on the list"));
  } else {
    items.forEach((task) => {
      const item = makeItem(task.text, false, (li, btn) => {
        // Show the "done" beat, then remove and re-paint.
        li.classList.add("is-done");
        btn.setAttribute("aria-pressed", "true");
        btn.disabled = true;
        setTimeout(() => {
          removeAdhoc(task.id);
          paint(refs);
        }, ADHOC_FADE_MS);
      });
      list.appendChild(item);
    });
  }
  wrap.appendChild(list);

  wrap.appendChild(
    makeAddForm("add a to-do", wrap, (text) => {
      addAdhoc(text);
      paint(refs);
    })
  );
}

// ---------- shared item / control builders ----------
// A list row: a check toggle + the text. onToggle receives (li, checkBtn).
function makeItem(text, checked, onToggle) {
  const li = document.createElement("li");
  li.className = "brain-item" + (checked ? " is-done" : "");

  const check = document.createElement("button");
  check.type = "button";
  check.className = "brain-check";
  check.setAttribute("aria-pressed", String(checked));
  check.setAttribute("aria-label", checked ? "mark not done" : "mark done");
  check.innerHTML = CHECK_GLYPH;
  check.addEventListener("click", () => onToggle(li, check));
  li.appendChild(check);

  const span = document.createElement("span");
  span.className = "brain-text";
  span.textContent = text;
  li.appendChild(span);

  return li;
}

function removeBtn(aria, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "brain-remove";
  b.setAttribute("aria-label", aria);
  b.textContent = "✕";
  b.addEventListener("click", onClick);
  return b;
}

// An add-form: text input + button. Enter submits; empty input is ignored;
// after a successful add, onAdd re-paints `wrap`, so we refocus the fresh input
// (the old form node is discarded by the repaint).
function makeAddForm(placeholder, wrap, onAdd) {
  const form = document.createElement("form");
  form.className = "brain-add";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "brain-input";
  input.placeholder = placeholder;
  input.setAttribute("aria-label", placeholder);
  form.appendChild(input);

  const add = document.createElement("button");
  add.type = "submit";
  add.className = "brain-add-btn";
  add.textContent = "add";
  form.appendChild(add);

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    onAdd(text);
    // paint() has rebuilt the subtree; refocus the fresh input for quick entry.
    const fresh = wrap.querySelector(".brain-input");
    if (fresh) fresh.focus();
  });

  return form;
}

function emptyHint(text) {
  const li = document.createElement("li");
  li.className = "brain-empty";
  li.textContent = text;
  return li;
}

// Line-art tick in the doodle/mood style (viewBox 0 0 100 100, currentColor).
const CHECK_GLYPH =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none" ' +
  'stroke="currentColor" stroke-width="12" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M22 54 L42 74 L80 28" /></svg>';
