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
    // Bach A minor concerto m5 phrase, unpinned: C5 B4 C5 E5 A5 A5. The upcoming string
    // crossing to A5 used to lure the solver onto the open E (the open
    // "bridges" the crossing for free); with open strings penalized, E5
    // must be the 4th finger on the A string (vibrato, timbre) and the
    // crossing happens at A5 instead. Fails on cores before the W_OPEN
    // penalty (they give E5 = 0 on the E string).
    var res = core.solveChords(melody([72, 71, 72, 76, 81, 81]), 0, 7);
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

// Regression: Bach A minor concerto, measures 5-7 of the user's score
// with his fingering pins, exactly as the plugin saw them (issue reported
// 2026-07-06). Measure 5 alone solves fine on every historical core; the
// bug needs the neighboring measures' pins (m7's A5 = 1 prefers III) to
// manifest. The old cost model then dropped out of IV right after the
// pinned E5, putting m5's A5 on the 1st finger of the E string in III.
// With the opening E5 pinned to 1 (IV), the whole A5 phrase must stay in
// IV with A5 on the 4th finger.
var M5_M7 = [
    [[76, 1]], [72], [71], [72], [76], [81], [81], [74], [71], [69],
    [71], [[74, 1]], [79],
    [79], [78], [76], [78], [81], [84], [84], [83], [81], [79], [78],
    [76], [74], [78], [81], [84], [83], [81],
    [[83, 2]], [86], [84], [83], [[81, 1]], [[79, 4]], [77], [76], [77],
    [77], [[67, 1]], [[69, 2]], [71], [72], [74], [76], [79], [84], [76]
];

test('m5 regression: A5 phrase stays in 4th position, A5 on 4th finger', function () {
    var events = M5_M7.map(function (notes) {
        return {pitches: notes.map(function (n) {
            return Array.isArray(n) ? {pitch: n[0], finger: n[1]} : {pitch: n};
        })};
    });
    var res = core.solveChords(events, 0, 7);
    // events 0-8: E5 C5 B4 C5 E5 A5 A5 D5 B4 - the phrase under the pin
    for (var i = 0; i < 9; i++) {
        assert.strictEqual(res[i].pos, 4, 'event ' + i + ' in 4th position');
        assert.notStrictEqual(res[i].combo[0][FING], 0, 'event ' + i + ' not open');
    }
    assert.strictEqual(res[4].combo[0][FING], 1, 'second E5 = 1st finger');
    assert.strictEqual(res[5].combo[0][FING], 4, 'A5 = 4th finger');
    assert.strictEqual(res[5].combo[0][STR], 2, 'A5 on the A string');
    assert.strictEqual(res[6].combo[0][FING], 4, 'second A5 = 4th finger');
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
