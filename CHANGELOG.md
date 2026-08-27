# Changelog

## 1.5.0 (unreleased)

- Staff selector: the dialog lists every staff by part name; Run and
  Clear process exactly the chosen staff (defaulting to the selection's
  staff). A range selection only narrows the tick window. Previously a
  whole-score run silently processed the top staff only.
- Viola support: the chosen staff's instrument is detected from the part
  (with a pitch-range fallback) and the solver uses viola tuning
  (C3 G3 D4 A4) - same hand model, one fifth lower.
- Registry v2 keys annotations by staff, so two staves sharing tick and
  pitch (quartet unisons) cannot consume each other's entries; v1 tags
  are still recognized and migrate as they are rewritten.

## 1.4.0 (2026-08-26)

Cost-model revision after a violinist's review of the algorithm:

- Stretch and semitone-slide costs no longer fire across a position shift
  (they used to tax every cross-finger shift landing, biasing the solver
  toward same-finger shifts).
- Simultaneous notes must sit on contiguous strings: no more double stops
  with a silent string in the middle. Double stops may span two positions,
  making fingered tenths playable (1 and 4, adjacent strings).
- The low-position preference is now a per-position table: I and III are
  home, V is common, II and IV cost more than their neighbors. An isolated
  high note now lands in III with 3, not II with 4.
- Open-string penalty is per string (E glares most, G least).
- High positions cost slightly more on lower strings (the arm reaches
  around the instrument's shoulder).
- Enharmonic spelling (from tpc) breaks displacement ties: a sharp is a
  raised lower finger, a flat a lowered upper finger.
- Dialog text follows the application theme (was hardcoded black,
  unreadable in dark mode).
- Grace notes join the fingering chain in playing order (before the main
  note; grace-after notes after it) and get finger numbers; an ornament's
  pitch now influences the main note's fingering. Position marks stay on
  the main notes.

## 1.3.0 (2026-08-26)

- A manually noted finger now resets the Viterbi chain: each segment between
  pins is solved independently, so downstream context can no longer drag
  notes away from a pinned position.
- Key signature changes mid-piece are respected: each event is solved
  against the key in effect at its tick, not just the score's opening key.
- Fixed: position marks (and the key signature read) were always taken from
  staff 0; they now follow the staff of the selection.
- Removed dead code left over from removed features (Diagnose trace, unused
  per-voice event collection, unused single-note solver).
- Repo: CI workflow running the Node test suite; changelog; score files
  ignored.

## 1.2.0 (2026-07-06)

- Open strings are penalized instead of rewarded: a fingered note is
  preferred when reachable (vibrato, timbre), the open string still wins
  when it saves a shift or extra crossings.
- Auto-written annotations are colored blue; annotations the user has since
  edited are recolored black and honored as constraints.
- String numbers are written as real String Number elements
  (Tid.STRING_NUMBER, circled digits).
- Clear button removes the plugin's annotations; Diagnose and Copy-log
  buttons removed.
- Node unit tests for the pure-JS fingering core (`npm test`).

## 1.1.0 (2026-07-03)

- Everything the plugin writes is tracked in a score meta tag and replaced
  on re-run; manual annotations are honored as constraints.
- Refined string crossing costs and position handling (#1).

## 1.0.1 (2026-06-13)

- Fixed finger position difference cost (applied as post-transition cost).
- Added before/after example scores to the README.

## 1.0.0 (2026-06-13)

- Initial release: position-aware Viterbi fingering for MuseScore Studio
  4.4+, writing finger numbers and Roman-numeral position marks.
