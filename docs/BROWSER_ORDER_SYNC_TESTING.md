# Browser order sync test branch

Branch: `feat/browser-order-sync`. No merge or production deployment is part of this experiment. The implementation is browser-native TypeScript; TrackIndex is a behavior reference only, with no Windows/Python backend copied.

## Test the Cloudflare branch preview

No local checkout is needed. Open the HTTPS preview for **feat/browser-order-sync** in current desktop Chrome or Edge on Windows, then follow the sample-folder checks below. Use the direct **Choose a music folder** button for rename tests. Selecting individual files uses portable mode and cannot rename the originals.

Use the preview's own hostname, separate from the main production site. Folder permissions, drafts and remembered track identities belong to the exact browser origin. If the browser session is lost or a preview URL changes, the on-disk journal can still finish its recorded batch; reconnect the folder, choose Recover filename sync, then review its setup again. Keep the journal and temporary files intact. This branch adds an IndexedDB v3 recovery store, while the older main build uses v2. The test preview must not share the main site's origin.

The branch includes `"previews": {}` in `wrangler.jsonc` for the already-configured `npx wrangler preview` command. Assets and SPA routing stay at the top level. GitHub Actions performs checks only; Cloudflare's existing branch integration handles preview publication. No Cloudflare account settings or main branch deployment are changed by this work.

Native support and write permission are verified on a disposable probe before music is renamed. Unsupported browsers/filesystems keep M3U8-only available. No experimental browser flag is needed or recommended.

## Folder setup and recovery updates

Choosing a new folder now opens **Set up [folder name]** after scanning, showing the track, numbered-filename and playlist counts. The amber/charcoal setup cards offer M3U8 only, numbered filenames only, or both. **Browse first** keeps listening and browsing available without creating anything.

The setup and New playlist lists are read-only previews. Their instructions explicitly say to drag in the **Playlist** tab afterward. **All tracks** now shows **Organize this folder** when there is no active playlist, opening the populated setup flow rather than requiring users to discover New playlist. With a populated playlist it shows **Arrange playlist**, taking users to the draggable list. An empty playlist instead explains how to add songs with **+**. Listening remains available before setup.

For the drag-and-sync workflow, choose **Numbered filenames + M3U8**, review the filenames, confirm automatic renaming and choose **Set up playlist**. Every track in the selected audio folder is included. Existing three-digit numbering keeps its padding. The default M3U8-only setup includes the selected folder's tracks in filename order and saves the playlist without renaming audio; ordinary M3U8 edits continue to use Save playlist.

Filename-sync playback uses an independent in-memory copy of the currently playing track up to 128 MiB. Dragging, filename changes, playlist updates, seeking and playback can then happen together. Larger recordings, or a disk-backed recording loaded before sync was enabled, wait for **Stop & sync** rather than allocating unbounded memory.

The recovery banner now includes the underlying error. Native moves are checked against full-content SHA-256 hashes in bounded chunks, allowing a filesystem timestamp change without mistaking it for changed music. Older journals remain readable and use their recorded size/content samples for recovery; they cannot supply a full-file hash retroactively. A lost browser session can recover the exact recorded disk batch without inventing its old playlist authority or track identities. Once recovery completes, the folder is scanned and setup is offered again.

## Optional Windows local setup

Install Git and Node.js 24 LTS. In PowerShell, use a separate checkout so your normal Meloark checkout and main branch stay untouched:

```powershell
git clone --branch feat/browser-order-sync --single-branch https://github.com/markdsilva/Meloark.git Meloark-order-sync-test
cd Meloark-order-sync-test
npm ci
npm run dev -- --port 5176 --strictPort
```

Open `http://127.0.0.1:5176` in current desktop Chrome or Edge. Keep this port separate from your usual dev origin for the storage-version reason above.

After future branch updates:

```powershell
git pull --ff-only
npm ci
```

## Sample folder and main checks

