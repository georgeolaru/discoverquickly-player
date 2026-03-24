(function initDQQueuePlayerLogic(root, factory) {
  const api = factory();
  root.__DQQueuePlayerLogic = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  const QUEUEABLE_SECTION_TITLES = {
    album: new Set(["tracks"]),
    artist: new Set(["top tracks", "albums", "singles & compilations", "appears on", "related artists"])
  };

  function attachPanelEventListeners(panelDoc, { onChange, onClick, onKeydown }) {
    panelDoc.addEventListener("click", onClick);
    panelDoc.addEventListener("change", onChange);
    panelDoc.addEventListener("keydown", onKeydown, true);
  }

  function normalizeSectionTitle(sectionTitle) {
    return String(sectionTitle || "")
      .replace(/\s*(play|pause|resume)\s*queue$/i, "")
      .trim()
      .toLowerCase();
  }

  function shouldQueueSection(cardType, sectionTitle) {
    return QUEUEABLE_SECTION_TITLES[cardType]?.has(normalizeSectionTitle(sectionTitle)) || false;
  }

  function shouldUpdateInlineAction(currentState, nextState) {
    if (!currentState) {
      return true;
    }

    return (
      currentState.cardKey !== nextState.cardKey ||
      currentState.className !== nextState.className ||
      currentState.label !== nextState.label ||
      currentState.mode !== nextState.mode
    );
  }

  function getHotkeyAction({
    altKey,
    code,
    ctrlKey,
    defaultPrevented,
    isTypingTarget,
    key,
    metaKey
  }) {
    if (defaultPrevented || altKey || ctrlKey || metaKey || isTypingTarget) {
      return null;
    }

    if (code === "Space") {
      return "toggle";
    }

    const normalizedKey = String(key || "").toLowerCase();
    if (normalizedKey === "j") {
      return "prev";
    }

    if (normalizedKey === "k") {
      return "next";
    }

    if (normalizedKey === "b") {
      return "bookmark";
    }

    return null;
  }

  function getPartialScanHold({
    graceMs,
    now,
    partialKey,
    partialSince,
    previousKeys,
    nextKeys,
    selectedCardKey
  }) {
    if (!previousKeys.length || nextKeys.length === 0 || nextKeys.length >= previousKeys.length) {
      return {
        hold: false,
        partialKey: "",
        partialSince: 0,
        retryInMs: 0
      };
    }

    const previousKeySet = new Set(previousKeys);
    const isSubset = nextKeys.every((key) => previousKeySet.has(key));
    const selectedStillPresent = !selectedCardKey || nextKeys.includes(selectedCardKey);

    if (!isSubset || !selectedStillPresent) {
      return {
        hold: false,
        partialKey: "",
        partialSince: 0,
        retryInMs: 0
      };
    }

    const nextPartialKey = nextKeys.join("||");
    if (partialKey !== nextPartialKey || !partialSince) {
      return {
        hold: true,
        partialKey: nextPartialKey,
        partialSince: now,
        retryInMs: graceMs
      };
    }

    const elapsed = now - partialSince;
    if (elapsed < graceMs) {
      return {
        hold: true,
        partialKey,
        partialSince,
        retryInMs: graceMs - elapsed
      };
    }

    return {
      hold: false,
      partialKey: "",
      partialSince: 0,
      retryInMs: 0
    };
  }

  return {
    attachPanelEventListeners,
    getHotkeyAction,
    getPartialScanHold,
    normalizeSectionTitle,
    shouldUpdateInlineAction,
    shouldQueueSection
  };
});
