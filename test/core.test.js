// Unit tests for violin_fingering_core.js — run with: npm test (node --test)
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const core = require('./load_core.js');

// state/combo entry layout: [string, finger, position, accidentalOffset, pitch]
const STR = 0, FING = 1, POS = 2, OFF = 3, PITCH = 4;

function melody(pitches) {
    return pitches.map(function (p) {
        return {pitches: [typeof p === 'number' ? {pitch: p} : p]};
    });
}

test('keyScale: C major', function () {
    assert.deepStrictEqual(core.keyScale(0), [0, 2, 4, 5, 7, 9, 11]);
});

test('keyScale: D major (2 sharps)', function () {
    assert.deepStrictEqual(core.keyScale(2), [1, 2, 4, 6, 7, 9, 11]);
});

test('fingerPitch: first position frames in C major', function () {
    assert.strictEqual(core.fingerPitch(0, 1, 1, 0), 57);  // G string, f1 = A3
    assert.strictEqual(core.fingerPitch(2, 1, 1, 0), 71);  // A string, f1 = B4
    assert.strictEqual(core.fingerPitch(2, 4, 1, 0), 76);  // A string IV, f1 = E5
    assert.strictEqual(core.fingerPitch(3, 3, 1, 0), 81);  // E string III, f1 = A5
});

test('candidatesForPitch: E5 offers open E and fingered alternatives', function () {
    var cands = core.candidatesForPitch(76, 0, 7);
    assert.ok(cands.some(function (c) { return c[STR] === 3 && c[FING] === 0; }),
        'open E string');
    assert.ok(cands.some(function (c) { return c[STR] === 2 && c[FING] === 1 && c[POS] === 4; }),
        'A string, 1st finger, 4th position');
});

test('candidatesForPitch: below violin range is unplayable', function () {
    assert.strictEqual(core.candidatesForPitch(54, 0, 7).length, 0);
});

test('finger constraint filters candidate combos', function () {
    var combos = core.candidatesForEvent([{pitch: 76, finger: 1}], 0, 7);
    assert.ok(combos.length > 0);
    combos.forEach(function (e) { assert.strictEqual(e.combo[0][FING], 1); });
});

test('open string avoided when a fingered note is in frame', function () {
    // C5 B4 C5 E5 sits in first position on the A string; E5 must be the
    // 4th finger there, not the open E (vibrato, timbre).
    var res = core.solveChords(melody([72, 71, 72, 76]), 0, 7);
    var e5 = res[3].combo[0];
    assert.strictEqual(e5[FING], 4, 'E5 played with 4th finger');
    assert.strictEqual(e5[STR], 2, 'E5 on the A string');
});

test('open string still used when fingering it costs extra crossings', function () {
    // B5 E5 B5 on the E string: fingering E5 means two extra string
    // crossings, so the open E is the right call here.
    var res = core.solveChords(melody([83, 76, 83]), 0, 7);
    assert.strictEqual(res[1].combo[0][FING], 0, 'E5 open');
    assert.strictEqual(res[1].combo[0][STR], 3, 'E5 on the E string');
});

// Regression: Bach A minor concerto, movement 1, measure 5 (issue reported
// 2026-07-06). With the opening E5 pinned to the 1st finger (4th position),
// the whole measure is playable in IV without a single shift. The solver
// used to drop to the open E and shift to III, putting A5 on the 1st
// finger of the E string.
test('m5 regression: stays in 4th position, A5 on 4th finger', function () {
    var pitches = [76, 72, 71, 72, 76, 81, 81, 74, 71, 69, 71, 74, 79];
    var events = melody(pitches);
    events[0].pitches[0].finger = 1;   // user pin: E5 = 1 (IV)
    var res = core.solveChords(events, 0, 7);
    res.forEach(function (st, i) {
        assert.strictEqual(st.pos, 4, 'event ' + i + ' in 4th position');
        assert.notStrictEqual(st.combo[0][FING], 0, 'event ' + i + ' not open');
    });
    assert.strictEqual(res[4].combo[0][FING], 1, 'second E5 = 1st finger');
    assert.strictEqual(res[5].combo[0][FING], 4, 'A5 = 4th finger');
    assert.strictEqual(res[5].combo[0][STR], 2, 'A5 on the A string');
});

test('all-open event carries hand position through (no snap to I)', function () {
    // A5(III) - open E - A5(III): the open string must not force a shift.
    var res = core.solveChords(melody([{pitch: 81, finger: 1}, 76, 81]), 0, 7);
    assert.strictEqual(res[0].pos, 3);
    assert.strictEqual(res[1].pos, 3, 'hand stays in III across the open E');
    assert.strictEqual(res[2].pos, 3);
});

test('unplayable input returns null', function () {
    assert.strictEqual(core.solveChords(melody([40]), 0, 7), null);
});