Use a **copy** of a small music folder for the first test. Include three or more different audio files, a matching LRC sidecar, and an additional M3U8 with comments and a repeated occurrence. Also try a legacy M3U using CRLF/Windows-1252. Keep the originals outside the selected test folder.

1. Choose the folder using direct folder access. Create an **M3U8-only** draft. Add/remove tracks, drag from title/album/blank row areas, multi-select and drag, cancel with Escape, use Alt+Arrow, Undo/Redo, Save and Export. Audio filenames must stay unchanged. Single-click selects and double-click plays; row buttons remain clickable and never start a drag.
2. Create **Numbered filenames only**. Select one complete folder, inspect the preview and enable sync. Allow write access. Wait for **Synced**. Audio filenames should be numbered, the sidecar should follow, and no new M3U8 should appear. Drag a row and verify filenames follow the order. Repeat with a selected group and Undo/Redo.
3. Disable sync in Sync settings. Create **Numbered filenames + M3U8** with a fresh name. Drag rows; verify both filenames and the dedicated M3U8 follow the new order. The additional playlists must retain their own order, repeated occurrences, comments, line endings and encoding while their references change.
4. For initial **existing playlist order**, first open a fully resolved M3U8 containing every audio file in one folder exactly once. Select it in New playlist's Initial order field and verify that its order, rather than filename order, determines the first renumbering. Subsets, duplicates or multiple folders must be rejected before music is changed.
5. Play, pause and seek, then reorder while the track is loaded. For recordings up to 128 MiB loaded after enabling sync, the filenames and M3U8 should update while playback remains seekable. Larger recordings should show **Waiting for playback to stop**, keeping files unchanged until **Stop & sync**. Check seek, next/previous, audio details and lyrics afterwards.
6. Pause sync, make several edits, then resume. The latest order should be written once the queue settles. While a batch is in progress, further reorder edits stay responsive and are coalesced into the next batch.
7. Reload after a completed sync; reconnect if asked. Verify order, stable track metadata/lyrics and the same filenames. On a copied folder only, close the tab during a larger batch and reopen. **Recover filename sync** should finish the recorded batch before a new one starts. Also test recovery after losing the remembered browser session: the recorded disk batch should complete, then folder setup should be offered again. Do not delete the recovery journal or temporary files manually.
8. Try an occupied target, mismatched filename case, an affected absolute playlist reference, and externally edited authority M3U8. Sync should stop with an explanation and leave the conflicting file intact. Use Disable sync/reload/review for preflight conflicts. If an interruption has already created a recovery journal, preserve the journal and resolve the reported conflict before retrying recovery.
9. Test another subfolder, filters and sorting, touch viewport, context menus, keyboard moves, sidebar, player and lyrics panel. Filtered/sorted views must explain why dragging is disabled. On touch, **Reorder tracks** provides deliberate whole-row dragging; turn it off for scrolling.
10. Test portable file selection in Firefox/Safari or by selecting files instead of a direct folder. Only M3U8-only should be available; Save/Export/playback and existing drafts should continue to work.

## Removing filename numbers

Open **Sync settings → Remove filename numbers…**, or the library's **… → Remove filename numbers…** menu for a folder that already has numbered files. Select an audio folder, review the audio and matching LRC changes, confirm and choose **Remove numbers**. One numeric prefix and its separators are removed; a numeric title without a separator, such as `1984.flac`, stays unchanged. The preview is authoritative and requires confirmation again if it changes. For disk-backed playback, the dialog offers **Stop playback** before allowing removal; memory-backed playback can continue.

After success, filename sync for that folder is disabled. A dedicated M3U8 saves the current order, including queued reorders. Existing dependent playlists keep their order, duplicates, comments and encoding while their references change. A filename-only playlist becomes an unsaved M3U8 draft; Save or Export it afterward to preserve that order outside Meloark. Other folders' sync settings remain intact. Subsequent playlist edits use the ordinary draft/save workflow and do not reapply numbering.

