import { el, showToast } from "/private/assets/private.js";
import * as musicApi from "./api.js";
import {
  STATUSES,
  statusLabel,
  filterCards,
  validateManifest,
  planImportCollisions,
  markMissingTakes,
  formatBytes,
  formatTime,
  MANIFEST_FORMAT,
  MANIFEST_VERSION,
} from "./model.js";
import { buildZip, readZip } from "./zip.js";
import { probePlayback, attachPlaybackGuards } from "./playback.js";

const root = {
  cards: [],
  view: "dash", // dash | detail
  activeId: null,
  detail: null, // { card, takes }
  query: "",
  status: "all",
  showArchived: false,
  saveTimer: null,
  lastSaved: null,
  saving: false,
  saveError: null,
};

export async function bootMusicStudio(mount) {
  mount.replaceChildren();
  const dash = el("section", { class: "music-dash", id: "music-dash" });
  const detail = el("section", { class: "music-detail", id: "music-detail" });
  const flash = el("div", { id: "music-flash" });
  mount.append(flash, dash, detail);
  await refreshCards();
  render();
}

function flash(msg, kind = "ok") {
  const host = document.getElementById("music-flash");
  if (!host) return;
  host.replaceChildren(el("div", { class: `flash ${kind}`, text: msg }));
  if (kind === "ok") setTimeout(() => host.replaceChildren(), 3500);
}

async function refreshCards() {
  try {
    const data = await musicApi.listCards(true);
    root.cards = data.cards || [];
  } catch (e) {
    flash(e.message || "Failed to load cards", "err");
    root.cards = [];
  }
}

function render() {
  const dash = document.getElementById("music-dash");
  const detail = document.getElementById("music-detail");
  if (!dash || !detail) return;

  if (root.view === "detail" && root.detail) {
    dash.classList.add("is-hidden");
    detail.classList.add("is-open");
    renderDetail(detail);
  } else {
    detail.classList.remove("is-open");
    dash.classList.remove("is-hidden");
    renderDash(dash);
  }
}

function renderDash(host) {
  const visible = filterCards(root.cards, {
    query: root.query,
    status: root.status,
    showArchived: root.showArchived,
  });

  const toolbar = el("div", { class: "music-toolbar" }, [
    el("input", {
      type: "search",
      class: "grow",
      placeholder: "Search titles…",
      value: root.query,
      "aria-label": "Search cards",
      oninput: (e) => {
        root.query = e.target.value;
        render();
      },
    }),
    el(
      "select",
      {
        "aria-label": "Filter by status",
        onchange: (e) => {
          root.status = e.target.value;
          render();
        },
      },
      [
        el("option", { value: "all", text: "All statuses", selected: root.status === "all" ? "" : null }),
        ...STATUSES.map((s) =>
          el("option", {
            value: s.id,
            text: s.label,
            ...(root.status === s.id ? { selected: "" } : {}),
          }),
        ),
      ],
    ),
    el("label", { class: "check" }, [
      el("input", {
        type: "checkbox",
        checked: root.showArchived ? "" : null,
        onchange: (e) => {
          root.showArchived = e.target.checked;
          render();
        },
      }),
      document.createTextNode("Show archived"),
    ]),
    el("button", {
      type: "button",
      class: "btn",
      text: "New card",
      onclick: () => createCard(),
    }),
  ]);

  // Fix selected option
  const sel = toolbar.querySelector("select");
  if (sel) sel.value = root.status;

  let body;
  if (!root.cards.length) {
    body = el("div", { class: "music-empty" }, [
      el("h2", { text: "Your studio is empty" }),
      el("p", { text: "Create a card for a song or loose idea. Attach voice memos, videos, lyrics, and notes." }),
      el("button", { type: "button", class: "btn", text: "Create first card", onclick: () => createCard() }),
    ]);
  } else if (!visible.length) {
    body = el("div", { class: "music-empty" }, [
      el("h2", { text: "No matches" }),
      el("p", { text: "Try a different search or status filter." }),
    ]);
  } else {
    body = el(
      "div",
      { class: "music-grid", id: "music-grid" },
      visible.map((card, index) => cardTile(card, index, visible)),
    );
  }

  const backup = backupPanel();
  host.replaceChildren(toolbar, body, backup);
  enableCardDnD(host.querySelector("#music-grid"));
}

