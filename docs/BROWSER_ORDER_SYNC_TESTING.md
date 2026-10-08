# Browser order sync test branch

Branch: `feat/browser-order-sync`. No merge or production deployment is part of this experiment. The implementation is browser-native TypeScript; TrackIndex is a behavior reference only, with no Windows/Python backend copied.

## Windows setup

Install Git and Node.js 24 LTS. In PowerShell, use a separate checkout so your normal Meloark checkout and main branch stay untouched:

```powershell
git clone --branch feat/browser-order-sync --single-branch https://github.com/markdsilva/Meloark.git Meloark-order-sync-test
cd Meloark-order-sync-test
npm ci
npm run dev -- --port 5176 --strictPort
```

Open `http://127.0.0.1:5176` in current desktop Chrome or Edge. Keep this port separate from your usual dev origin: this test adds an IndexedDB v3 recovery store, and an older main-branch build still opens v2. No experimental browser flag is needed or recommended. Native support and write permission are verified on a disposable probe when enabling filename sync; an unsupported browser or filesystem leaves the ordinary playlist workflow available.

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
5. Play, pause and seek, then reorder while the track is loaded. The local order should update immediately, status should say **Waiting for playback to stop**, and files must remain unchanged until **Stop & sync**. Play again afterwards and check seek, next/previous, audio details and lyrics.
6. Pause sync, make several edits, then resume. The latest order should be written once the queue settles. While a batch is in progress, further reorder edits stay responsive and are coalesced into the next batch.
7. Reload after a completed sync; reconnect if asked. Verify order, stable track metadata/lyrics and the same filenames. On a copied folder only, close the tab during a larger batch and reopen. **Recover filename sync** should finish the recorded batch before a new one starts. Do not delete the recovery journal or temporary files manually.
8. Try an occupied target, mismatched filename case, an affected absolute playlist reference, and externally edited authority M3U8. Sync should stop with an explanation and leave the conflicting file intact. Use Disable sync/reload/review for preflight conflicts. If an interruption has already created a recovery journal, preserve the journal and resolve the reported conflict before retrying recovery.
9. Test another subfolder, filters and sorting, touch viewport, context menus, keyboard moves, sidebar, player and lyrics panel. Filtered/sorted views must explain why dragging is disabled. On touch, **Reorder tracks** provides deliberate whole-row dragging; turn it off for scrolling.
10. Test portable file selection in Firefox/Safari or by selecting files instead of a direct folder. Only M3U8-only should be available; Save/Export/playback and existing drafts should continue to work.

## Automated checks

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run check:seo
npx playwright install chromium
npm run test:e2e -- --project=chromium
```

The opt-in native picker test runs on an isolated Linux X11 display in cloud CI, using xdotool to select generated temporary files. It uses real directory/file handles and removes only its disposable fixture. Windows folder permissions and rename support should be checked manually with the steps above.

The test branch's GitHub Actions workflow runs checks and Chromium flows, stores screenshots/traces, and never deploys the app or updates main. Unit fault tests are adapter tests; they do not themselves prove native Windows rename support.

## Limits to keep in mind

- One complete audio folder and one order authority per folder. Membership edits become available after disabling sync; this never deletes audio.
- No native move API, denied access, unsupported filesystems, ambiguous references or unsafe names cause a clear block. There is no copy/delete fallback.
- The recovery protocol is resumable, not an atomic filesystem transaction. App-origin Web Locks cannot lock out Explorer, tag editors, cloud-sync clients or another application.
- File identity checks use exact journal paths and stable IDs plus size, modification time and bounded head/tail fingerprints. They do not deduplicate identical recordings, and they cannot detect a deliberately changed middle section with unchanged metadata. Avoid concurrent external edits.
- Only playlists inside the granted library and matching same-folder `.lrc` sidecars are repaired. External playlists and other sidecar types are outside this branch's scope.
- Browser storage eviction or manually deleting recovery data can remove the remembered session/track identity needed for automated recovery. Keep the copied test folder until acceptance is complete.
