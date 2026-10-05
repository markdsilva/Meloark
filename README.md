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
2. Press a track's **Play** button to listen immediately, even without a playlist. Open an existing M3U/M3U8 from the sidebar, or create a playlist when you want to save an order. A single visible discovered playlist is opened automatically. Scanning never adds discovered tracks to an existing playlist.
3. In **All tracks**, use Add, Add & Play, or multi-selection to add tracks. Albums and folder/artist filters help browse your collection.
4. In **Playlist**, select with checkboxes, Ctrl/Cmd-click, or Shift-click. Drag a handle to move the selected group. Move up/down buttons and Alt+Arrow keys provide keyboard reordering. Clear filters and select playlist order before reordering.
5. Undo/redo operates on the draft. Removing a track removes only its playlist occurrence. Repeated tracks are preserved as distinct occurrences.
6. **Save playlist** requests write permission, checks for external changes, writes, closes, and verifies the M3U8. **Export** requests a download and does not update the original.

Keyboard shortcuts: Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y redo, Ctrl/Cmd+S save/export, Ctrl/Cmd+A select the visible filtered list, Delete remove selected playlist occurrences, Escape clear selection or cancel dragging, arrows navigate rows, Enter play a row. Shortcuts do not intercept editing in input fields.

The persistent player supports play/pause, previous/next, seeking, volume/mute, shuffle, and repeat off/all/one. Library Play captures the visible filtered/sorted list without changing membership; later filters do not alter that queue. Playlist playback follows the active draft, preserves the playing occurrence on reorder, and advances to its surviving successor on removal. Selecting or creating a playlist leaves a library queue playing. Switching active playlists stops a playlist queue; switching libraries stops either queue. Add & Play switches to the playlist only after the add succeeds.

New visitors can start or skip a short guided tour. Restart it from the Help/browser-capabilities panel. Icon controls have hover/focus hints. Right-click a track or sidebar row for contextual actions, use Shift+F10/context-menu key from the keyboard, or use the ellipsis button on touch devices. Right-click within an existing selection preserves the selected group.

Playlist menus offer **Remove from app** or **Discard draft**, with confirmation before losing unsaved edits/history. On-disk playlists removed from the app stay hidden across Refresh/reload; **Manage playlists** restores them. In direct mode, **Delete playlist file** requires explicit confirmation and write permission. It targets only the named M3U/M3U8, checks its expected bytes, deletes non-recursively, and verifies absence. Deletion is permanent and outside edit undo. Portable mode uses your file manager for physical deletion. Legacy M3U sources and imported M3U8 drafts are separate targets. Audio files are never deleted.

Collapse the desktop sidebar into an icon rail; its preference survives reopening. Below 768 px, navigation opens in a modal drawer. On phones, expand the compact player for the complete transport, volume, and audio details. Player sheets do not replace the native audio element or restart playback. Use **Select tracks** for touch selection, then drag a handle after holding it briefly, or use Move up/down. Track actions offer explicit Add and Add & Play.

## Audio details and live source bitrate

Click the Audio column or the player's audio summary for container, codec/profile, reported bitrate, sample rate, source bit depth where known, channels, compression, file size, and library-relative location. Older metadata caches upgrade progressively; artwork and playlist drafts are preserved. Reported codec profiles are hints, including MP3 CBR profiles inferred by tag parsers.

Live analysis uses local encoded-packet sizes and timing in a separate, lazy worker while the current track is playing and the readout is visible. It uses a roughly one-second window, updates at most four times per second, retains compact packet information, and limits its source-read cache to 8 MiB. Pausing, hiding the page, changing tracks, or seeking stops or resets pending work. A five-second watchdog disables failed analysis without interrupting playback. Some distant seeks require container indexing and may show an unavailable reason.

MP3, FLAC, AAC/ADTS, M4A/M4B and supported Ogg audio use packet analysis; validated WAV/AIFF PCM uses constant source bitrate. Explicit MP3 Info tags can establish nominal CBR; matching initial frames cannot. Encrypted, malformed, unsupported variants retain static details. Verified audio average appears only after continuous packet coverage reaches the end, or immediately for validated PCM. Values exclude container/tag overhead and never represent output-device quality or network bitrate.

