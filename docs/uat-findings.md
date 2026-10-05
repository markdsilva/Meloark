# First-use UAT and simplification backlog

This is a first-time-user workflow review for the next UI planning pass. It covers starting with no library, selecting local music, listening without a playlist, creating empty and filename-ordered drafts, adding/reordering/removing tracks, history, export/recovery, contextual actions, and desktop/mobile navigation. Automated browser coverage supplements the review; it does not replace a study with new users or actual phone testing.

## Immediate issue addressed in this release

Creating a second default-named playlist could leave its validation message outside the modal, with no useful recovery inside the dialog. Validation now appears beside the name, focuses the field, and offers an available name for duplicates. The dialog stays open until creation succeeds. This is covered in all three browser engines.

## Findings to retain for the next plan

| Priority | Friction in the current flow | Proposed simplification to evaluate |
| --- | --- | --- |
| High | Folder selection, portable selection, browser limitations and remembering libraries introduce several concepts before the user reaches music. | Lead with one primary Select music action and brief mode-specific guidance; show technical compatibility on demand. |
| High | All tracks and Playlist appear both in workspace navigation and central tabs. The repeated destinations make it harder to tell whether browsing or editing is active. | Choose a clear primary navigation model and keep the active queue/view visible. |
| High | New playlist is exposed in several places, while an empty draft needs a separate trip back to All tracks to add music. | Make creation lead directly to a focused add-tracks step, with a clear return to the playlist. |
| High | Play, Add and Add & Play have different membership effects, but much of the explanation lives in tooltips/context menus. | Keep ordinary Play independent; expose membership with clear labels and a useful disabled-action explanation. |
| High | Filename-order review uses individual up/down controls and an acknowledgement even for large multi-folder lists. Reviewing ties and unindexed tracks can be tedious. | Review folder groups and actual ambiguities first; offer bulk placement without silently deciding uncertain order. |
| High | Portable recovery requires understanding cached drafts, disconnected music and folder reselection. Export also requires placing a download at the correct relative location. | Present recovery as a short guided reconnect step and keep export destination instructions near the action. Preserve truthful download status. |
| Medium | Remove from app, Discard draft and Delete playlist file are distinct actions with different consequences. Their contextual placement can obscure the distinction. | Use one management entry point with plain explanations, while retaining explicit confirmation and verified physical deletion. |
| Medium | Refresh, Remember libraries, filters, sorting and secondary row actions rely heavily on compact icons. A first-time user must hover or explore menus. | Use selective text labels for important workflow actions and progressive disclosure for technical options. |
| Medium | Save/Export, draft status and longer notices occupy separate parts of the workspace. It takes extra scanning to connect an action with its outcome. | Group the primary persistence action and its current status; retain detailed error/reconciliation actions nearby. |
| Medium | Mobile navigation, expanded player, audio details, contextual actions and lyrics use separate drawers/sheets. Multiple layers can interrupt orientation. | Establish consistent sheet behavior, titles and return paths; avoid opening unnecessary nested surfaces. |

These are usability recommendations, not requests to remove safety checks or change queue/playlist invariants. The wider redesign is deliberately deferred to the next approved plan.

## Lyrics acceptance workflow

Play music, open Lyrics, and check local LRC loading before online permission is offered. Confirm that online lookup needs explicit opt-in and that a chosen version survives reopening. Read ahead with manual scrolling, resume Follow, click a line to seek, adjust timing, and download an LRC. Repeat on narrow and landscape layouts with keyboard and reduced motion. Verify plain/instrumental/missing/error states without interrupting playback.

Generated fixtures and original test text cover repeatable browser tests. The supplied music library is used read-only; filesystem save/deletion uses disposable fixtures. Actual Android/iPhone playback, native pickers, volume behavior, screen-reader usability and physical device safe areas remain manual release checks.

## Verification completed

| Check | Result |
| --- | --- |
| Unit/integration suite | 144 passed |
| Lint, typechecking and production build | Passed |
| Chromium, Firefox and WebKit browser suite | 79 passed; 20 explicitly skipped for unsupported platform features or optional local-library testing |
| Read-only supplied-library acceptance | Passed: all 43 audio tracks loaded metadata; FLAC/MP3/M4A samples played and sought; local LRC import/line seeking, reviewed draft export and folder-reselection recovery succeeded |
| Supplied-library safety | No external requests; filenames, file sizes and modification times remained unchanged |

The browser tests also caught and resolved an options-menu dismissal during smooth lyrics scrolling, a mobile audio-details regression, and fixture initialization races. Firefox completes its workflows in the current test environment; the earlier page-creation blocker did not recur in this run. Windows WebKit lacks native audio decoding, so its lyrics presentation/recovery tests use a paused queue fixture and its native-playback tests remain explicitly skipped.
