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
// Pinning E5 to 1 (IV) anticipates A5 on the 4th finger: the hand must
// stay in IV, with no shift, until the next manual pin resets the chain.
function m5m7(notes) {
    return notes.map(function (ns) {
        return {pitches: ns.map(function (n) {
            return Array.isArray(n) ? {pitch: n[0], finger: n[1]} : {pitch: n};
        })};
    });
}
var M5_M7 = [
    [[76, 1]], [72], [71], [72], [76], [81], [81], [74], [71], [69],
    [71], [[74, 1]], [79],
    [79], [78], [76], [78], [81], [84], [84], [83], [81], [79], [78],
    [76], [74], [78], [81], [84], [83], [81],
    [[83, 2]], [86], [84], [83], [[81, 1]], [[79, 4]], [77], [76], [77],
    [77], [[67, 1]], [[69, 2]], [71], [72], [74], [76], [79], [84], [76]
];

test('m5 regression: stays in 4th position until the next pin', function () {
    var res = core.solveChords(m5m7(M5_M7), 0, 7);
    // events 0-10: E5 C5 B4 C5 E5 A5 A5 D5 B4 A4 B4 - everything from the
    // E5 pin up to the D5 pin holds 4th position, nothing open
    for (var i = 0; i <= 10; i++) {
        assert.strictEqual(res[i].pos, 4, 'event ' + i + ' in 4th position');
        assert.notStrictEqual(res[i].combo[0][FING], 0, 'event ' + i + ' not open');
    }
    assert.strictEqual(res[4].combo[0][FING], 1, 'second E5 = 1st finger');
    assert.strictEqual(res[5].combo[0][FING], 4, 'A5 = 4th finger');
    assert.strictEqual(res[5].combo[0][STR], 2, 'A5 on the A string');
    assert.strictEqual(res[6].combo[0][FING], 4, 'second A5 = 4th finger');
    // the D5 = 1 pin declares III; the chain resets and follows it
    assert.strictEqual(res[11].pos, 3, 'pinned D5 = 1 means 3rd position');
});

test('manual pin resets the chain: whole measure holds the pinned position', function () {
    // Same passage without the D5 pin: the E5 = 1 anchor rules until the
    // next pin (start of m7), so all of m5 and m6 stay in IV - no shift.
    var noD5 = JSON.parse(JSON.stringify(M5_M7));
    noD5[11] = [74];
    var res = core.solveChords(m5m7(noD5), 0, 7);
    for (var i = 0; i <= 30; i++) {
        assert.strictEqual(res[i].pos, 4, 'event ' + i + ' in 4th position');
        assert.notStrictEqual(res[i].combo[0][FING], 0, 'event ' + i + ' not open');
    }
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

test('per-event key override: F#5 is in frame after a key change to D major', function () {
    // Piece-level key is C major, but the event carries key=2 (a mid-piece
    // signature change to D major): F#5 must be a plain in-frame finger,
    // not a displaced (accidental) one.
    var res = core.solveChords([{pitches: [{pitch: 78}], key: 2}], 0, 7);
    assert.strictEqual(res[0].combo[0][OFF], 0, 'F#5 in frame under D major');
    // Same note without the override, under C major: F# is not a scale
    // tone, so it can only be played as a displaced finger.
    var res2 = core.solveChords(melody([78]), 0, 7);
    assert.notStrictEqual(res2[0].combo[0][OFF], 0, 'F#5 displaced under C major');
});