function cardTile(card, index, list) {
  const tile = el("article", {
    class: `music-card${card.archived ? " archived" : ""}`,
    draggable: "true",
    "data-id": card.id,
  }, [
    el("div", { class: "status", text: statusLabel(card.status) }),
    el("h2", { text: card.title || "Untitled" }),
    el("div", {
      class: "counts",
      text: `${Number(card.audio_count) || 0} audio · ${Number(card.video_count) || 0} video`,
    }),
    el("div", { class: "row-actions" }, [
      el("button", {
        type: "button",
        class: "btn",
        text: "Open",
        onclick: (e) => {
          e.stopPropagation();
          openCard(card.id);
        },
      }),
      el("button", {
        type: "button",
        class: "btn ghost",
        text: "Rename",
        onclick: (e) => {
          e.stopPropagation();
          renameCard(card);
        },
      }),
      el("button", {
        type: "button",
        class: "btn ghost",
        text: card.archived ? "Unarchive" : "Archive",
        onclick: (e) => {
          e.stopPropagation();
          toggleArchive(card);
        },
      }),
      el("button", {
        type: "button",
        class: "btn ghost",
        text: "Delete",
        onclick: (e) => {
          e.stopPropagation();
          confirmDeleteCard(card);
        },
      }),
    ]),
    el("div", { class: "music-reorder-mobile" }, [
      el("button", {
        type: "button",
        class: "btn ghost",
        text: "Move up",
        disabled: index === 0 ? "" : null,
        onclick: (e) => {
          e.stopPropagation();
          moveCard(card.id, -1, list);
        },
      }),
      el("button", {
        type: "button",
        class: "btn ghost",
        text: "Move down",
        disabled: index === list.length - 1 ? "" : null,
        onclick: (e) => {
          e.stopPropagation();
          moveCard(card.id, 1, list);
        },
      }),
    ]),
  ]);
  tile.addEventListener("dblclick", () => openCard(card.id));
  return tile;
}

function enableCardDnD(grid) {
  if (!grid) return;
  let dragId = null;
  grid.querySelectorAll(".music-card").forEach((node) => {
    node.addEventListener("dragstart", () => {
      dragId = node.getAttribute("data-id");
      node.classList.add("dragging");
    });
    node.addEventListener("dragend", () => node.classList.remove("dragging"));
    node.addEventListener("dragover", (e) => {
      e.preventDefault();
    });
    node.addEventListener("drop", async (e) => {
      e.preventDefault();
      const targetId = node.getAttribute("data-id");
      if (!dragId || dragId === targetId) return;
      const ids = root.cards.filter((c) => !c.archived || root.showArchived).map((c) => c.id);
      const from = ids.indexOf(dragId);
      const to = ids.indexOf(targetId);
      if (from < 0 || to < 0) return;
      ids.splice(to, 0, ids.splice(from, 1)[0]);
      try {
        await musicApi.reorderCards(ids);
        await refreshCards();
        render();
      } catch (err) {
        flash(err.message || "Reorder failed", "err");
      }
    });
  });
}

