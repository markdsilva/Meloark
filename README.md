# TrackIndex Web

A browser-first local music library and M3U8 playlist manager. Built independently with React, TypeScript, and Vite. No backend, account, or music upload is required.

## Run locally

Use Node.js 24 (24.11 or newer) and npm. Dependencies are pinned in the lockfile.

```sh
npm ci
npm run dev
```

On Windows PowerShell, use `npm.cmd` if execution policy blocks `npm.ps1`. Open the localhost URL printed by Vite. Do not open `index.html` directly from disk.

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm run preview
```

The production output is `dist/`. Serve it from any static HTTPS host. Core library management happens locally; the static host only serves application assets. An offline-installable PWA is not included.

## Using the application

1. Choose a music folder. Its subfolders are scanned recursively. Portable folder and multiple-file selection are available when direct access is unavailable.
2. Open an existing M3U/M3U8 from the sidebar, or create a playlist. A single discovered playlist is opened automatically. Scanning never adds discovered tracks to an existing playlist.
3. In **All tracks**, use Add, Add & Play, or multi-selection to add tracks. Albums and folder/artist filters help browse your collection.
4. In **Playlist**, select with checkboxes, Ctrl/Cmd-click, or Shift-click. Drag a handle to move the selected group. Move up/down buttons and Alt+Arrow keys provide keyboard reordering. Clear filters and select playlist order before reordering.
5. Undo/redo operates on the draft. Removing a track removes only its playlist occurrence. Repeated tracks are preserved as distinct occurrences.
6. **Save playlist** requests write permission, checks for external changes, writes, closes, and verifies the M3U8. **Export** requests a download and does not update the original.

Keyboard shortcuts: Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y redo, Ctrl/Cmd+S save/export, Ctrl/Cmd+A select the visible filtered list, Delete remove selected playlist occurrences, Escape clear selection or cancel dragging, arrows navigate rows, Enter play a row. Shortcuts do not intercept editing in input fields.

The persistent player supports play/pause, previous/next, seeking, volume/mute, shuffle, and repeat off/all/one. Playback follows the active draft. Switching playlists stops playback; reordering preserves the current occurrence. Removing the playing occurrence advances to its surviving successor.

## Browser modes

| Capability | Direct folder access | Portable selection |
| --- | --- | --- |
| Recursive browsing and metadata | Yes | Yes, when directory input is available |
| Native supported audio playback | Yes | Yes |
| Editing, history, playlist creation | Yes | Yes |
| Updating the original M3U8 | With write permission | Download/export instead |
| Reopening music after reload | Remembered handle, subject to renewed permission | Reselect the folder/files |
| Draft recovery | IndexedDB where available | IndexedDB where available |

Feature detection determines what is offered. Chromium-based desktop browsers are recommended for full folder access. Firefox and Safari retain portable workflows. Actual codec support varies by browser and operating system; unsupported tracks remain visible and in the playlist. There is no decoder/transcoder fallback.

The app requires an explicit selection and never discovers your system Music folder automatically. It does not rename, delete, copy, or write audio files. It does not fetch URL entries, external artwork, fonts, or metadata services. Forgetting a library removes browser records only.

## Playlists and ordering

- UTF-8 M3U8, optional BOM, LF/CRLF/CR, duplicate occurrences, comments, and EXTINF are supported.
- Legacy M3U uses UTF-8 first; invalid UTF-8 offers explicit Windows-1252 decoding with a preview. Saving creates a separate UTF-8 M3U8.
- Paths are relative to the playlist directory. Safe parent references inside the chosen library are allowed. Absolute paths, remote URLs, missing tracks, separator ambiguity, and case-only mismatches require explicit local mapping or removal.
- Existing M3U8 preserves BOM and newline style. New documents use UTF-8 without BOM and LF. Downloaded files must be placed at the location shown by TrackIndex, otherwise relative references will not resolve.
- HLS manifests are rejected. Unknown extended directives require a reviewed normalized copy; the original is preserved. Inspection limits are 16 MiB and 100,000 lines.
- Numbered filenames such as `001 - Song.mp3` provide a reviewed starting order. Indexes are folder-local. Duplicate indexes, partial indexing, invalid indexes, gaps, and multiple folders are displayed for review. Creating a draft from filename order requires an explicit review acknowledgement. Files are never renumbered.

Once established, playlist order is authoritative. Filename indexing never becomes an ongoing synchronization mode.

## Persistence and failure handling

IndexedDB stores registrations, supported folder handles, inventories, metadata/thumbnails, source baselines, drafts, and small pending-save records. Music bytes and portable File objects are never persisted. History is session-scoped and resets on reload; drafts survive where browser storage is available. Volume is a lightweight local preference.

Saving is explicit. The saved baseline advances only after read-back verification. Permission, stale-source, write, close, and verification failures preserve the draft. An uncertain save freezes further edits to that draft until **Reconcile** checks the actual file. Verified filesystem success remains success if a subsequent browser-cache update fails; that cache failure is shown separately.

There is no cross-resource transaction or automatic rollback. Creating a target may leave an empty playlist on failure. A failed or canceled download cannot be verified, so the UI reports **Download requested**, not saved. External applications can change a file during the narrow validation/write interval; browser APIs do not provide atomic compare-and-swap. Same-library application tabs use Web Locks when available.

Use Refresh to discover external changes; automatic filesystem watching is not included. Permission revocation, private browsing, quota limits, cleared site data, and storage eviction may require reconnecting or rebuilding caches. Save/export files are the durable playlist copy.

## Implementation map

- `src/domain`: models, group editing, history, filename-index analysis.
- `src/playlists`: pure M3U decoding, path resolution, and serialization.
- `src/platform`: capability reporting, portable/direct adapters, verified writes, IndexedDB.
- `src/app`: normalized Zustand state and orchestration.
- `src/playback`: one native audio element and independently tested queue logic.
- `src/metadata`: progressively scheduled Blob parsing in a module worker, thumbnailing and bounded caching. Parsing falls back to sequential work if workers fail.
- `src/ui` and `src/styles`: reusable controls, virtualized track lists, onboarding and token-based styling.

`archive/` is reference material only. It is ignored and excluded from web compilation, lint, tests, builds, and dependency resolution. No runtime imports or copied desktop components depend on it. The original license and ownership configuration remain in place.

## Automated verification

```sh
npx playwright install chromium firefox webkit
npm run test:e2e
```

Vitest covers playlist/path safety, numbered imports, group editing/history, queue traversal, adapter boundaries, metadata fixtures, IndexedDB recovery, and save failure/commit behavior. Playwright covers portable workflows across Chromium, Firefox and WebKit, draft recovery, export contents, group drag/cancel, selection/search on 10,000 tracks, and playback on supported test platforms.

Direct save tests inject a directory-handle adapter backed by isolated temporary files. They verify saved bytes, conflict rejection, uncertain-save reconciliation, and unchanged audio bytes. These tests exercise the application protocol; they do not automate native OS pickers or real browser permission persistence. Temporary fixtures use generated PCM audio, never user music.

Playwright WebKit on Windows lacks native audio decoding; its playback test is skipped there. WebKit browser tests are Safari-engine checks, not a substitute for testing real Safari on macOS.

## Manual release checks

- Windows, macOS, Linux Chromium: choose a real temporary library, reopen a remembered handle, deny/renew permission, save new/existing playlists, revoke access, and check actual disk bytes.
- macOS Safari and desktop Firefox: select a nested folder, reload/reselect it, export a playlist, and place it back at its stated relative location.
- Verify real MP3, FLAC, Ogg/Opus, M4A/AAC, and WAV support on each target OS. Confirm decode failures are skipped without loops.
- Exercise embedded and folder artwork, large tags, worker failure, inaccessible files, private browsing, cleared storage, and quota failures.
- Check keyboard-only navigation, screen-reader announcements, reduced motion, 900/1280/1920px desktop layouts, and dragging near scroll boundaries.

CI runs lint, unit/integration tests, a production build, and browser tests. Native picker/permission and real macOS/Linux checks remain manual before release.
