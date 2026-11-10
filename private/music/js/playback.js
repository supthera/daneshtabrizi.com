/** Playback capability checks — never transcode. */

export function probePlayback(fileOrType, kind) {
  const type = typeof fileOrType === "string" ? fileOrType : fileOrType?.type || "";
  const name = typeof fileOrType === "string" ? "" : fileOrType?.name || "";
  const ext = name.includes(".") ? name.split(".").pop().toLowerCase() : "";

  const el = kind === "video" ? document.createElement("video") : document.createElement("audio");
  const candidates = [];
  if (type) candidates.push(type);
  if (ext === "m4a" || ext === "aac") candidates.push("audio/mp4", "audio/aac", "audio/x-m4a");
  if (ext === "mp3") candidates.push("audio/mpeg");
  if (ext === "wav") candidates.push("audio/wav", "audio/wave");
  if (ext === "mp4" || ext === "m4v") candidates.push("video/mp4");
  if (ext === "mov") candidates.push("video/quicktime", "video/mp4");
  if (ext === "webm") candidates.push(kind === "video" ? "video/webm" : "audio/webm");
  if (ext === "ogg") candidates.push("audio/ogg");

  let best = "";
  for (const c of candidates) {
    const r = el.canPlayType(c);
    if (r === "probably") return { playable: true, support: r, type: c };
    if (r === "maybe" && !best) best = c;
  }
  if (best) return { playable: true, support: "maybe", type: best };

  return {
    playable: false,
    support: "",
    type: type || candidates[0] || "",
    reason: `This browser reports no support for ${type || ext || kind}. The file is still stored; try another device/browser or export the take.`,
  };
}

export function attachPlaybackGuards(mediaEl, onUnplayable) {
  if (!mediaEl) return;
  const fail = (why) => {
    if (typeof onUnplayable === "function") onUnplayable(why || "Playback failed");
  };
  mediaEl.addEventListener("error", () => {
    const err = mediaEl.error;
    const map = {
      1: "Playback aborted",
      2: "Network error while loading media",
      3: "Media decode failed",
      4: "Format not supported by this browser",
    };
    fail(map[err?.code] || "Playback failed");
  });
}
