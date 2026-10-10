# UI overhaul

Implemented on `feat/ui-overhaul`, based on `feat/browser-order-sync`.

## Design approach

Use short, concrete instructions, a consistent charcoal and amber palette, and
clear spacing between controls. Remove repeated branding and explanatory text
while keeping permissions, conflicts, file effects, and confirmations visible
where users make those decisions.

- Welcome uses one heading, a concrete introduction, three short tips, and a
  tour invitation aligned with the example playlist’s footer divider.
- Help starts with actual browser support, groups functions by availability,
  separates conditional permission checks, and retains technical details and
  the tour. API presence alone does not claim verified rename or persistence.
- Sidebar empty states are shorter. Privacy remains in the top bar, with an
  amber shield; Help replaces the repeated privacy block in the sidebar.
- Playlist setup uses concise choices and paired fields where space allows.
  Conflicting playlist order still requires an explicit choice, and renaming
  still requires preview review and confirmation.
- Track headings and rows share grid columns and a scroll container. Selection
  highlights the entire row, without a separate checkbox column.

## Controls

Desktop selects support arrows, Home/End, typeahead, Enter, Escape, and normal
Tab navigation. Disabled choices include their reasons. Popups remain inside
their parent dialog, fit the viewport, and dismiss when their anchor scrolls.
Touch devices, narrow screens, and inventories exceeding 200 options use a
styled native select.

Track selection supports click, Ctrl/Cmd-click, Shift-click, Space, Shift-arrows,
Ctrl/Cmd-A, and Escape. Enter and the play button start playback. Alt-arrows
move selected playlist tracks. Touch selection and group reorder retain their
explicit modes. Safety confirmations remain checkboxes.

Track lists and setup previews remain virtualized. Header alignment is checked
from 320 to 1600 pixels, and a 10,000-track check covers the final row, bounded
DOM size, and selection retained after scrolling and search. No dependencies,
file-sync algorithms, audio engine, search worker, or ambient-color processing
were changed.

## Validation

Run the repository’s lint, typecheck, unit/integration tests, build, and SEO
checks. Browser checks cover selection, desktop/mobile selects, dialogs,
geometry, existing playback/search/lyrics, and large-library virtualization.
Production checks also run against built static assets.

The feature-branch workflow now covers `feat/ui-overhaul` as well as the original
feature branch. Its native Linux checks use disposable folders and a real
Chrome folder picker to verify numbered and unnumbered audio, playlist references,
LRC sidecars, byte preservation, interrupted-sync recovery, and number removal.
Windows native-picker acceptance remains a separate manual check.
