# Discover Quickly Queue Player

Small Chrome extension for `https://discoverquickly.com/` that:

- plays every preview in the current queue source one after another
- also works for artist-card sections such as `Top Tracks`, `Albums`, `Singles & Compilations`, and `Related Artists`
- keeps its own `Audio()` queue instead of depending on hover playback
- lets you bookmark interesting tracks and jump back to them later

## Install

The extension is not published in the Chrome Web Store yet, so install it from source:

1. Download this repository:
   - Clone it with `git clone https://github.com/georgeolaru/discoverquickly-player.git`, or
   - Click **Code > Download ZIP** on GitHub and unzip it locally.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode** in the top-right corner.
4. Click **Load unpacked**.
5. Select the project folder that contains `manifest.json`.

If you update the extension later, pull the latest changes or re-download the ZIP, then click the refresh icon for the extension in `chrome://extensions`.

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
