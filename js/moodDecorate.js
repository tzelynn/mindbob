// MOOD mode render: a logging strip (5 tinted line-art glyphs) plus a
// year-in-pixels history grid with week / month / year zoom. Lazy-imported by
// main.js on first entry to mood mode (like nuggetsDecorate / doodleDecorate).
// Rebuilds its subtree on every paint; reads fresh from localStorage each time.
import {
  MOOD_LEVELS,
  MOOD_LABELS,
  MOOD_COLORS,
  MOOD_GLYPHS,
  dateKey,
  todayKey,
  keyToDate,
  monthMatrix,
  weekDays,
  yearMatrix,
  isFuture,
  readAllMoods,
  writeMood,
} from "./mood.js";

const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEK_HEADS = ["M", "T", "W", "T", "F", "S", "S"];

// View state persists across mode switches (remembers zoom/selection).
let view = null;

export function renderMood(refs) {
  if (!view) {
    const today = todayKey();
    view = { zoom: "month", anchor: keyToDate(today), selected: today };
  }
  paint(refs);
}

export function clearMood(refs) {
  refs.moodLog.innerHTML = "";
  refs.moodZoom.innerHTML = "";
  refs.moodGrid.innerHTML = "";
}

function paint(refs) {
  const moods = readAllMoods();
  // Selecting a day retargets the logging strip and pulls it into view.
  const onSelect = (key) => {
    view.selected = key;
    view.anchor = keyToDate(key);
    paint(refs);
  };
  buildLog(refs, moods);
  buildControls(refs);
  buildGrid(refs, moods, onSelect);
}

// ---------- logging strip ----------
function buildLog(refs, moods) {
  const wrap = refs.moodLog;
  wrap.innerHTML = "";

  const heading = document.createElement("p");
  heading.className = "mood-heading";
  heading.textContent = "how was " + dayLabel(view.selected) + "?";
  wrap.appendChild(heading);

  const row = document.createElement("div");
  row.className = "mood-glyphs";
  const current = moods.get(view.selected) || null;

  MOOD_LEVELS.forEach((level, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mood-glyph-btn" + (current === level ? " is-active" : "");
    btn.style.color = MOOD_COLORS[i];
    btn.title = MOOD_LABELS[i];
    btn.setAttribute("aria-label", MOOD_LABELS[i]);
    btn.setAttribute("aria-pressed", String(current === level));
    btn.innerHTML = MOOD_GLYPHS[i];
    btn.addEventListener("click", () => {
      // Tapping the active glyph again clears the day; otherwise set it.
      writeMood(view.selected, current === level ? null : level);
      paint(refs);
    });
    row.appendChild(btn);
  });
  wrap.appendChild(row);
}

// ---------- zoom + period navigation ----------
function buildControls(refs) {
  const wrap = refs.moodZoom;
  wrap.innerHTML = "";

  const zooms = document.createElement("div");
  zooms.className = "mood-zoom-group";
  zooms.setAttribute("role", "tablist");
  ["week", "month", "year"].forEach((z) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "mode-btn" + (view.zoom === z ? " is-active" : "");
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", String(view.zoom === z));
    b.textContent = z;
    b.addEventListener("click", () => {
      view.zoom = z;
      paint(refs);
    });
    zooms.appendChild(b);
  });
  wrap.appendChild(zooms);

  const nav = document.createElement("div");
  nav.className = "mood-nav";
  nav.appendChild(navBtn("‹", "previous", () => { shift(-1); paint(refs); }));

  const label = document.createElement("span");
  label.className = "mood-period";
  label.textContent = periodLabel();
  nav.appendChild(label);

  nav.appendChild(navBtn("›", "next", () => { shift(1); paint(refs); }));
  nav.appendChild(navBtn("today", "jump to today", () => {
    view.anchor = keyToDate(todayKey());
    paint(refs);
  }, "mood-today-btn"));
  wrap.appendChild(nav);
}

function navBtn(text, aria, onClick, cls = "mood-nav-btn") {
  const b = document.createElement("button");
  b.type = "button";
  b.className = cls;
  b.textContent = text;
  b.setAttribute("aria-label", aria);
  b.addEventListener("click", onClick);
  return b;
}

function shift(dir) {
  const a = view.anchor;
  if (view.zoom === "week") {
    view.anchor = new Date(a.getFullYear(), a.getMonth(), a.getDate() + 7 * dir);
  } else if (view.zoom === "month") {
    view.anchor = new Date(a.getFullYear(), a.getMonth() + dir, 1);
  } else {
    view.anchor = new Date(a.getFullYear() + dir, a.getMonth(), 1);
  }
}