async function moveCard(id, delta, list) {
  const ids = list.map((c) => c.id);
  const i = ids.indexOf(id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  try {
    await musicApi.reorderCards(ids);
    await refreshCards();
    render();
  } catch (e) {
    flash(e.message || "Reorder failed", "err");
  }
}

async function createCard() {
  const title = prompt("Card title", "Untitled");
  if (title == null) return;
  try {
    const created = await musicApi.createCard({ title: title.trim() || "Untitled", status: "idea" });
    await refreshCards();
    flash("Card created");
    await openCard(created.id);
  } catch (e) {
    flash(e.message || "Create failed", "err");
  }
}

async function renameCard(card) {
  const title = prompt("Rename card", card.title || "Untitled");
  if (title == null) return;
  try {
    await musicApi.patchCard(card.id, { title: title.trim() || "Untitled" });
    await refreshCards();
    if (root.detail?.card?.id === card.id) {
      root.detail.card.title = title.trim() || "Untitled";
    }
    render();
    flash("Renamed");
  } catch (e) {
    flash(e.message || "Rename failed", "err");
  }
}

async function toggleArchive(card) {
  try {
    await musicApi.patchCard(card.id, { archived: !card.archived });
    await refreshCards();
    render();
    flash(card.archived ? "Unarchived" : "Archived");
  } catch (e) {
    flash(e.message || "Archive failed", "err");
  }
}

function confirmDeleteCard(card) {
  askConfirm(`Delete “${card.title}”? This removes the card and all takes from D1/R2.`, async () => {
    try {
      await musicApi.deleteCard(card.id);
      if (root.activeId === card.id) {
        root.view = "dash";
        root.activeId = null;
        root.detail = null;
      }
      await refreshCards();
      render();
      flash("Card deleted");
    } catch (e) {
      flash(e.message || "Delete failed", "err");
    }
  });
}

async function openCard(id) {
  try {
    const data = await musicApi.getCard(id);
    root.view = "detail";
    root.activeId = id;
    root.detail = data;
    root.lastSaved = data.card?.updated_at || null;
    root.saveError = null;
    render();
  } catch (e) {
    flash(e.message || "Could not open card", "err");
  }
}

function renderDetail(host) {
  const { card, takes } = root.detail;
  const head = el("div", { class: "music-detail-head" }, [
    el("input", {
      class: "title-edit",
      value: card.title || "",
      "aria-label": "Card title",
      oninput: (e) => {
        card.title = e.target.value;
        scheduleSave({ title: e.target.value });
      },
    }),
    el("div", { class: "actions" }, [
      el("button", {
        type: "button",
        class: "btn ghost",
        text: "Back",
        onclick: () => {
          root.view = "dash";
          root.detail = null;
          root.activeId = null;
          refreshCards().then(render);
        },
      }),
      el("button", {
        type: "button",
        class: "btn ghost",
        text: "Export card",
        onclick: () => exportBackup(card.id),
      }),
      el("button", {
        type: "button",
        class: "btn ghost",
        text: "Delete",
        onclick: () => confirmDeleteCard(card),
      }),
    ]),
  ]);

  const fields = el("div", { class: "music-fields" }, [
    fieldSelect("Status", "status", card.status, STATUSES.map((s) => ({ value: s.id, label: s.label })), (v) => {
      card.status = v;
      scheduleSave({ status: v });
    }),
    fieldText("Key", "key_text", card.key_text || "", (v) => {
      card.key_text = v;
      scheduleSave({ key_text: v });
    }),
    fieldText("Tempo", "tempo_text", card.tempo_text || "", (v) => {
      card.tempo_text = v;
      scheduleSave({ tempo_text: v });
    }),
  ]);

  const lyrics = fieldArea("Lyrics", card.lyrics || "", (v) => {
    card.lyrics = v;
    scheduleSave({ lyrics: v });
  });
  const notes = fieldArea("Notes", card.notes || "", (v) => {
    card.notes = v;
    scheduleSave({ notes: v });
  });

  const saveMeta = el("div", {
    class: "music-save-meta",
    text: saveMetaText(),
  });

  const mediaHead = el("div", { class: "panel-head", style: "margin-top:8px" }, [
    el("h3", { text: "Takes" }),
    el("div", { class: "row-actions" }, [
      el("label", { class: "btn", style: "display:inline-flex;align-items:center;cursor:pointer" }, [
        document.createTextNode("Add audio / video"),
        el("input", {
          type: "file",
          accept: "audio/*,video/*,.m4a,.mp3,.wav,.mp4,.mov",
          multiple: "",
          hidden: "",
          onchange: (e) => addFiles(e.target.files),
        }),
      ]),
    ]),
  ]);

  const takesList = el(
    "div",
    { class: "music-takes", id: "takes-list" },
    (takes || []).map((t, i) => takeRow(t, i)),
  );

  host.replaceChildren(
    head,
    fields,
    lyrics,
    notes,
    saveMeta,
    el("div", { class: "panel" }, [mediaHead, el("div", { class: "panel-body" }, [takesList])]),
    backupPanel(card.id),
  );
  enableTakeDnD(takesList);
}

function saveMetaText() {
  if (root.saving) return "Saving…";
  if (root.saveError) return `Save failed: ${root.saveError}`;
  if (root.lastSaved) return `Saved ${root.lastSaved}`;
  return "Not saved yet";
}

function fieldText(label, name, value, onChange) {
  return el("div", { class: "music-field" }, [
    el("label", { text: label, for: `mf-${name}` }),
    el("input", {
      id: `mf-${name}`,
      type: "text",
      value,
      oninput: (e) => onChange(e.target.value),
    }),
  ]);
}

function fieldSelect(label, name, value, options, onChange) {
  const select = el(
    "select",
    {
      id: `mf-${name}`,
      onchange: (e) => onChange(e.target.value),
    },
    options.map((o) => el("option", { value: o.value, text: o.label })),
  );
  select.value = value;
  return el("div", { class: "music-field" }, [el("label", { text: label, for: `mf-${name}` }), select]);
}

function fieldArea(label, value, onChange) {
  return el("div", { class: "music-field", style: "margin-bottom:12px" }, [
    el("label", { text: label }),
    el("textarea", {
      text: value,
      oninput: (e) => onChange(e.target.value),
    }),
  ]);
}

function scheduleSave(partial) {
  clearTimeout(root.saveTimer);
  root.saveTimer = setTimeout(() => commitSave(partial), 450);
  const meta = document.querySelector(".music-save-meta");
  if (meta) meta.textContent = "Saving…";
}

async function commitSave(partial) {
  if (!root.activeId) return;
  root.saving = true;
  root.saveError = null;
  try {
    const res = await musicApi.patchCard(root.activeId, partial);
    root.lastSaved = res.card?.updated_at || new Date().toISOString();
    if (root.detail) root.detail.card = { ...root.detail.card, ...res.card };
    root.saving = false;
    const meta = document.querySelector(".music-save-meta");
    if (meta) meta.textContent = saveMetaText();
  } catch (e) {
    root.saving = false;
    root.saveError = e.message || "write failed";
    const meta = document.querySelector(".music-save-meta");
    if (meta) meta.textContent = saveMetaText();
    flash(root.saveError, "err");
    showToast("Save failed — changes not committed", "err");
  }
}

async function addFiles(fileList) {
  if (!fileList?.length || !root.activeId) return;
  for (const file of fileList) {
    try {
      const take = await musicApi.uploadTake(root.activeId, file, { label: file.name });
      root.detail.takes.push(take);
      flash(`Uploaded ${file.name}`);
    } catch (e) {
      flash(e.message || `Upload failed for ${file.name}`, "err");
      showToast("Upload failed — original file unchanged on device", "err");
    }
  }
  render();
}

function takeRow(take, index) {
  const probe = probePlayback({ name: take.filename, type: take.content_type }, take.kind);
  const row = el("article", { class: "take", draggable: "true", "data-id": take.id }, [
    el("div", { class: "take-head" }, [
      el("button", { type: "button", class: "handle", text: "↕", title: "Drag to reorder", "aria-label": "Reorder" }),
      el("input", {
        class: "label-input",
        value: take.label || take.filename,
        "aria-label": "Take label",
        onchange: async (e) => {
          try {
            await musicApi.patchTake(take.id, { label: e.target.value });
            take.label = e.target.value;
          } catch (err) {
            flash(err.message || "Label save failed", "err");
          }
        },
      }),
      el("span", { class: "muted", text: `${take.kind} · ${formatBytes(take.byte_size)}` }),
      el("button", {
        type: "button",
        class: "btn ghost",
        text: "Delete",
        onclick: () => confirmDeleteTake(take),
      }),
    ]),
    el("input", {
      class: "note-input",
      type: "text",
      value: take.note || "",
      placeholder: "Take note…",
      onchange: async (e) => {
        try {
          await musicApi.patchTake(take.id, { note: e.target.value });
          take.note = e.target.value;
        } catch (err) {
          flash(err.message || "Note save failed", "err");
        }
      },
    }),
  ]);

  if (take.missing) {
    row.append(
      el("div", { class: "missing" }, [
        document.createTextNode("Media file missing from storage. "),
        el("label", { class: "btn", style: "display:inline-flex;cursor:pointer;margin-left:8px" }, [
          document.createTextNode("Relink file"),
          el("input", {
            type: "file",
            accept: take.kind === "video" ? "video/*,.mp4,.mov" : "audio/*,.m4a,.mp3,.wav",
            hidden: "",
            onchange: async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try {
                const res = await musicApi.relinkTake(take.id, f);
                Object.assign(take, res.take, { missing: false });
                flash("File relinked");
                render();
              } catch (err) {
                flash(err.message || "Relink failed", "err");
              }
            },
          }),
        ]),
      ]),
    );
  } else if (!probe.playable) {
    row.append(el("div", { class: "unplayable", text: probe.reason }));
  } else if (take.kind === "audio") {
    const audio = el("audio", {
      class: "player",
      controls: "",
      preload: "metadata",
      src: take.url,
    });
    let unplayable = false;
    attachPlaybackGuards(audio, (why) => {
      if (unplayable) return;
      unplayable = true;
      audio.replaceWith(el("div", { class: "unplayable", text: why }));
    });
    row.append(audio);
    row.append(cueUI(take, audio));
  } else {
    const video = el("video", {
      class: "player",
      controls: "",
      playsinline: "",
      preload: "metadata",
      src: take.url,
    });
    attachPlaybackGuards(video, (why) => {
      video.replaceWith(el("div", { class: "unplayable", text: why }));
    });
    row.append(video);
  }

  row.append(
    el("div", { class: "music-reorder-mobile" }, [
      el("button", {
        type: "button",
        class: "btn ghost",
        text: "Move up",
        onclick: () => moveTake(take.id, -1),
      }),
      el("button", {
        type: "button",
        class: "btn ghost",
        text: "Move down",
        onclick: () => moveTake(take.id, 1),
      }),
    ]),
  );

  return row;
}