Validate removal on copies: check audio byte hashes, sidecar names, dependent playlist references, stable metadata, playback/seek, reload and Undo/Redo. Test duplicate restored names, case/Unicode collisions, existing targets, denied write permission and externally changed files: these must block before music moves. On a disposable folder, interrupt removal and recover after reload. Recovery must complete the same removal and turn off numbering; retain the journal and temporary files until then. Also test already numbered folders without an active sync playlist through the library menu.

## Automated checks

The previous branch acceptance [run 37750763051](https://github.com/markdsilva/Meloark/actions/runs/37750763051) covered the original implementation. Local validation for these changes covers unit/integration tests, Chromium browser flows and real native folder tests using generated unnumbered WAV and numbered FLAC recordings. Native checks verify unchanged audio bytes, playlist-only setup, drag sync, dependent M3U8 references, LRC renaming, Undo, playback/seek, reload, number removal with and without a sync owner, and recovery after a real move was interrupted, including loss of the remembered sync session. The production bundle is checked separately, including native renaming and resuming playback after number removal. Protocol fault tests interrupt removal before and after all nine mutations, and app tests verify cleanup recovery, queued order preservation, ordinary drafts, and independent folders.

The uploaded music ZIP exceeded the attachment tool's 32 MiB transfer limit and could not be read; these results use generated audio, not that collection. Windows filesystem acceptance still requires the manual branch-preview checks above.

Final local results: 232 unit/integration tests passed; 44 standard Chromium flows passed; two native WAV/FLAC flows passed in development and again against the production bundle; the production portable smoke test passed. Type checks, lint, build and SEO checks passed. The personal-library flow was not run because the uploaded ZIP could not be transferred; production and native checks run separately from the standard browser suite.

The follow-up CI fix waits for the lyric marker's opacity transition to finish before sampling its style. Native completion assertions allow up to 30 seconds for Chrome's writable-stream close and readback, with a three-minute cap per native flow; there are no blanket retries or removed assertions. The generated recordings last at least a minute, so playback cannot naturally end during a slow write, and the checks explicitly verify that Alpha stays loaded across its rename. On failure, each native test attaches its own display capture and a JSON summary of alerts, pending `.crswap` files, and journal phase/playlist paths. Application code and main are unchanged by this fix.

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run check:seo
npx playwright install chromium
npm run test:e2e -- --project=chromium
```

The opt-in native picker test runs on an isolated Linux X11 display in cloud CI, using xdotool to select generated temporary files and ffmpeg to encode its FLAC fixture. It uses real directory/file handles and removes only its disposable fixture. Windows folder permissions and rename support should be checked manually with the steps above.

The test branch's GitHub Actions workflow runs checks and Chromium flows, stores screenshots/traces, and never deploys the app or updates main. Unit fault tests are adapter tests; they do not themselves prove native Windows rename support.

## Limits to keep in mind

- One complete audio folder and one order authority per folder. Membership edits become available after disabling sync; this never deletes audio.
- No native move API, denied access, unsupported filesystems, ambiguous references or unsafe names cause a clear block. There is no copy/delete fallback.
- The recovery protocol is resumable, not an atomic filesystem transaction. App-origin Web Locks cannot lock out Explorer, tag editors, cloud-sync clients or another application.
- Use one Meloark tab for the test folder. Web Locks serialize batches across tabs, but separate tabs do not share live playlist edits or selection state.
- New batches verify full-file content hashes using bounded memory, while preflight still checks inventory size and modification time. Recovery of older journals has only their original head/tail samples. Identical recordings remain separate tracks. Avoid concurrent external edits.
- Only playlists inside the granted library and matching same-folder `.lrc` sidecars are repaired. External playlists and other sidecar types are outside this branch's scope.
- Browser storage eviction can lose remembered identities and permission bindings. The on-disk journal can finish its recorded batch after reconnecting, but cannot restore unrecorded drafts or invent the original app identities. Deleting the on-disk journal or temporary files can prevent recovery. Keep the copied test folder until acceptance is complete.
