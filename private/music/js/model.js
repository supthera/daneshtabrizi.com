/** Pure music-workspace data helpers (no DOM, no fetch). */

export const MANIFEST_FORMAT = "daneshtabrizi.music.backup";
export const MANIFEST_VERSION = 1;

export const STATUSES = [
  { id: "idea", label: "Idea" },
  { id: "in_progress", label: "In progress" },
  { id: "finished", label: "Finished" },
];

export function statusLabel(id) {
  return STATUSES.find((s) => s.id === id)?.label || id || "Idea";
}

export function filterCards(cards, { query = "", status = "all", showArchived = false } = {}) {
  const q = String(query || "").trim().toLowerCase();
  return (cards || []).filter((card) => {
    if (!showArchived && card.archived) return false;
    if (status !== "all" && card.status !== status) return false;
    if (q && !String(card.title || "").toLowerCase().includes(q)) return false;
    return true;
  });
}

export function buildManifest({ cards, takes, cardId = null, exportedAt = new Date().toISOString() }) {
  let cardRows = Array.isArray(cards) ? cards.slice() : [];
  let takeRows = Array.isArray(takes) ? takes.slice() : [];
  if (cardId) {
    cardRows = cardRows.filter((c) => c.id === cardId);
    takeRows = takeRows.filter((t) => t.card_id === cardId);
  }
  return {
    format: MANIFEST_FORMAT,
    version: MANIFEST_VERSION,
    exported_at: exportedAt,
    cards: cardRows,
    takes: takeRows.map((t) => ({
      ...t,
      file_path: t.file_path || `media/${t.id}-${t.filename}`,
    })),
  };
}

export function validateManifest(raw) {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "Manifest must be a JSON object" };
  }
  if (raw.format !== MANIFEST_FORMAT) {
    return { ok: false, error: `Unknown format (expected ${MANIFEST_FORMAT})` };
  }
  if (Number(raw.version) !== MANIFEST_VERSION) {
    return { ok: false, error: `Unsupported manifest version ${raw.version}` };
  }
  if (!Array.isArray(raw.cards)) return { ok: false, error: "cards must be an array" };
  if (!Array.isArray(raw.takes)) return { ok: false, error: "takes must be an array" };
  return { ok: true, manifest: raw };
}

/**
 * Plan import collisions against existing card ids/titles.
 * mode: "rename" | "skip" | "ask"
 */
export function planImportCollisions(manifest, existingCards, mode = "rename") {
  const existingIds = new Set((existingCards || []).map((c) => c.id));
  const existingTitles = new Set((existingCards || []).map((c) => String(c.title || "").toLowerCase()));
  const decisions = [];

  for (const card of manifest.cards || []) {
    const idClash = existingIds.has(card.id);
    const titleClash = existingTitles.has(String(card.title || "").toLowerCase());
    if (!idClash && !titleClash) {
      decisions.push({ card, action: "create", newTitle: card.title, newId: card.id });
      continue;
    }
    if (mode === "skip") {
      decisions.push({ card, action: "skip", reason: idClash ? "id" : "title" });
      continue;
    }
    if (mode === "ask") {
      decisions.push({ card, action: "ask", reason: idClash ? "id" : "title" });
      continue;
    }
    // rename
    let base = String(card.title || "Untitled").trim() || "Untitled";
    let n = 2;
    let title = `${base} (import)`;
    while (existingTitles.has(title.toLowerCase())) {
      title = `${base} (import ${n++})`;
    }
    const newId = cryptoRandomId();
    decisions.push({ card, action: "create", newTitle: title, newId, renamed: true });
    existingTitles.add(title.toLowerCase());
    existingIds.add(newId);
  }
  return decisions;
}

export function markMissingTakes(takes, presentPaths) {
  const present = new Set(presentPaths || []);
  return (takes || []).map((t) => {
    const path = t.file_path || `media/${t.id}-${t.filename}`;
    const missing = !present.has(path) && !present.has(t.filename);
    return { ...t, missing, file_path: path };
  });
}

function cryptoRandomId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return "id-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function formatBytes(n) {
  const v = Number(n) || 0;
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
  if (v < 1024 * 1024 * 1024) return `${(v / (1024 * 1024)).toFixed(1)} MB`;
  return `${(v / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatTime(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}