function cueUI(take, audioEl) {
  const cues = Array.isArray(take.cue_notes) ? take.cue_notes.slice() : [];
  const list = el("div", { class: "cues" });
  const redraw = () => {
    list.replaceChildren(
      ...cues.map((c) =>
        el("div", { class: "cue" }, [
          el("button", {
            type: "button",
            text: formatTime(c.timeSec),
            onclick: () => {
              if (audioEl && !Number.isNaN(audioEl.duration)) {
                audioEl.currentTime = c.timeSec;
                audioEl.play().catch(() => {});
              }
            },
          }),
          el("span", { text: c.text }),
          el("button", {
            type: "button",
            class: "btn ghost",
            text: "Remove",
            onclick: async () => {
              const next = cues.filter((x) => x.id !== c.id);
              try {
                await musicApi.patchTake(take.id, { cue_notes: next });
                take.cue_notes = next;
                cues.splice(0, cues.length, ...next);
                redraw();
              } catch (e) {
                flash(e.message || "Cue delete failed", "err");
              }
            },
          }),
        ]),
      ),
    );
  };
  redraw();

  const textInput = el("input", { type: "text", placeholder: "Note at current time…" });
  const add = el("div", { class: "cue-add" }, [
    textInput,
    el("button", {
      type: "button",
      class: "btn",
      text: "Add cue",
      onclick: async () => {
        const text = textInput.value.trim();
        if (!text) return;
        const timeSec = audioEl?.currentTime || 0;
        const next = [...cues, { id: crypto.randomUUID(), timeSec, text }];
        try {
          await musicApi.patchTake(take.id, { cue_notes: next });
          take.cue_notes = next;
          cues.splice(0, cues.length, ...next);
          textInput.value = "";
          redraw();
        } catch (e) {
          flash(e.message || "Cue save failed", "err");
        }
      },
    }),
  ]);
  return el("div", {}, [list, add]);
}

