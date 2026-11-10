/**
 * Music workspace pure-logic tests (Node, no browser).
 * Run: node --test private/music/js/model.test.mjs
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MANIFEST_FORMAT,
  MANIFEST_VERSION,
  filterCards,
  buildManifest,
  validateManifest,
  planImportCollisions,
  markMissingTakes,
  statusLabel,
  formatBytes,
  formatTime,
} from "./model.js";
import { buildZip, readZip } from "./zip.js";

describe("status + filter", () => {
  it("labels known statuses", () => {
    assert.equal(statusLabel("idea"), "Idea");
    assert.equal(statusLabel("in_progress"), "In progress");
    assert.equal(statusLabel("finished"), "Finished");
  });

  it("filters by query, status, archived", () => {
    const cards = [
      { id: "1", title: "Blue Sky", status: "idea", archived: 0 },
      { id: "2", title: "Night Drive", status: "finished", archived: 0 },
      { id: "3", title: "Blue Note", status: "idea", archived: 1 },
    ];
    assert.equal(filterCards(cards, { query: "blue" }).length, 1);
    assert.equal(filterCards(cards, { query: "blue", showArchived: true }).length, 2);
    assert.equal(filterCards(cards, { status: "finished" }).length, 1);
  });
});

describe("manifest validate + collisions", () => {
  it("rejects bad manifests", () => {
    assert.equal(validateManifest(null).ok, false);
    assert.equal(validateManifest({ format: "x", version: 1, cards: [], takes: [] }).ok, false);
    assert.equal(validateManifest({ format: MANIFEST_FORMAT, version: 99, cards: [], takes: [] }).ok, false);
  });

  it("accepts current version", () => {
    const m = buildManifest({
      cards: [{ id: "a", title: "Song" }],
      takes: [{ id: "t1", card_id: "a", filename: "a.m4a" }],
    });
    assert.equal(m.format, MANIFEST_FORMAT);
    assert.equal(m.version, MANIFEST_VERSION);
    assert.equal(validateManifest(m).ok, true);
  });

  it("renames on title collision and never silently overwrites", () => {
    const manifest = {
      format: MANIFEST_FORMAT,
      version: MANIFEST_VERSION,
      cards: [{ id: "new", title: "Song" }],
      takes: [],
    };
    const existing = [{ id: "old", title: "Song" }];
    const plan = planImportCollisions(manifest, existing, "rename");
    assert.equal(plan.length, 1);
    assert.equal(plan[0].action, "create");
    assert.equal(plan[0].renamed, true);
    assert.match(plan[0].newTitle, /import/i);
    assert.notEqual(plan[0].newId, "new");
  });

  it("skip mode leaves colliding cards alone", () => {
    const manifest = {
      format: MANIFEST_FORMAT,
      version: MANIFEST_VERSION,
      cards: [{ id: "old", title: "X" }],
      takes: [],
    };
    const plan = planImportCollisions(manifest, [{ id: "old", title: "X" }], "skip");
    assert.equal(plan[0].action, "skip");
  });
});

describe("missing takes + formatters", () => {
  it("marks missing media paths", () => {
    const takes = [
      { id: "1", filename: "a.m4a", file_path: "media/1-a.m4a" },
      { id: "2", filename: "b.mp3", file_path: "media/2-b.mp3" },
    ];
    const marked = markMissingTakes(takes, ["media/1-a.m4a"]);
    assert.equal(marked[0].missing, false);
    assert.equal(marked[1].missing, true);
  });

  it("formats bytes and time", () => {
    assert.equal(formatBytes(500), "500 B");
    assert.match(formatBytes(2048), /KB/);
    assert.equal(formatTime(65), "1:05");
  });
});

describe("zip roundtrip + import path", () => {
  it("store-only zip roundtrips manifest and media bytes", async () => {
    const manifest = buildManifest({
      cards: [{ id: "c1", title: "Fixture Song", status: "idea", lyrics: "la", notes: "n" }],
      takes: [
        {
          id: "t1",
          card_id: "c1",
          kind: "audio",
          filename: "fixture.m4a",
          file_path: "media/t1-fixture.m4a",
        },
      ],
    });
    const audio = new TextEncoder().encode("FAKE-AUDIO-BYTES");
    const zip = buildZip([
      { name: "manifest.json", data: JSON.stringify(manifest) },
      { name: "media/t1-fixture.m4a", data: audio },
    ]);
    const entries = await readZip(zip);
    assert.ok(entries.has("manifest.json"));
    assert.ok(entries.has("media/t1-fixture.m4a"));
    const round = JSON.parse(new TextDecoder().decode(entries.get("manifest.json")));
    assert.equal(validateManifest(round).ok, true);
    assert.deepEqual([...entries.get("media/t1-fixture.m4a")], [...audio]);

    // Relink behavior: missing path stays marked missing for UI
    const withoutMedia = markMissingTakes(round.takes, ["manifest.json"]);
    assert.equal(withoutMedia[0].missing, true);

    // Collision rename before create (import never overwrites)
    const decisions = planImportCollisions(round, [{ id: "other", title: "Fixture Song" }], "rename");
    assert.equal(decisions[0].renamed, true);
    assert.notEqual(decisions[0].newTitle, "Fixture Song");
  });
});