Ogg FLAC mapping 1.x uses a small local reader because the pinned demuxer supports Ogg Vorbis/Opus but lacks Ogg FLAC. It validates page checksums, packet continuation, FLAC header timing, sequence and granule positions, keeps one 256 KiB read cache, one source page and a bounded timing window, and uses at most 128 sparse seek checkpoints. Chained/multiplexed Ogg FLAC falls back to static details with a visible reason. The reader follows [Xiph's mapping](https://xiph.org/flac/ogg_mapping.html) and [RFC 9639 frame headers](https://www.rfc-editor.org/rfc/rfc9639.html#name-frame-header).

The capabilities panel distinguishes API support, actual storage/handle outcomes, observed folder-access failures, and current-library permissions. Permission queries do not prompt; grants remain explicit actions. Where the audio element does not accept volume changes, use device volume controls.

## Synchronized lyrics

Use **Lyrics** in the player to open a right-side panel on desktop or a full-screen sheet on phones. Synchronized lines follow the native playback clock; click a line to seek. Scrolling pauses following so you can read ahead; **Follow lyrics** resumes it. Reduced motion uses immediate scrolling. Opening lyrics never replaces the audio element or changes your playlist.

TrackIndex looks for a UTF-8 `.lrc` beside the audio file first (`Song.lrc` or `Song.mp3.lrc`). Multiple candidates or tracks sharing a filename stem require your choice. You can also import an LRC through the panel's options. Plain lyrics are readable without invented timing, and instrumental recordings are labelled.

Online lyrics are optional. **Allow online lyrics** permits requests to [LRCLIB](https://lrclib.net/); **Use local lyrics only** keeps lookup offline. Change this choice in Lyrics options. Only the current track is queried while the panel is open and the page is visible. Automatic lookup requires a confirmed title tag rather than a filename fallback. Matching checks title, artist, album when present, and duration within two seconds. **Find another version** lets you review alternatives rather than silently choosing a different recording.

LRCLIB receives title, artist, album and duration for automatic lookup, or the title/artist you enter for search. No music, artwork, library paths or filenames are sent. Like any external service, it receives the network request and its originating IP address. Disabling lookup cancels requests; locally cached lyrics remain usable.

Lyrics, your selected version, and per-track timing corrections are stored separately in IndexedDB and invalidated when the audio file fingerprint changes. Existing library records, drafts and artwork survive the database upgrade. Failed storage leaves lyrics available for the session with a clear warning. Forgetting a library removes its cached lyrics. **Adjust timing** moves lines earlier/later by 100 ms, with Reset. **Download LRC** includes your correction and reports a download request; place it beside the matching audio file yourself. Lyrics never write into your selected folder automatically.

LRC inspection is bounded to 512 KiB and 10,000 lines. Multiple timestamps, fractional seconds, blank timed breaks, Unicode and embedded offsets are supported. Enhanced word tags are displayed as ordinary line text without word-level highlighting. Online failures, missing tags, missing matches and rate limits leave playback operational. Requests have a ten-second timeout and cancel on track changes, hiding or closing the panel.

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

The app requires an explicit selection and never discovers your system Music folder automatically. It does not rename, delete, copy, or write audio files. It does not fetch URL entries, external artwork or fonts. LRCLIB requests occur only after you enable online lyrics. Forgetting a library removes browser records only.

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

There is no cross-resource transaction or automatic rollback. Creating a target may leave an empty playlist on failure. A failed or canceled download cannot be verified, so the UI reports **Download requested**, not saved. External applications can change a file during the narrow validation/write or validation/delete interval; browser APIs do not provide atomic compare-and-swap. Same-library application tabs use Web Locks for saving and deletion when available. Unverified deletion preserves browser state until the confirmation dialog's **Reconcile deletion** checks the file; verified deletion remains committed if browser-cache storage subsequently fails. Targets exceeding the 16 MiB inspection limit must be deleted through the file manager.

Use Refresh to discover external changes; automatic filesystem watching is not included. Permission revocation, private browsing, quota limits, cleared site data, and storage eviction may require reconnecting or rebuilding caches. Save/export files are the durable playlist copy.

## Implementation map

- `src/domain`: models, group editing, history, filename-index analysis.
- `src/playlists`: pure M3U decoding, path resolution, and serialization.
- `src/platform`: capability reporting, portable/direct adapters, verified writes, IndexedDB.
- `src/app`: normalized Zustand state and orchestration.
- `src/playback`: one native audio element and independently tested queue logic.
- `src/lyrics`: bounded LRC parsing/timing, opt-in LRCLIB matching, cancellation and independent lyrics caching.
- `src/metadata`: progressively scheduled Blob parsing in a module worker, thumbnailing and bounded caching. Parsing falls back to sequential work if workers fail.
- `src/ui` and `src/styles`: reusable controls, virtualized track lists, onboarding and token-based styling.

`archive/` is reference material only. It is ignored and excluded from web compilation, lint, tests, builds, and dependency resolution. No runtime imports or copied desktop components depend on it. The original license and ownership configuration remain in place.

## Automated verification

```sh
npx playwright install chromium firefox webkit
npm run test:e2e
```

Vitest covers playlist/path safety, numbered imports, group editing/history, queue traversal, adapter boundaries, metadata fixtures, IndexedDB recovery, and save failure/commit behavior. Playwright covers portable workflows across Chromium, Firefox and WebKit, draft recovery, export contents, group drag/cancel, selection/search on 10,000 tracks, and playback on supported test platforms.

Lyrics tests cover local-file priority, offsets and corrections, matching and manual review, opt-in/network privacy, cancellation, rate limits, storage failures and schema upgrades. Browser tests use original test text and mocked LRCLIB responses, and cover native seeking, manual Follow, LRC download, imports, remembered versions, keyboard access and responsive layouts. Windows WebKit presentation fixtures do not claim native playback coverage.

Direct save/deletion tests inject a directory-handle adapter backed by isolated temporary files. They verify saved bytes, confirmed playlist-only deletion, conflict rejection, uncertain-operation reconciliation, and unchanged audio bytes. These tests exercise the application protocol; they do not automate native OS pickers or real browser permission persistence. Temporary fixtures use generated PCM audio, never user music.

Playwright WebKit on Windows lacks native audio decoding; its playback test is skipped there. WebKit browser tests are Safari-engine checks, not a substitute for testing real Safari on macOS.

An optional read-only local-library acceptance test scans metadata, plays available FLAC/MP3/M4A samples, checks live analysis and imported LRC seeking, creates/exports a reviewed draft, restores it through actual folder reselection, and verifies unchanged filenames, sizes and modification times. No application or CI configuration depends on a personal folder:

```powershell
$env:TRACKINDEX_LOCAL_LIBRARY = 'C:\path\to\test-library'
npm.cmd run test:e2e -- --project=chromium tests/e2e/local-library.spec.ts
```

Browser tests start an isolated server on port 5174, overrideable with `TRACKINDEX_TEST_PORT`. Run them outside restrictive command sandboxes when Firefox fails before page creation; no Firefox security preferences need changing. Generated PCM and structural encoded-packet fixtures cover CI. Structural packet fixtures test demuxing and timing, not codec decoding. Live worker tests cover cancellation, stale responses, hidden/paused behavior, and watchdog failure. Browser checks cover 320/390/768/1024/1440 px, landscape, a 200%-zoom-equivalent viewport, and Chromium touch events.

## Manual release checks

- Windows, macOS, Linux Chromium: choose a real temporary library, reopen a remembered handle, deny/renew permission, save new/existing playlists, revoke access, and check actual disk bytes.
- macOS Safari and desktop Firefox: select a nested folder, reload/reselect it, export a playlist, and place it back at its stated relative location.
- Verify real MP3, FLAC, Ogg/Opus, M4A/AAC, and WAV support on each target OS. Confirm decode failures are skipped without loops.
- Exercise embedded and folder artwork, large tags, worker failure, inaccessible files, private browsing, cleared storage, and quota failures.
- Check keyboard-only navigation, screen-reader announcements, reduced motion, 200% browser zoom, and dragging near scroll boundaries.
- Use actual Android Chrome and iPhone Safari to verify picker behavior, native playback, system-controlled volume, software-keyboard dialogs, safe areas, and touch dragging. Desktop emulation does not establish these device capabilities.

CI runs lint, unit/integration tests, a production build, and browser tests. Native picker/permission and real macOS/Linux checks remain manual before release.

The first-use workflow review and proposed simplification backlog are in [docs/uat-findings.md](docs/uat-findings.md). These recommendations are separate from the lyrics implementation.

## Dependency notice

The interface bundles unmodified [Inter Variable 4.1](https://github.com/rsms/inter/releases/tag/v4.1) locally under the [SIL Open Font License 1.1](public/fonts/OFL.txt). Font loading uses a system-font fallback and never contacts a font CDN. The SVG favicon and generated desktop/mobile icons derive from the existing amber TrackIndex music/list mark; the icon manifest does not add an installation flow or service worker.

Local packet inspection uses [Mediabunny](https://mediabunny.dev/api/PacketRetrievalOptions), distributed under [MPL-2.0](https://github.com/Vanilagy/mediabunny/blob/main/LICENSE). Its unmodified source is available in the pinned npm package and [upstream repository](https://github.com/Vanilagy/mediabunny). Only local-file input demuxers are enabled; TrackIndex uses no remote source, media decoder, or encoder for analysis.
