/** Thin Music Studio API client — same-origin, behind Access. */
import { api } from "/private/assets/private.js";

export function listCards(includeArchived = false) {
  const q = includeArchived ? "?archived=1" : "";
  return api(`/api/music/cards${q}`);
}

export function createCard(payload) {
  return api("/api/music/cards", { method: "POST", body: JSON.stringify(payload) });
}

export function getCard(id) {
  return api(`/api/music/cards/${encodeURIComponent(id)}`);
}

export function patchCard(id, payload) {
  return api(`/api/music/cards/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteCard(id) {
  return api(`/api/music/cards/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function reorderCards(ids) {
  return api("/api/music/cards/reorder", { method: "PUT", body: JSON.stringify({ ids }) });
}

export function uploadTake(cardId, file, { label = "", note = "" } = {}) {
  const form = new FormData();
  form.append("file", file, file.name);
  if (label) form.append("label", label);
  if (note) form.append("note", note);
  return api(`/api/music/cards/${encodeURIComponent(cardId)}/takes`, { method: "POST", body: form });
}

export function reorderTakes(cardId, ids) {
  return api(`/api/music/cards/${encodeURIComponent(cardId)}/takes/reorder`, {
    method: "PUT",
    body: JSON.stringify({ ids }),
  });
}

export function patchTake(id, payload) {
  return api(`/api/music/takes/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteTake(id) {
  return api(`/api/music/takes/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function relinkTake(id, file) {
  const form = new FormData();
  form.append("file", file, file.name);
  return api(`/api/music/takes/${encodeURIComponent(id)}/relink`, { method: "POST", body: form });
}

export function createTakeStub(payload) {
  return api("/api/music/import/take-stub", { method: "POST", body: JSON.stringify(payload) });
}

export function exportManifest(cardId = null) {
  const q = cardId ? `?card_id=${encodeURIComponent(cardId)}` : "";
  return api(`/api/music/export${q}`);
}

export async function fetchTakeBytes(takeId) {
  const res = await fetch(`/api/music/takes/${encodeURIComponent(takeId)}/file`, {
    credentials: "same-origin",
  });
  if (!res.ok) {
    const err = new Error(res.status === 404 ? "Media file missing" : "Failed to fetch media");
    err.status = res.status;
    throw err;
  }
  return new Uint8Array(await res.arrayBuffer());
}