function enableTakeDnD(list) {
  if (!list) return;
  let dragId = null;
  list.querySelectorAll(".take").forEach((node) => {
    node.addEventListener("dragstart", () => {
      dragId = node.getAttribute("data-id");
      node.classList.add("dragging");
    });
    node.addEventListener("dragend", () => node.classList.remove("dragging"));
    node.addEventListener("dragover", (e) => e.preventDefault());
    node.addEventListener("drop", async (e) => {
      e.preventDefault();
      const targetId = node.getAttribute("data-id");
      if (!dragId || dragId === targetId) return;
      const ids = root.detail.takes.map((t) => t.id);
      const from = ids.indexOf(dragId);
      const to = ids.indexOf(targetId);
      if (from < 0 || to < 0) return;
      ids.splice(to, 0, ids.splice(from, 1)[0]);
      try {
        await musicApi.reorderTakes(root.activeId, ids);
        root.detail.takes.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
        render();
      } catch (err) {
        flash(err.message || "Take reorder failed", "err");
      }
    });
  });
}

async function moveTake(id, delta) {
  const ids = root.detail.takes.map((t) => t.id);
  const i = ids.indexOf(id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  try {
    await musicApi.reorderTakes(root.activeId, ids);
    root.detail.takes.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
    render();
  } catch (e) {
    flash(e.message || "Take reorder failed", "err");
  }
}

function confirmDeleteTake(take) {
  askConfirm(`Delete take “${take.label || take.filename}”?`, async () => {
    try {
      await musicApi.deleteTake(take.id);
      root.detail.takes = root.detail.takes.filter((t) => t.id !== take.id);
      render();
      flash("Take deleted");
    } catch (e) {
      flash(e.message || "Delete failed", "err");
    }
  });
}

function backupPanel(cardId = null) {
  return el("section", { class: "music-backup" }, [
    el("h3", { text: "Backup & restore" }),
    el("p", {
      text:
        "Card data lives in Cloudflare D1 and media in R2 (prefix music/), both behind your existing Cloudflare Access login on /private* and /api*. " +
        "This is not browser-only storage — opening Music Studio on another signed-in device shows the same library. " +
        "Exports download a zip to this device; keep those files safe. Large libraries may need per-card exports if a full zip is too big for the browser.",
    }),
    el("div", { class: "actions" }, [
      el("button", {
        type: "button",
        class: "btn",
        text: cardId ? "Export this card" : "Export everything",
        onclick: () => exportBackup(cardId),
      }),
      el("label", { class: "btn ghost", style: "display:inline-flex;align-items:center;cursor:pointer" }, [
        document.createTextNode("Import backup"),
        el("input", {
          type: "file",
          accept: ".zip,application/zip",
          hidden: "",
          onchange: (e) => {
            const f = e.target.files?.[0];
            if (f) importBackup(f);
            e.target.value = "";
          },
        }),
      ]),
    ]),
  ]);
}

async function exportBackup(cardId = null) {
  try {
    flash("Building backup…");
    const manifest = await musicApi.exportManifest(cardId);
    const files = [{ name: "manifest.json", data: JSON.stringify(manifest, null, 2) }];
    let failed = 0;
    for (const take of manifest.takes || []) {
      try {
        const bytes = await musicApi.fetchTakeBytes(take.id);
        const path = take.file_path || `media/${take.id}-${take.filename}`;
        files.push({ name: path, data: bytes });
      } catch {
        failed += 1;
      }
    }
    const zip = buildZip(files);
    const url = URL.createObjectURL(zip);
    const a = el("a", {
      href: url,
      download: cardId ? `music-card-${cardId}.zip` : "music-workspace-backup.zip",
    });
    document.body.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    flash(
      failed
        ? `Backup downloaded with ${failed} missing media file(s) omitted`
        : "Backup downloaded",
    );
  } catch (e) {
    flash(e.message || "Export failed", "err");
  }
}

async function importBackup(file) {
  try {
    const entries = await readZip(file);
    const raw = entries.get("manifest.json");
    if (!raw) throw new Error("manifest.json missing from zip");
    const parsed = JSON.parse(new TextDecoder().decode(raw));
    const check = validateManifest(parsed);
    if (!check.ok) throw new Error(check.error);

    const presentPaths = [...entries.keys()].filter((k) => k !== "manifest.json");
    const takesMarked = markMissingTakes(check.manifest.takes, presentPaths);
    const decisions = planImportCollisions(check.manifest, root.cards, "rename");

    let created = 0;
    let skipped = 0;
    for (const d of decisions) {
      if (d.action === "skip") {
        skipped += 1;
        continue;
      }
      const card = await musicApi.createCard({
        title: d.newTitle,
        status: d.card.status || "idea",
        key_text: d.card.key_text,
        tempo_text: d.card.tempo_text,
        lyrics: d.card.lyrics || "",
        notes: d.card.notes || "",
      });
      created += 1;
      const cardTakes = takesMarked.filter((t) => t.card_id === d.card.id);
      for (const t of cardTakes) {
        const path = t.file_path || `media/${t.id}-${t.filename}`;
        const bytes = entries.get(path) || entries.get(t.filename);
        if (bytes) {
          const blob = new Blob([bytes], { type: t.content_type || "application/octet-stream" });
          const f = new File([blob], t.filename || "take", { type: t.content_type || "application/octet-stream" });
          try {
            await musicApi.uploadTake(card.id, f, { label: t.label || t.filename, note: t.note || "" });
          } catch (err) {
            flash(`Take upload failed (${t.filename}): ${err.message}`, "err");
          }
        } else {
          await musicApi.createTakeStub({
            card_id: card.id,
            kind: t.kind,
            filename: t.filename,
            label: t.label,
            note: t.note,
            content_type: t.content_type,
            cue_notes: t.cue_notes || [],
          });
        }
      }
    }
    await refreshCards();
    render();
    flash(`Import done: ${created} card(s) created${skipped ? `, ${skipped} skipped` : ""}. Colliding titles were renamed.`);
  } catch (e) {
    flash(e.message || "Import failed", "err");
  }
}

function askConfirm(message, onYes) {
  const existing = document.getElementById("music-confirm");
  if (existing) existing.remove();
  const box = el("div", { class: "music-confirm", id: "music-confirm" }, [
    el("div", { class: "music-confirm-box" }, [
      el("h2", { text: "Confirm" }),
      el("p", { text: message }),
      el("div", { class: "music-confirm-actions" }, [
        el("button", {
          type: "button",
          class: "btn ghost",
          text: "Cancel",
          onclick: () => box.remove(),
        }),
        el("button", {
          type: "button",
          class: "btn",
          text: "Delete",
          onclick: async () => {
            box.remove();
            await onYes();
          },
        }),
      ]),
    ]),
  ]);
  document.body.append(box);
}

// silence unused import warnings in some tooling
void MANIFEST_FORMAT;
void MANIFEST_VERSION;
