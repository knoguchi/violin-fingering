# Changelog

## 1.3.0 (unreleased)

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
