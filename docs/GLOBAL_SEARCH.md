# Global music search

Search in the top bar, or use Ctrl/Cmd+K. It searches remembered libraries by song title, artist, album, filename/path, playlist name and library name. Matching ignores case and accents and supports terms spread across fields. Exact titles rank ahead of prefix and substring matches.

Typing never filters the current track list or changes its selection, folder/artist filters, active library, playlist draft or order. Clicking a song starts an independent search queue in its source library. Editing or closing search leaves that queue playing. Normal library/playlist Play controls still switch to their usual queues. Search playback respects reconnection, unsupported-codec and filename-recovery restrictions.

Albums, artists, libraries and playlists open inside search. Existing drafts take precedence over disk when previewing a playlist. An unopened playlist is read without creating a session or writing anything; its references resolve against that library, including relative paths and differently named M3U8 files. Unavailable references are counted. Unfiltered playlist previews retain the playlist's order, with one result per recording; search playback does not edit the original playlist or its duplicate occurrences. Legacy encoding or unsafe-manifest errors appear in the dropdown.

## Rendering and performance

- The field reserves its trailing space, including the clear button, so typing does not change its width. The desktop field is centered in the main column. Narrow columns and mobile use a search icon and an overlay.
- The search component owns its query. Keystrokes do not rerender the app's track list. Queries coalesce for 70 ms; outdated responses and cancelled previews cannot overwrite newer searches.
- A worker starts on first use. Only lightweight text metadata crosses the worker boundary; audio and artwork blobs are excluded. Changed library snapshots are built in batches of 750 tracks, yielding between batches, and the worker reuses normalized documents for unchanged songs.
- Matching and unopened-playlist parsing run in the worker. Playlist bytes are transferred without another copy. General search renders at most 12 songs and 6 collections; scoped searches render at most 24 songs. Total counts help users refine broader searches.
- Artwork is requested only for displayed results through the existing metadata scheduler. Thumbnail URLs are released by the existing Artwork component. Worker snapshots use weak references to avoid retaining outdated library artwork, and an idle worker is released after two minutes.
- Worker errors, parsing errors and request timeouts produce recoverable messages. Search does not send collection data to a service.

A synthetic benchmark in the Node 24 cloud workspace used 100 artist names, 1,000 album names and 25 alternating broad/title queries:

| Songs | Initial worker-index computation | Median matching | 95th percentile matching |
| --- | --- | --- | --- |
| 10,000 | 51 ms | 2.7 ms | 5.9 ms |
| 100,000 | 592 ms | 13.5 ms | 29.3 ms |

These measure index/matching computation on this machine, excluding browser startup, the debounce, snapshot transfer and rendering. They are not device latency guarantees. Browser tests separately check bounded results and preservation of the active 10,000-song view and selection.

## Validation

Unit/integration tests cover ranking, accents and Unicode, scopes, changed metadata/paths, bounded results, worker protocol and failure recovery, read-only playlist inspection, and cross-library playback reconciliation. Browser tests use generated PCM with real RIFF title/artist/album tags and local artwork. They cover stable field geometry, rich results, another library's playback, unopened playlist exploration, keyboard controls, disconnected libraries, reduced motion and 320–1,920 px layouts. The same search flows run against the production bundle in feature-branch CI. Existing native WAV/FLAC sync tests continue to verify renaming, sidecars, reference updates, playback, recovery and reload.

Real Android/iOS software keyboards and native Windows folder permissions remain device acceptance checks; desktop browser emulation does not establish those capabilities.