function periodLabel() {
  const a = view.anchor;
  if (view.zoom === "week") {
    const days = weekDays(a);
    const s = days[0], e = days[6];
    const left = `${s.getDate()} ${MONTHS_SHORT[s.getMonth()]}`;
    const right = s.getMonth() === e.getMonth()
      ? `${e.getDate()}`
      : `${e.getDate()} ${MONTHS_SHORT[e.getMonth()]}`;
    return `${left} – ${right}`;
  }
  if (view.zoom === "month") return `${MONTHS[a.getMonth()]} ${a.getFullYear()}`;
  return String(a.getFullYear());
}

// ---------- history grid ----------
function buildGrid(refs, moods, onSelect) {
  const grid = refs.moodGrid;
  grid.innerHTML = "";
  grid.dataset.zoom = view.zoom;
  if (view.zoom === "week") buildWeek(grid, moods, onSelect);
  else if (view.zoom === "month") buildMonth(grid, moods, onSelect);
  else buildYear(grid, moods, onSelect);
}

function buildWeek(grid, moods, onSelect) {
  const row = document.createElement("div");
  row.className = "mood-week";
  weekDays(view.anchor).forEach((date) => {
    const cell = makeCell(date, moods, "week", onSelect);
    const cap = document.createElement("span");
    cap.className = "mood-cell-cap";
    cap.textContent = DAYS_SHORT[date.getDay()][0];
    cell.appendChild(cap);
    row.appendChild(cell);
  });
  grid.appendChild(row);
}

function buildMonth(grid, moods, onSelect) {
  const head = document.createElement("div");
  head.className = "mood-month-head";
  WEEK_HEADS.forEach((d) => {
    const h = document.createElement("span");
    h.textContent = d;
    head.appendChild(h);
  });
  grid.appendChild(head);

  const body = document.createElement("div");
  body.className = "mood-month";
  monthMatrix(view.anchor.getFullYear(), view.anchor.getMonth()).forEach((week) => {
    week.forEach((date) => {
      if (!date) {
        const blank = document.createElement("div");
        blank.className = "mood-cell is-blank";
        body.appendChild(blank);
      } else {
        body.appendChild(makeCell(date, moods, "month", onSelect));
      }
    });
  });
  grid.appendChild(body);
}

function buildYear(grid, moods, onSelect) {
  const cols = document.createElement("div");
  cols.className = "mood-year";
  yearMatrix(view.anchor.getFullYear()).forEach(({ monthIndex, days }) => {
    const col = document.createElement("div");
    col.className = "mood-year-col";
    const label = document.createElement("span");
    label.className = "mood-year-label";
    label.textContent = MONTHS_SHORT[monthIndex][0];
    col.appendChild(label);
    days.forEach((date) => col.appendChild(makeCell(date, moods, "year", onSelect)));
    cols.appendChild(col);
  });
  grid.appendChild(cols);
}

// A single day cell (button). Selecting it retargets the logging strip.
function makeCell(date, moods, size, onSelect) {
  const key = dateKey(date);
  const mood = moods.get(key) || null;
  const future = isFuture(date);

  const cell = document.createElement("button");
  cell.type = "button";
  cell.className = "mood-cell mood-cell-" + size;
  cell.dataset.key = key;
  if (mood) {
    cell.style.background = MOOD_COLORS[mood - 1];
    cell.classList.add("is-set");
  } else {
    cell.classList.add("is-empty");
  }
  if (key === todayKey()) cell.classList.add("is-today");
  if (key === view.selected) cell.classList.add("is-selected");
  if (future) {
    cell.classList.add("is-future");
    cell.disabled = true;
  }

  const label = future ? "" : (mood ? `${MOOD_LABELS[mood - 1]}, ` : "");
  cell.setAttribute("aria-label", label + dayLabel(key));

  if (size !== "year") {
    const num = document.createElement("span");
    num.className = "mood-cell-num";
    num.textContent = String(date.getDate());
    cell.appendChild(num);
  }
  if (size === "week" && mood) {
    const g = document.createElement("span");
    g.className = "mood-cell-glyph"; // inherits the set cell's light currentColor
    g.innerHTML = MOOD_GLYPHS[mood - 1];
    cell.appendChild(g);
  }

  if (!future) cell.addEventListener("click", () => onSelect(key));
  return cell;
}

// Human label for a day key: "today" for the current day, else "Thu, 3 Jul".
function dayLabel(key) {
  if (key === todayKey()) return "today";
  const d = keyToDate(key);
  return `${DAYS_SHORT[d.getDay()]}, ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
}
