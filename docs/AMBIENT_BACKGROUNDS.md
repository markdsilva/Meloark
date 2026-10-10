# Artwork backgrounds

The playing track supplies a soft palette for the workspace, lyrics and player.
The sidebar and amber control/focus colors stay consistent. The palette button in
the library/playlist toolbar defaults to on and saves its preference locally.
Pausing keeps the current colors. Stopping, missing or unreadable artwork, and
switching the feature off restore the static amber/charcoal palette.

## Rendering and extraction

- A lazy worker samples the existing local artwork Blob at 32 × 32 pixels. No
  requests are made to an artwork service, and no additional music reads occur.
- Weighted color buckets ignore transparent pixels, white borders and deep
  shadows. A secondary color must occupy a meaningful region, rather than a speck.
- Softened colors are capped at relative luminance 0.018 (primary) and 0.012
  (secondary). Small text retains at least 4.5:1 contrast against the palette
  extremes; the charcoal base and dark glass further temper the backgrounds.
- A WeakMap caches palettes by artwork Blob. At most one decode and one newest
  waiting image are retained. Decode failure/timeout falls back safely; a worker
  retires after 60 seconds idle and each decoded bitmap is closed.
- Two gradient layers crossfade with opacity over 1.8 seconds. Interrupted fades
  resume from a mix using the same easing curve; layers do not accumulate. Player
  progress does not trigger extraction or ambient rendering. Reduced motion
  removes the fade, and forced colors hides the decorative layers. Newly opened
  surfaces join the shared transition timeline instead of replaying old colors.
- The workspace background occupies its own grid layer and stays stationary while
  content scrolls. The mobile lyrics/player dialogs share the same palette. Blur
  stays on a decorative pseudo-element, preserving fixed menu coordinates.

## Validation

Unit checks cover hue selection, monochrome/transparent artwork, tiny specks,
contrast limits, interrupted fades, preferences, cache reuse, rapid skip
coalescing, failures and idle cleanup. Browser checks use generated WAVs and real
local PNG cover files, exercising the metadata and artwork workers in development
and production. They cover playback/seeking, pause, rapid skips, fallback, toggle
persistence, mobile layouts, lyrics menus, search overlays and reduced motion.

A local Node benchmark of 1,000 varied 32 × 32 samples measured approximately
0.3 ms per palette extraction during parallel browser checks, excluding image decoding. This is a local
measurement, not a guarantee for other devices; extraction remains off the UI
thread and the browser loads the worker only when artwork is needed.
