# UI overhaul

Implemented on `feat/ui-overhaul`, based on `feat/browser-order-sync`.

## Design approach

Use short, concrete instructions, a consistent charcoal and amber palette, and
clear spacing between controls. Remove repeated branding and explanatory text
while keeping permissions, conflicts, file effects, and confirmations visible
where users make those decisions.

- Welcome uses one heading, a concrete introduction, three short tips, and a
  Quick start invitation aligned with the example playlist’s footer divider.
- Help starts with actual browser support, groups functions by availability,
  separates conditional permission checks, and retains technical details and
  the Quick start document. API presence alone does not claim verified rename or persistence.
- Sidebar empty states are shorter. Privacy remains in the top bar, with an
  amber shield; Help replaces the repeated privacy block in the sidebar.
- Playlist setup uses concise choices and paired fields where space allows.
  Conflicting playlist order still requires an explicit choice, and renaming
  still requires preview review and confirmation.
- Track headings and rows share grid columns and a scroll container. Selection
  highlights the entire row, without a separate checkbox column.
- The collection header places the title, metadata, and playback/save controls
  beside artwork on desktop, with wrapped controls across the width on mobile.
  The filtered track count sits beside the view tabs. Desktop selection actions
  replace the column heading without moving rows during a drag. The sticky
  heading uses a lightly darkened, blurred ambient tint, with solid backgrounds for reduced
  transparency and system colors for high contrast.

## Controls

Desktop selects support arrows, Home/End, typeahead, Enter, Escape, and normal
Tab navigation. Disabled choices include their reasons. Popups remain inside
their parent dialog, fit the viewport, and dismiss when their anchor scrolls.
Touch devices, narrow screens, and inventories exceeding 200 options use a
styled native select.

Track selection supports click, Ctrl/Cmd-click, Shift-click, Ctrl/Cmd+Space, Shift-arrows,
Ctrl/Cmd-A, and Escape. Enter and the play button start playback. Alt-arrows
move selected playlist tracks. Touch selection and group reorder retain their
explicit modes. Safety confirmations remain checkboxes. Space plays/pauses from
rows and ordinary app controls without selecting a row or activating the focused
button; editing, menus and dialogs retain native keyboard behavior. Held-key
repeats are suppressed. An explicitly deselected row clears its hover wash
until the pointer leaves, while keyboard focus remains visible.

The player’s upper-edge arrow switches between its default 112-pixel layout
and a 72-pixel compact layout, with a persisted, storage-failure-safe preference.
Grid rows animate together with workspace height; reduced motion is immediate.
Playback, selection and queues stay mounted. Compact mode retains artwork and
transport; seeking and audio details remain in player sheets. Desktop, narrow
desktop and mobile checks verify the reclaimed 40 pixels, reload and controls.

Track lists and setup previews remain virtualized. Header alignment is checked
from 320 to 1600 pixels, and a 10,000-track check covers the final row, bounded
DOM size, and selection retained after scrolling and search. No dependencies,
file-sync algorithms, search worker, or ambient-color processing were changed.

Quick start replaces moving tour popups with a scrollable five-step document,
browser recommendations and expandable tips. Its close control stays visible.
Context menus, selects, search and tooltips use common popup surface tokens.
Menus support arrows, Home/End, Escape and normal Tab navigation; outside clicks
keep focus on the control being used. A queued focus-scroll event no longer
dismisses a newly opened context menu; scrolling that actually moves its
anchor still dismisses it.

Folder-access recovery is driven by file I/O permission failures and read-only
queries when returning to the app or activating a library. Missing files and
autoplay restrictions are handled separately. No continuous polling is added.
Recovery waits for existing dialogs to close, retains drafts, and only requests
permissions after an explicit click. Write recovery does not retry file edits.
Browser storage warnings retain a separate retry/export action. Reselecting the
active library retains the open view; metadata/artwork resume after a rescan.

## Validation

Run the repository’s lint, typecheck, unit/integration tests, build, and SEO
checks. Browser checks cover selection, desktop/mobile selects, dialogs,
geometry, existing playback/search/lyrics, and large-library virtualization.
Production checks also run against built static assets.

The feature-branch workflow now covers `feat/ui-overhaul` as well as the original
feature branch. Its native Linux checks use disposable folders and a real
Chrome folder picker to verify numbered and unnumbered audio, playlist references,
LRC sidecars, byte preservation, interrupted-sync recovery, and number removal.
GitHub runs emit test failure annotations as well as logs and retained traces.
Windows native-picker acceptance remains a separate manual check.
