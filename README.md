# Discover Quickly Queue Player

Small Chrome extension for `https://discoverquickly.com/` that:

- plays every preview in the current queue source one after another
- also works for artist-card sections such as `Top Tracks`, `Albums`, and `Singles & Compilations`
- keeps its own `Audio()` queue instead of depending on hover playback
- lets you bookmark interesting tracks and jump back to them later

## Install

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the cloned `discoverquickly-player` folder on your machine.

## Use

1. Open `https://discoverquickly.com/`.
2. Pick a queue source from the floating **DQ Queue** panel.
3. Click **Start** once to satisfy Chrome autoplay rules.
4. Let it run in the background.
5. When something stands out, press `B` or click **Bookmark**.
6. Use **Jump** or **Play** in the bookmark list to revisit it.

## Hotkeys

- `Space`: play / pause
- `J`: previous track
- `K`: next track
- `B`: bookmark current track

## Notes

- The extension reads preview URLs from the page's existing React props, so it is tied to the current Discover Quickly DOM structure.
- Bookmarks are stored in `localStorage` on `discoverquickly.com`.
