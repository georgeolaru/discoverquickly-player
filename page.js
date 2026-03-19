(() => {
  if (window.__dqQueuePlayerInstalled) {
    return;
  }

  window.__dqQueuePlayerInstalled = true;

  const STORAGE_KEYS = {
    notes: "dq-queue-player-notes-v1",
    selectedCard: "dq-queue-player-selected-card-v1"
  };
  const ARTIST_SECTION_TITLES = new Set(["Top Tracks", "Albums", "Singles & Compilations", "Appears On"]);
  const DEFAULT_STATUS = "Waiting for a queueable section...";
  const INLINE_ACTION_SELECTOR = "[data-dq-queue-inline-action]";
  const PANEL_ID = "dq-queue-player-panel";
  const STYLE_ID = "dq-queue-player-style";
  const JUMP_FLASH_MS = 1200;

  const state = {
    audio: new Audio(),
    cards: [],
    currentTrackId: "",
    currentTrackIndex: -1,
    hoverPausedQueue: false,
    hoverResumeTimer: 0,
    hoveredPlayable: null,
    notesByCard: readJson(STORAGE_KEYS.notes, {}),
    observer: null,
    panel: null,
    panelDoc: null,
    panelRoot: null,
    refreshTimer: 0,
    selectedCardKey: localStorage.getItem(STORAGE_KEYS.selectedCard) || "",
    status: DEFAULT_STATUS
  };

  state.audio.preload = "auto";
  state.audio.addEventListener("ended", () => playRelative(1));
  state.audio.addEventListener("playing", render);
  state.audio.addEventListener("pause", render);
  state.audio.addEventListener("error", () => {
    state.status = "Preview failed. Skipping.";
    render();
    playRelative(1);
  });

  function readJson(key, fallbackValue) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallbackValue;
    } catch (error) {
      console.warn("[DQ Queue Player] Failed to read localStorage key:", key, error);
      return fallbackValue;
    }
  }

  function writeJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function getHeadingText(heading) {
    if (!heading) {
      return "";
    }

    const clone = heading.cloneNode(true);
    clone.querySelectorAll("*").forEach((node) => node.remove());
    return normalizeText(clone.textContent);
  }

  function getBackgroundImageUrl(element) {
    const backgroundImage = getComputedStyle(element).backgroundImage || "";
    const match = backgroundImage.match(/url\("?(.*?)"?\)/);
    return match ? match[1] : "";
  }

  function findReactProps(element) {
    const key = Object.keys(element).find(
      (candidate) => candidate.startsWith("__reactEventHandlers") || candidate.startsWith("__reactProps")
    );
    return key ? element[key] : null;
  }

  function isTrackProps(value) {
    return Boolean(
      value &&
        typeof value === "object" &&
        typeof value.id === "string" &&
        typeof value.previewUrl === "string" &&
        value.previewUrl &&
        value.captionData &&
        typeof value.captionData.track_name === "string"
    );
  }

  function deepFindTrackProps(value, depth = 0, seen = new WeakSet()) {
    if (!value || typeof value !== "object" || depth > 4) {
      return null;
    }

    if (seen.has(value)) {
      return null;
    }

    seen.add(value);

    if (isTrackProps(value)) {
      return value;
    }

    if (value instanceof Node) {
      return null;
    }

    if (Array.isArray(value)) {
      for (const child of value.slice(0, 8)) {
        const found = deepFindTrackProps(child, depth + 1, seen);
        if (found) {
          return found;
        }
      }
      return null;
    }

    for (const [key, child] of Object.entries(value).slice(0, 20)) {
      if (
        key === "alternate" ||
        key === "child" ||
        key === "return" ||
        key === "sibling" ||
        key === "stateNode" ||
        key.startsWith("__react")
      ) {
        continue;
      }

      const found = deepFindTrackProps(child, depth + 1, seen);
      if (found) {
        return found;
      }
    }

    return null;
  }

  function extractTrackProps(playableElement) {
    const reactProps = findReactProps(playableElement);
    if (!reactProps) {
      return null;
    }

    const candidates = [
      reactProps,
      reactProps.children,
      Array.isArray(reactProps.children) ? reactProps.children[1] : null,
      Array.isArray(reactProps.children) ? reactProps.children[1]?._owner?.stateNode?.props : null,
      reactProps.children?._owner?.stateNode?.props,
      reactProps._owner?.stateNode?.props
    ];

    for (const candidate of candidates) {
      if (isTrackProps(candidate)) {
        return candidate;
      }
    }

    return deepFindTrackProps(reactProps);
  }

  function extractTrack(playableElement, index) {
    const props = extractTrackProps(playableElement);
    if (!props) {
      return null;
    }

    return {
      artistName: normalizeText(props.captionData?.track_artist_name),
      element: playableElement,
      id: props.id,
      index,
      previewUrl: props.previewUrl,
      trackName: normalizeText(props.captionData?.track_name || `Track ${index + 1}`)
    };
  }

  function createSource({ coverUrl = "", element, key, launchTarget = null, title, tracks }) {
    return {
      coverUrl,
      element,
      key,
      launchTarget,
      title,
      tracks
    };
  }

  function scanGridSources() {
    return [...document.querySelectorAll(".card")]
      .map((cardElement, index) => {
        if (cardElement.matches(".card-artist")) {
          return null;
        }

        const gridElement = cardElement.querySelector(".itemGrid");
        if (!gridElement) {
          return null;
        }

        const tracks = [...gridElement.querySelectorAll(".playable")]
          .map((playableElement, trackIndex) => extractTrack(playableElement, trackIndex))
          .filter(Boolean);

        if (!tracks.length) {
          return null;
        }

        const title =
          getHeadingText(cardElement.querySelector(".playlist-name")) ||
          getHeadingText(cardElement.querySelector("h1")) ||
          `Queue ${index + 1}`;
        const launchTarget = cardElement.querySelector(".playlist-name") || cardElement.querySelector("h1");
        const coverElement = cardElement.querySelector(".playlist-main-image .itemImg, .header .itemImg");
        const coverUrl = coverElement ? getBackgroundImageUrl(coverElement) : "";

        return createSource({
          coverUrl,
          element: cardElement,
          key: [title, cardElement.className, coverUrl].filter(Boolean).join("::") || `card-${index}`,
          launchTarget,
          title,
          tracks
        });
      })
      .filter(Boolean);
  }

  function scanArtistSectionSources() {
    return [...document.querySelectorAll(".card-artist")].flatMap((cardElement, cardIndex) => {
      const title = getHeadingText(cardElement.querySelector("h1")) || `Artist ${cardIndex + 1}`;
      const coverElement = cardElement.querySelector(".playable-artist .itemImg");
      const coverUrl = coverElement ? getBackgroundImageUrl(coverElement) : "";
      const container = cardElement.querySelector(".gridContainer");
      if (!container) {
        return [];
      }

      const sections = new Map();
      let currentSection = "";
      let currentHeadingElement = null;
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_ELEMENT);

      while (walker.nextNode()) {
        const element = walker.currentNode;
        if (element.tagName === "H4") {
          currentSection = normalizeText(element.textContent);
          currentHeadingElement = element;
          continue;
        }

        if (!ARTIST_SECTION_TITLES.has(currentSection) || !element.classList?.contains("playable")) {
          continue;
        }

        const sectionData = sections.get(currentSection) || {
          launchTarget: currentHeadingElement,
          tracks: []
        };
        const track = extractTrack(element, sectionData.tracks.length);
        if (!track) {
          continue;
        }

        sectionData.tracks.push(track);
        sections.set(currentSection, sectionData);
      }

      return [...sections.entries()].map(([sectionTitle, sectionData], sectionIndex) =>
        createSource({
          coverUrl,
          element: cardElement,
          key: [title, sectionTitle, coverUrl].filter(Boolean).join("::") || `artist-${cardIndex}-${sectionIndex}`,
          launchTarget: sectionData.launchTarget,
          title: `${title} · ${sectionTitle}`,
          tracks: sectionData.tracks
        })
      );
    });
  }

  function scanCards() {
    return [...scanGridSources(), ...scanArtistSectionSources()];
  }

  function persistNotes() {
    writeJson(STORAGE_KEYS.notes, state.notesByCard);
  }

  function getSelectedCard() {
    return state.cards.find((card) => card.key === state.selectedCardKey) || state.cards[0] || null;
  }

  function getNotesForCard(cardKey) {
    return Array.isArray(state.notesByCard[cardKey]) ? state.notesByCard[cardKey] : [];
  }

  function getCurrentTrack() {
    const card = getSelectedCard();
    if (!card || state.currentTrackIndex < 0 || state.currentTrackIndex >= card.tracks.length) {
      return null;
    }

    return card.tracks[state.currentTrackIndex];
  }

  function updateMediaSession() {
    if (!("mediaSession" in navigator)) {
      return;
    }

    const source = getSelectedCard();
    const track = getCurrentTrack();

    try {
      navigator.mediaSession.playbackState = state.audio.src ? (state.audio.paused ? "paused" : "playing") : "none";
    } catch (error) {
      return;
    }

    if (!track) {
      navigator.mediaSession.metadata = null;
      return;
    }

    const metadata = {
      title: track.trackName,
      artist: track.artistName,
      album: source?.title || "DQ Queue"
    };

    if (source?.coverUrl) {
      metadata.artwork = [{ src: source.coverUrl }];
    }

    try {
      navigator.mediaSession.metadata = new MediaMetadata(metadata);
    } catch (error) {
      navigator.mediaSession.metadata = null;
    }
  }

  function installMediaSessionHandlers() {
    if (!("mediaSession" in navigator)) {
      return;
    }

    const handlers = {
      nexttrack: () => playRelative(1),
      pause: () => {
        if (!state.audio.paused) {
          state.audio.pause();
          state.status = "Paused.";
          render();
        }
      },
      play: () => togglePlayback(),
      previoustrack: () => playRelative(-1),
      stop: () => {
        state.audio.pause();
        state.status = "Paused.";
        render();
      }
    };

    Object.entries(handlers).forEach(([action, handler]) => {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch (error) {
        // Ignore unsupported Media Session actions.
      }
    });
  }

  function isTypingTarget(target) {
    return Boolean(
      target &&
        (target.isContentEditable ||
          ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName) ||
          target.closest(`#${PANEL_ID} textarea`) ||
          target.closest(`#${PANEL_ID} input`) ||
          target.closest(`#${PANEL_ID} select`))
    );
  }

  function stopAndResetAudio() {
    window.clearTimeout(state.hoverResumeTimer);
    state.hoverResumeTimer = 0;
    state.hoverPausedQueue = false;
    state.hoveredPlayable = null;
    state.audio.pause();
    state.audio.removeAttribute("src");
    state.audio.load();
    state.currentTrackId = "";
    state.currentTrackIndex = -1;
  }

  function clearAudioSource() {
    window.clearTimeout(state.hoverResumeTimer);
    state.hoverResumeTimer = 0;
    state.hoverPausedQueue = false;
    state.hoveredPlayable = null;
    state.audio.pause();
    state.audio.removeAttribute("src");
    state.audio.load();
  }

  function setSelectedCard(cardKey, { resetPlayback = true } = {}) {
    state.selectedCardKey = cardKey;
    localStorage.setItem(STORAGE_KEYS.selectedCard, cardKey);

    if (resetPlayback) {
      stopAndResetAudio();
      const card = getSelectedCard();
      state.status = card ? `${card.tracks.length} previews ready.` : DEFAULT_STATUS;
    }

    render();
  }

  async function playSourceByKey(cardKey, { restart = true } = {}) {
    setSelectedCard(cardKey, { resetPlayback: restart });

    if (!restart && state.audio.src) {
      await togglePlayback();
      return;
    }

    await playTrack(0);
  }

  function quietSiteHoverPreview() {
    window.clearTimeout(state.hoverResumeTimer);
    state.hoverResumeTimer = 0;
    state.hoverPausedQueue = false;
    state.hoveredPlayable = null;
    document.querySelectorAll(".playable").forEach((element) => {
      element.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
    });
  }

  function scheduleResumeAfterHover() {
    window.clearTimeout(state.hoverResumeTimer);
    state.hoverResumeTimer = window.setTimeout(async () => {
      state.hoverResumeTimer = 0;

      if (state.hoveredPlayable || !state.hoverPausedQueue || !state.audio.src) {
        return;
      }

      state.hoverPausedQueue = false;
      quietSiteHoverPreview();

      try {
        await state.audio.play();
        state.status = `Playing ${state.currentTrackIndex + 1}/${getSelectedCard()?.tracks.length || 0}`;
      } catch (error) {
        state.status = `Click Play once to allow audio: ${error.message || error}`;
      }

      render();
    }, 140);
  }

  function handlePlayableMouseOver(event) {
    const playable = event.target.closest(".playable");
    if (!playable || playable.contains(event.relatedTarget)) {
      return;
    }

    window.clearTimeout(state.hoverResumeTimer);
    state.hoverResumeTimer = 0;
    state.hoveredPlayable = playable;

    if (state.audio.src && !state.audio.paused && !state.hoverPausedQueue) {
      state.hoverPausedQueue = true;
      state.audio.pause();
      state.status = "Paused while previewing hovered item.";
      render();
    }
  }

  function handlePlayableMouseOut(event) {
    const playable = event.target.closest(".playable");
    if (!playable || playable.contains(event.relatedTarget) || state.hoveredPlayable !== playable) {
      return;
    }

    state.hoveredPlayable = null;
    if (state.hoverPausedQueue) {
      scheduleResumeAfterHover();
    }
  }

  async function playTrack(index) {
    const card = getSelectedCard();
    if (!card || !card.tracks.length) {
      state.status = "No tracks found on this card.";
      render();
      return;
    }

    const nextIndex = Math.max(0, Math.min(index, card.tracks.length - 1));
    const track = card.tracks[nextIndex];

    if (!track?.previewUrl) {
      state.status = "Missing preview URL. Skipping.";
      render();
      playRelative(1);
      return;
    }

    state.currentTrackIndex = nextIndex;
    state.currentTrackId = track.id;
    state.status = `Playing ${nextIndex + 1}/${card.tracks.length}`;
    quietSiteHoverPreview();
    state.audio.src = track.previewUrl;

    try {
      await state.audio.play();
    } catch (error) {
      state.status = `Click Play once to allow audio: ${error.message || error}`;
    }

    render();
  }

  function playRelative(offset) {
    const card = getSelectedCard();
    if (!card || !card.tracks.length) {
      state.status = "No tracks found on this card.";
      render();
      return;
    }

    if (state.currentTrackIndex < 0) {
      playTrack(offset < 0 ? card.tracks.length - 1 : 0);
      return;
    }

    const nextIndex = state.currentTrackIndex + offset;
    if (nextIndex < 0) {
      state.status = "Already at the first track.";
      render();
      return;
    }

    if (nextIndex >= card.tracks.length) {
      state.audio.pause();
      state.status = "Reached the end of this card.";
      render();
      return;
    }

    playTrack(nextIndex);
  }

  async function togglePlayback() {
    const currentTrack = getCurrentTrack();

    if (!currentTrack || !state.audio.src) {
      await playTrack(currentTrack ? state.currentTrackIndex : 0);
      return;
    }

    if (state.audio.paused) {
      quietSiteHoverPreview();
      try {
        await state.audio.play();
        state.status = `Playing ${state.currentTrackIndex + 1}/${getSelectedCard()?.tracks.length || 0}`;
      } catch (error) {
        state.status = `Click Play once to allow audio: ${error.message || error}`;
      }
    } else {
      state.audio.pause();
      state.status = "Paused.";
    }

    render();
  }

  function getInlineActionState(source) {
    const isSelected = source?.key === state.selectedCardKey;
    const hasCurrentTrack = isSelected && state.currentTrackIndex >= 0;
    const hasAudio = isSelected && Boolean(state.audio.src);

    if (hasAudio && !state.audio.paused) {
      return {
        active: true,
        label: "Pause Queue",
        mode: "pause"
      };
    }

    if (hasCurrentTrack && hasAudio && state.audio.paused) {
      return {
        active: true,
        label: "Resume Queue",
        mode: "resume"
      };
    }

    return {
      active: false,
      label: "Play Queue",
      mode: "play"
    };
  }

  function ensureNote(track, cardKey) {
    const notes = getNotesForCard(cardKey);
    if (notes.some((note) => note.id === track.id)) {
      state.status = "Already bookmarked.";
      return;
    }

    state.notesByCard[cardKey] = [
      {
        artistName: track.artistName,
        createdAt: new Date().toISOString(),
        id: track.id,
        index: track.index,
        previewUrl: track.previewUrl,
        trackName: track.trackName
      },
      ...notes
    ];
    persistNotes();
    state.status = "Bookmarked current track.";
  }

  function bookmarkCurrentTrack() {
    const card = getSelectedCard();
    const track = getCurrentTrack();

    if (!card || !track) {
      state.status = "Start playback before bookmarking.";
      render();
      return;
    }

    ensureNote(track, card.key);
    render();
  }

  function removeNote(cardKey, noteId) {
    state.notesByCard[cardKey] = getNotesForCard(cardKey).filter((note) => note.id !== noteId);
    persistNotes();
    state.status = "Bookmark removed.";
    render();
  }

  function flashTrack(track) {
    if (!track?.element) {
      return;
    }

    track.element.classList.add("dq-queue-player-jump");
    track.element.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
    window.setTimeout(() => {
      track.element.classList.remove("dq-queue-player-jump");
    }, JUMP_FLASH_MS);
  }

  function jumpToNote(noteId, { autoplay = false } = {}) {
    const card = getSelectedCard();
    if (!card) {
      return;
    }

    const trackIndex = card.tracks.findIndex((track) => track.id === noteId);
    if (trackIndex < 0) {
      state.status = "That bookmarked track is not in the current card anymore.";
      render();
      return;
    }

    state.currentTrackIndex = trackIndex;
    state.currentTrackId = card.tracks[trackIndex].id;
    state.status = autoplay ? "Queued bookmarked track." : "Ready to play bookmarked track.";

    flashTrack(card.tracks[trackIndex]);

    if (autoplay) {
      playTrack(trackIndex);
      return;
    }

    clearAudioSource();
    render();
  }

  function syncCurrentTrackAfterRefresh(previousTrackId) {
    if (!previousTrackId) {
      state.currentTrackId = "";
      state.currentTrackIndex = -1;
      return;
    }

    const card = getSelectedCard();
    const nextIndex = card ? card.tracks.findIndex((track) => track.id === previousTrackId) : -1;

    state.currentTrackIndex = nextIndex;
    state.currentTrackId = nextIndex >= 0 && card ? card.tracks[nextIndex].id : "";
  }

  function refreshCards() {
    const previousTrackId = state.currentTrackId;
    const cards = scanCards();

    state.cards = cards;

    if (!cards.length) {
      stopAndResetAudio();
      state.status = DEFAULT_STATUS;
      render();
      return;
    }

    if (!cards.some((card) => card.key === state.selectedCardKey)) {
      state.selectedCardKey = cards[0].key;
      localStorage.setItem(STORAGE_KEYS.selectedCard, state.selectedCardKey);
    }

    syncCurrentTrackAfterRefresh(previousTrackId);

    if (!state.status || state.status === DEFAULT_STATUS) {
      state.status = `${getSelectedCard()?.tracks.length || 0} previews ready.`;
    }

    render();
  }

  function scheduleRefresh() {
    window.clearTimeout(state.refreshTimer);
    state.refreshTimer = window.setTimeout(refreshCards, 120);
  }

  function isExtensionNode(node) {
    if (!node) {
      return false;
    }

    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    if (!element) {
      return false;
    }

    return Boolean(
      element.id === PANEL_ID ||
        element.id === STYLE_ID ||
        element.matches?.(INLINE_ACTION_SELECTOR) ||
        element.closest?.(`#${PANEL_ID}`) ||
        element.closest?.(`#${STYLE_ID}`) ||
        element.closest?.(INLINE_ACTION_SELECTOR)
    );
  }

  function isExtensionMutation(record) {
    if (!record) {
      return false;
    }

    const changedNodes = [...record.addedNodes, ...record.removedNodes];
    return changedNodes.length > 0 && changedNodes.every((node) => isExtensionNode(node));
  }

  function handleMutations(records) {
    if (!records.some((record) => !isExtensionMutation(record))) {
      return;
    }

    scheduleRefresh();
  }

  function renderNotesHtml(card) {
    if (!card) {
      return '<div class="dq-queue-player__empty">No queue source selected.</div>';
    }

    const notes = getNotesForCard(card.key);
    if (!notes.length) {
      return '<div class="dq-queue-player__empty">Bookmark tracks with <code>B</code> or the button below.</div>';
    }

    return notes
      .map(
        (note) => `
          <div class="dq-queue-player__note">
            <div class="dq-queue-player__note-copy">
              <div class="dq-queue-player__note-title">${escapeHtml(note.trackName)}</div>
              <div class="dq-queue-player__note-artist">${escapeHtml(note.artistName)}</div>
            </div>
            <div class="dq-queue-player__note-actions">
              <button type="button" data-action="jump-note" data-note-id="${escapeHtml(note.id)}">Jump</button>
              <button type="button" data-action="play-note" data-note-id="${escapeHtml(note.id)}">Play</button>
              <button type="button" data-action="remove-note" data-note-id="${escapeHtml(note.id)}">X</button>
            </div>
          </div>
        `
      )
      .join("");
  }

  function renderCardOptions(selectedKey) {
    return state.cards
      .map((card) => {
        const isSelected = card.key === selectedKey ? " selected" : "";
        return `<option value="${escapeHtml(card.key)}"${isSelected}>${escapeHtml(card.title)} (${card.tracks.length})</option>`;
      })
      .join("");
  }

  function renderInlineLaunchers() {
    document.querySelectorAll(INLINE_ACTION_SELECTOR).forEach((button) => button.remove());

    state.cards.forEach((source) => {
      if (!source.launchTarget?.isConnected) {
        return;
      }

      const actionState = getInlineActionState(source);
      const button = document.createElement("button");
      button.type = "button";
      button.className = `dq-queue-player-inline-action${actionState.active ? " is-active" : ""}`;
      button.dataset.dqQueueInlineAction = actionState.mode;
      button.dataset.dqQueueCardKey = source.key;
      button.textContent = actionState.label;
      source.launchTarget.appendChild(button);
    });
  }

  function getPanelFrameMarkup() {
    return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <style>
      html, body {
        margin: 0;
        padding: 0;
        background: transparent;
      }

      body {
        font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: #f5f3ff;
      }

      * {
        box-sizing: border-box;
      }

      button,
      select {
        border: 0;
        border-radius: 10px;
        font: inherit;
      }

      button {
        cursor: pointer;
        color: #f5f3ff;
        background: #3d3a5f;
        transition: background 120ms ease;
      }

      button:hover {
        background: #504c7c;
      }

      code {
        padding: 1px 4px;
        border-radius: 6px;
        background: rgba(255, 255, 255, 0.08);
        color: #ffd5ef;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      }

      .dq-queue-player__shell {
        width: 340px;
        max-height: min(70vh, 720px);
        overflow: hidden;
        border-radius: 16px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(19, 18, 30, 0.94);
        box-shadow: 0 24px 60px rgba(0, 0, 0, 0.34);
        backdrop-filter: blur(18px);
      }

      .dq-queue-player__inner {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 14px;
      }

      .dq-queue-player__header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 8px;
      }

      .dq-queue-player__title {
        font-size: 15px;
        font-weight: 700;
        letter-spacing: 0.01em;
      }

      .dq-queue-player__subtitle {
        color: rgba(245, 243, 255, 0.72);
        font-size: 12px;
        margin-top: 2px;
      }

      .dq-queue-player__refresh {
        padding: 7px 10px;
        background: rgba(255, 255, 255, 0.1);
      }

      .dq-queue-player__label {
        display: block;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: rgba(245, 243, 255, 0.62);
      }

      .dq-queue-player__select {
        width: 100%;
        padding: 10px 12px;
        color: #f5f3ff;
        background: #2b2942;
        appearance: none;
      }

      .dq-queue-player__controls {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 8px;
      }

      .dq-queue-player__controls button {
        padding: 10px 8px;
        font-weight: 600;
      }

      .dq-queue-player__primary {
        background: linear-gradient(135deg, #ff3da6, #ff6db8);
        color: white;
      }

      .dq-queue-player__primary:hover {
        background: linear-gradient(135deg, #ff2799, #ff58af);
      }

      .dq-queue-player__status,
      .dq-queue-player__current {
        padding: 10px 12px;
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.06);
      }

      .dq-queue-player__status {
        color: rgba(245, 243, 255, 0.86);
      }

      .dq-queue-player__track {
        font-weight: 700;
      }

      .dq-queue-player__artist {
        margin-top: 4px;
        color: rgba(245, 243, 255, 0.7);
      }

      .dq-queue-player__notes-title {
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: rgba(245, 243, 255, 0.62);
      }

      .dq-queue-player__notes {
        display: flex;
        flex-direction: column;
        gap: 8px;
        max-height: 220px;
        overflow: auto;
        padding-right: 2px;
      }

      .dq-queue-player__note {
        display: flex;
        gap: 8px;
        align-items: flex-start;
        justify-content: space-between;
        padding: 10px 12px;
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.06);
      }

      .dq-queue-player__note-copy {
        min-width: 0;
        flex: 1;
      }

      .dq-queue-player__note-title {
        font-weight: 600;
      }

      .dq-queue-player__note-artist {
        margin-top: 4px;
        color: rgba(245, 243, 255, 0.7);
      }

      .dq-queue-player__note-actions {
        display: flex;
        gap: 6px;
        flex-shrink: 0;
      }

      .dq-queue-player__note-actions button {
        padding: 7px 8px;
        font-size: 12px;
      }

      .dq-queue-player__empty,
      .dq-queue-player__hint {
        color: rgba(245, 243, 255, 0.7);
      }

      .dq-queue-player__hint {
        font-size: 12px;
      }
    </style>
  </head>
  <body>
    <div class="dq-queue-player__shell">
      <div id="dq-queue-player-frame-root"></div>
    </div>
  </body>
</html>`;
  }

  function ensureUi() {
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = `
        #${PANEL_ID} {
          position: fixed;
          right: 20px;
          bottom: 20px;
          z-index: 2147483647;
          width: 340px;
          height: min(70vh, 720px);
          border: 0;
          background: transparent;
        }

        .dq-queue-player-inline-action {
          margin-left: 10px;
          padding: 4px 9px;
          border: 0;
          border-radius: 999px;
          background: #ff4ea8;
          color: #fff;
          font: 600 11px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          letter-spacing: 0.01em;
          cursor: pointer;
          vertical-align: middle;
        }

        .dq-queue-player-inline-action:hover {
          background: #ff389d;
        }

        .dq-queue-player-inline-action.is-active {
          background: #2c2847;
        }

        .dq-queue-player-inline-action.is-active:hover {
          background: #3b3561;
        }

        .dq-queue-player-current .itemImg {
          box-shadow: 0 0 0 3px #ff53af;
        }

        .dq-queue-player-bookmarked .itemImg {
          box-shadow: 0 0 0 2px rgba(255, 214, 70, 0.95);
        }

        .dq-queue-player-current.dq-queue-player-bookmarked .itemImg {
          box-shadow: 0 0 0 2px rgba(255, 214, 70, 0.95), 0 0 0 5px #ff53af;
        }

        .dq-queue-player-jump .itemImg {
          animation: dq-queue-player-pulse 1.1s ease;
        }

        @keyframes dq-queue-player-pulse {
          0% {
            transform: scale(1);
            box-shadow: 0 0 0 0 rgba(255, 83, 175, 0.85);
          }
          40% {
            transform: scale(1.06);
            box-shadow: 0 0 0 10px rgba(255, 83, 175, 0);
          }
          100% {
            transform: scale(1);
            box-shadow: 0 0 0 0 rgba(255, 83, 175, 0);
          }
        }
      `;
      document.head.appendChild(style);
    }

    if (!state.panel) {
      state.panel = document.createElement("iframe");
      state.panel.id = PANEL_ID;
      state.panel.setAttribute("scrolling", "no");
      state.panel.setAttribute("aria-label", "Discover Quickly Queue Player");
      document.body.appendChild(state.panel);
      state.panelDoc = state.panel.contentDocument;
      state.panelDoc.open();
      state.panelDoc.write(getPanelFrameMarkup());
      state.panelDoc.close();
      state.panelRoot = state.panelDoc.getElementById("dq-queue-player-frame-root");
      state.panelDoc.addEventListener("click", handlePanelClick);
      state.panelDoc.addEventListener("change", handlePanelChange);
    }
  }

  function updateTrackHighlights() {
    state.cards.forEach((card) => {
      const noteIds = new Set(getNotesForCard(card.key).map((note) => note.id));
      card.tracks.forEach((track) => {
        track.element.classList.toggle(
          "dq-queue-player-current",
          card.key === state.selectedCardKey && track.id === state.currentTrackId
        );
        track.element.classList.toggle("dq-queue-player-bookmarked", noteIds.has(track.id));
      });
    });
  }

  function render() {
    ensureUi();

    if (!state.panelRoot) {
      return;
    }

    const selectedCard = getSelectedCard();
    const currentTrack = getCurrentTrack();
    const notesCount = selectedCard ? getNotesForCard(selectedCard.key).length : 0;
    const isPlaying = Boolean(state.audio.src) && !state.audio.paused;
    const playLabel = currentTrack ? (isPlaying ? "Pause" : "Play") : "Start";
    const currentInfo = currentTrack
      ? `
          <div class="dq-queue-player__track">${escapeHtml(currentTrack.trackName)}</div>
          <div class="dq-queue-player__artist">${escapeHtml(currentTrack.artistName)}</div>
        `
      : '<div class="dq-queue-player__empty">No track selected yet.</div>';

    state.panelRoot.innerHTML = `
      <div class="dq-queue-player__inner">
        <div class="dq-queue-player__header">
          <div>
            <div class="dq-queue-player__title">DQ Queue</div>
            <div class="dq-queue-player__subtitle">${escapeHtml(
              selectedCard ? `${selectedCard.tracks.length} previews ready on this source.` : DEFAULT_STATUS
            )}</div>
          </div>
          <button type="button" class="dq-queue-player__refresh" data-action="refresh">Refresh</button>
        </div>

        <label class="dq-queue-player__label" for="dq-queue-player-select">Queue Source</label>
        <select id="dq-queue-player-select" class="dq-queue-player__select" data-role="card-select">
          ${renderCardOptions(selectedCard?.key || "")}
        </select>

        <div class="dq-queue-player__controls">
          <button type="button" class="dq-queue-player__primary" data-action="toggle">${escapeHtml(playLabel)}</button>
          <button type="button" data-action="prev">Prev</button>
          <button type="button" data-action="next">Next</button>
          <button type="button" data-action="bookmark">Bookmark</button>
        </div>

        <div class="dq-queue-player__status">${escapeHtml(state.status)}</div>
        <div class="dq-queue-player__current">${currentInfo}</div>

        <div class="dq-queue-player__notes-title">Bookmarks (${notesCount})</div>
        <div class="dq-queue-player__notes">${renderNotesHtml(selectedCard)}</div>

        <div class="dq-queue-player__hint">Hotkeys: <code>Space</code> play/pause, <code>J</code>/<code>K</code> previous/next, <code>B</code> bookmark current.</div>
      </div>
    `;

    updateTrackHighlights();
    renderInlineLaunchers();
    updateMediaSession();
  }

  async function handleInlineActionClick(event) {
    const button = event.target.closest(INLINE_ACTION_SELECTOR);
    if (!button) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const { dqQueueCardKey: cardKey, dqQueueInlineAction: action } = button.dataset;
    if (!cardKey) {
      return;
    }

    if (action === "pause") {
      state.audio.pause();
      state.status = "Paused.";
      render();
      return;
    }

    if (action === "resume") {
      setSelectedCard(cardKey, { resetPlayback: false });
      await togglePlayback();
      return;
    }

    await playSourceByKey(cardKey, { restart: true });
  }

  function handlePanelClick(event) {
    const button = event.target.closest("button[data-action]");
    if (!button) {
      return;
    }

    const { action, noteId } = button.dataset;

    switch (action) {
      case "bookmark":
        bookmarkCurrentTrack();
        break;
      case "jump-note":
        jumpToNote(noteId, { autoplay: false });
        break;
      case "next":
        playRelative(1);
        break;
      case "play-note":
        jumpToNote(noteId, { autoplay: true });
        break;
      case "prev":
        playRelative(-1);
        break;
      case "refresh":
        refreshCards();
        break;
      case "remove-note":
        if (getSelectedCard()) {
          removeNote(getSelectedCard().key, noteId);
        }
        break;
      case "toggle":
        togglePlayback();
        break;
      default:
        break;
    }
  }

  function handlePanelChange(event) {
    const select = event.target.closest('select[data-role="card-select"]');
    if (!select) {
      return;
    }

    setSelectedCard(select.value, { resetPlayback: true });
  }

  function handleKeydown(event) {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || isTypingTarget(event.target)) {
      return;
    }

    if (event.code === "Space") {
      event.preventDefault();
      togglePlayback();
      return;
    }

    const key = event.key.toLowerCase();
    if (key === "j") {
      event.preventDefault();
      playRelative(-1);
      return;
    }

    if (key === "k") {
      event.preventDefault();
      playRelative(1);
      return;
    }

    if (key === "b") {
      event.preventDefault();
      bookmarkCurrentTrack();
    }
  }

  function attachObserver() {
    if (state.observer) {
      return;
    }

    state.observer = new MutationObserver(handleMutations);
    state.observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  window.addEventListener("keydown", handleKeydown, true);
  document.addEventListener("click", handleInlineActionClick, true);
  document.addEventListener("mouseover", handlePlayableMouseOver, true);
  document.addEventListener("mouseout", handlePlayableMouseOut, true);
  installMediaSessionHandlers();
  attachObserver();
  refreshCards();
})();
