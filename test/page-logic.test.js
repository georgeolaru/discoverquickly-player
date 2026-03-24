const test = require("node:test");
const assert = require("node:assert/strict");

let pageLogic;

try {
  pageLogic = require("../page-logic.js");
} catch (error) {
  pageLogic = {};
}

test("attachPanelEventListeners wires keydown capture on the panel document", () => {
  assert.equal(typeof pageLogic.attachPanelEventListeners, "function");

  const events = [];
  const panelDoc = {
    addEventListener(type, handler, options) {
      events.push({ type, handler, options });
    }
  };
  const handlers = {
    onChange() {},
    onClick() {},
    onKeydown() {}
  };

  pageLogic.attachPanelEventListeners(panelDoc, handlers);

  assert.deepEqual(
    events.map(({ options, type }) => ({ options, type })),
    [
      { type: "click", options: undefined },
      { type: "change", options: undefined },
      { type: "keydown", options: true }
    ]
  );
});

test("getHotkeyAction maps B to bookmark when the target is not typing", () => {
  assert.equal(typeof pageLogic.getHotkeyAction, "function");

  assert.equal(
    pageLogic.getHotkeyAction({
      altKey: false,
      code: "KeyB",
      ctrlKey: false,
      defaultPrevented: false,
      isTypingTarget: false,
      key: "B",
      metaKey: false
    }),
    "bookmark"
  );

  assert.equal(
    pageLogic.getHotkeyAction({
      altKey: false,
      code: "KeyB",
      ctrlKey: false,
      defaultPrevented: false,
      isTypingTarget: true,
      key: "B",
      metaKey: false
    }),
    null
  );
});

test("shouldQueueSection enables Tracks for album pages", () => {
  assert.equal(typeof pageLogic.shouldQueueSection, "function");

  assert.equal(pageLogic.shouldQueueSection("album", "Tracks"), true);
  assert.equal(pageLogic.shouldQueueSection("album", "Albums"), false);
  assert.equal(pageLogic.shouldQueueSection("album", "TracksPlay Queue"), true);
});

test("shouldQueueSection keeps artist-only sections unchanged", () => {
  assert.equal(typeof pageLogic.shouldQueueSection, "function");

  assert.equal(pageLogic.shouldQueueSection("artist", "Top Tracks"), true);
  assert.equal(pageLogic.shouldQueueSection("artist", "Tracks"), false);
  assert.equal(pageLogic.shouldQueueSection("artist", "Top Tracks Resume Queue"), true);
});

test("normalizeSectionTitle strips inline queue labels from headings", () => {
  assert.equal(typeof pageLogic.normalizeSectionTitle, "function");

  assert.equal(pageLogic.normalizeSectionTitle("TracksPlay Queue"), "tracks");
  assert.equal(pageLogic.normalizeSectionTitle("Top Tracks Resume Queue"), "top tracks");
  assert.equal(pageLogic.normalizeSectionTitle("Albums Pause Queue"), "albums");
});

test("shouldUpdateInlineAction returns false when inline button state is unchanged", () => {
  assert.equal(typeof pageLogic.shouldUpdateInlineAction, "function");

  assert.equal(
    pageLogic.shouldUpdateInlineAction(
      {
        cardKey: "album::tracks",
        className: "dq-queue-player-inline-action is-active",
        label: "Resume Queue",
        mode: "resume"
      },
      {
        cardKey: "album::tracks",
        className: "dq-queue-player-inline-action is-active",
        label: "Resume Queue",
        mode: "resume"
      }
    ),
    false
  );
});

test("shouldUpdateInlineAction returns true when inline button label changes", () => {
  assert.equal(typeof pageLogic.shouldUpdateInlineAction, "function");

  assert.equal(
    pageLogic.shouldUpdateInlineAction(
      {
        cardKey: "album::tracks",
        className: "dq-queue-player-inline-action is-active",
        label: "Resume Queue",
        mode: "resume"
      },
      {
        cardKey: "album::tracks",
        className: "dq-queue-player-inline-action",
        label: "Play Queue",
        mode: "play"
      }
    ),
    true
  );
});

test("getPartialScanHold keeps previous cards during a transient subset scan", () => {
  assert.equal(typeof pageLogic.getPartialScanHold, "function");

  assert.deepEqual(
    pageLogic.getPartialScanHold({
      graceMs: 400,
      now: 1000,
      partialKey: "",
      partialSince: 0,
      previousKeys: ["release-radar", "related-artists", "top-tracks"],
      nextKeys: ["release-radar"],
      selectedCardKey: "release-radar"
    }),
    {
      hold: true,
      partialKey: "release-radar",
      partialSince: 1000,
      retryInMs: 400
    }
  );
});

test("getPartialScanHold accepts a stable subset after the grace window", () => {
  assert.equal(typeof pageLogic.getPartialScanHold, "function");

  assert.deepEqual(
    pageLogic.getPartialScanHold({
      graceMs: 400,
      now: 1450,
      partialKey: "release-radar",
      partialSince: 1000,
      previousKeys: ["release-radar", "related-artists", "top-tracks"],
      nextKeys: ["release-radar"],
      selectedCardKey: "release-radar"
    }),
    {
      hold: false,
      partialKey: "",
      partialSince: 0,
      retryInMs: 0
    }
  );
});
