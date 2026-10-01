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

test('shift cost does not include stretch or slide taxes', function () {
    // B4 (A string, f1, I) -> A5 (A string, IV): the pure shift is
    // W_POS_FIXED + 3 * W_POS_SHIFT = 11.5 whatever finger the hand lands
    // on. The stretch/slide terms describe reaches within a frame; once
    // the hand shifts they must not fire (they used to tax every
    // cross-finger shift landing, biasing toward same-finger shifts).
    var st = function (s, k, p, off, pitch) {
        return {combo: [[s, k, p, off, pitch]], pos: p, openOnly: false};
    };
    var from = st(2, 1, 1, 0, 71);
    assert.strictEqual(core.chordTransCost(from, st(2, 4, 4, 0, 81)), 11.5,
        'landing on f4');
    assert.strictEqual(core.chordTransCost(from, st(2, 2, 4, 0, 77)), 11.5,
        'landing on f2');
    assert.strictEqual(core.chordTransCost(from, st(2, 1, 4, 1, 77)), 11.5,
        'landing on a displaced f1');
});

test('double stops sit on adjacent strings; tenths are playable', function () {
    // G4+B5, a major tenth: must come out on adjacent strings (D+A) with
    // fingers 1 and 4 spanning two positions - never on D+E with the
    // silent A string in the middle, which cannot be bowed.
    var res = core.solveChords([{pitches: [{pitch: 83}, {pitch: 67}]}], 0, 7);
    var s1 = res[0].combo[0][STR], s2 = res[0].combo[1][STR];
    assert.strictEqual(Math.abs(s1 - s2), 1, 'adjacent strings');
    var fingers = [res[0].combo[0][FING], res[0].combo[1][FING]].sort();
    assert.deepStrictEqual(fingers, [1, 4], 'fingered 1 and 4');
});

test('open G + A4: the A must be fingered on the D string', function () {
    // Bowing the G and A strings together while skipping the D is
    // impossible, so the open-A candidate is excluded and A4 lands as a
    // fingered note on the D string next door.
    var res = core.solveChords([{pitches: [{pitch: 69}, {pitch: 55}]}], 0, 7);
    var strings = res[0].combo.map(function (c) { return c[STR]; }).sort();
    assert.deepStrictEqual(strings, [0, 1], 'G and D strings');
});

test('an isolated high note prefers III over II', function () {
    // F5 pinned to the A string is reachable as f4 in II or f3 in III;
    // III is the working position a violinist writes. The old linear
    // low-position preference made II strictly cheaper than III.
    var res = core.solveChords([{pitches: [{pitch: 77, string: 2}]}], 0, 7);
    assert.strictEqual(res[0].pos, 3, 'third position');
    assert.strictEqual(res[0].combo[0][FING], 3, 'third finger');
});

test('spelling picks the displaced finger: sharp raised, flat lowered', function () {
    // The same key on the fingerboard: F#5 on the A string in III is a
    // raised 3rd finger, Gb5 a lowered 4th. MIDI alone cannot tell them
    // apart; the spell hint (from tpc) must break the tie.
    var sharp = core.solveChords([{pitches: [{pitch: 78, string: 2, spell: 1}]}], 0, 7);
    assert.strictEqual(sharp[0].combo[0][OFF], 1, 'F# = raised finger');
    var flat = core.solveChords([{pitches: [{pitch: 78, string: 2, spell: -1}]}], 0, 7);
    assert.strictEqual(flat[0].combo[0][OFF], -1, 'Gb = lowered finger');
});

test('viola tuning: the C string exists, violin range check unchanged', function () {
    // C3 is the viola's open C - unplayable on a violin.
    assert.strictEqual(core.solveChords(melody([48]), 0, 7), null,
        'C3 unplayable on violin');
    var res = core.solveChords(melody([48]), 0, 7, "viola");
    assert.strictEqual(res[0].combo[0][STR], 0, 'lowest string');
    assert.strictEqual(res[0].combo[0][FING], 0, 'open C');
    // E3 = 2nd finger on the C string in first position (C major frame
    // above C3: D E F G).
    var e3 = core.solveChords(melody([52]), 0, 7, "viola");
    assert.strictEqual(e3[0].combo[0][STR], 0);
    assert.strictEqual(e3[0].combo[0][FING], 2);
    assert.strictEqual(e3[0].pos, 1);
});

test('viola tuning: barre fifths detected against viola strings', function () {
    // D4+A4 on viola = same fret on the G and D strings (a fifth): the
    // physical barre test must use the viola tuning, not the violin's.
    var st = function (s, k, p, off, pitch) {
        return {combo: [[s, k, p, off, pitch]], pos: p, openOnly: false};
    };
    // E3 (C string, fret 4) -> B3 (G string, fret 4): one-finger barre.
    var c = core.chordTransCost(st(0, 2, 1, 0, 52), st(1, 2, 1, 0, 59),
                                "viola");
    assert.ok(c < 1.0, 'barre discount applies (got ' + c + ')');
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

// --- L/H placement indicators (issue #4) ---
// hlLabel(string, finger, position, pitch, key[, tuning])
const G = 0, D = 1, A = 2, E = 3;

function labels(stringIdx, position, key, pairs, tuning) {
    return pairs.map(function (pf) {
        return core.hlLabel(stringIdx, pf[1], position, pf[0], key, tuning);
    });
}

test('hlLabel: first position follows the nut, not the key', function () {
    // C major, A string: B C D E -> C is low 2
    assert.deepStrictEqual(labels(A, 1, 0, [[71, 1], [72, 2], [74, 3], [76, 4]]),
        ['1', '2L', '3', '4']);
    // C major, E string: F G A B -> low 1, low 2 without any accidental
    assert.deepStrictEqual(labels(E, 1, 0, [[77, 1], [79, 2], [81, 3], [83, 4]]),
        ['1L', '2L', '3', '4']);
    // D major, A string: B C# D E -> the unlabeled shape
    assert.deepStrictEqual(labels(A, 1, 2, [[71, 1], [73, 2], [74, 3], [76, 4]]),
        ['1', '2', '3', '4']);
    // F major, A string: Bb is low 1 even though it is the key's own note
    assert.deepStrictEqual(labels(A, 1, -1, [[70, 1], [72, 2], [74, 3], [76, 4]]),
        ['1L', '2L', '3', '4']);
});

test('hlLabel: enharmonic pair splits into high 3 / low 4', function () {
    // A string, first position: D#5 and Eb5 are the same pitch (75)
    assert.strictEqual(core.hlLabel(A, 3, 1, 75, 3), '3H');
    assert.strictEqual(core.hlLabel(A, 4, 1, 75, -3), '4L');
});

test('hlLabel: open strings are 0', function () {
    assert.strictEqual(core.hlLabel(A, 0, 1, 69, 0), '0');
});

test('hlLabel: higher positions follow the hand frame', function () {
    // D major, A string III: D E F# G -> 3 touches 4
    assert.deepStrictEqual(labels(A, 3, 2, [[74, 1], [76, 2], [78, 3], [79, 4]]),
        ['1', '2', '3H', '4']);
    // F major, A string II: C D E F
    assert.deepStrictEqual(labels(A, 2, -1, [[72, 1], [74, 2], [76, 3], [77, 4]]),
        ['1', '2', '3H', '4']);
});

test('hlLabel: same pitch, different position, different label', function () {
    // C5 on the A string in C major
    assert.strictEqual(core.hlLabel(A, 2, 1, 72, 0), '2L');   // I
    assert.strictEqual(core.hlLabel(A, 1, 2, 72, 0), '1');    // II (1 = C)
});

test('hlLabel: viola uses the same shapes a fifth lower', function () {
    // C major, viola D string (index 2 = D4): E F G A -> F is low 2
    assert.deepStrictEqual(
        labels(2, 1, 0, [[64, 1], [65, 2], [67, 3], [69, 4]], "viola"),
        ['1', '2L', '3', '4']);
});

test('hlLabel: every solved note gets a well-formed label', function () {
    var res = core.solveChords(melody([67, 69, 71, 72, 74, 76, 78, 79, 81, 83]), 0, 7);
    res.forEach(function (e) {
        var c = e.combo[0];
        var lab = core.hlLabel(c[STR], c[FING], c[POS], c[PITCH], 0);
        assert.match(lab, /^[0-4]([LH]+)?$/);
        assert.strictEqual(parseInt(lab), c[FING]);
    });
});

// --- cello ---

test('cello: tuning, detection', function () {
    assert.deepStrictEqual(core.INSTRUMENTS.cello.strings.tuning, [36, 43, 50, 57]);
    assert.strictEqual(core.detectInstrument('strings.cello'), 'cello');
    assert.strictEqual(core.detectInstrument('strings.viola'), 'viola');
    assert.strictEqual(core.detectInstrument('strings.violin'), 'violin');
    assert.strictEqual(core.detectInstrument('wind.flute'), '');
});

test('cello: chromatic frame ignores the key signature', function () {
    for (const key of [0, 3, -4]) {
        assert.strictEqual(core.fingerPitch(3, 1, 1, key, 'cello'), 59);  // A string, f1 = B3
        assert.strictEqual(core.fingerPitch(3, 1, 4, key, 'cello'), 62);  // f4 = D4
    }
});

test('cello: open strings, half position, range floor', function () {
    const c = core.candidatesForPitch(36, 0, undefined, 'cello');
    assert.ok(c.some(function (x) { return x[STR] === 0 && x[FING] === 0; }));
    // C#2 only exists as half position finger 1 on the C string
    const cs = core.candidatesForPitch(37, 0, undefined, 'cello');
    assert.ok(cs.length > 0 && cs.every(function (x) { return x[STR] === 0 && x[POS] === 0; }));
    assert.strictEqual(core.candidatesForPitch(35, 0, undefined, 'cello').length, 0);
});

test('cello: no accidental displacement, every candidate is in frame', function () {
    core.candidatesForPitch(62, 2, undefined, 'cello').forEach(function (c) {
        assert.strictEqual(c[OFF], 0);
    });
});

test('cello: first-position chromatic run stays in one position', function () {
    // D3(open) E3 F3 F#3 G3 on the D string: open, then f1..f? within one frame
    const r = core.solveChords(melody([52, 53, 54, 55]), 0, undefined, 'cello');
    assert.ok(r);
    const pos = r.map(function (e) { return e.pos; });
    assert.ok(pos.every(function (p) { return p === pos[0]; }), 'one position: ' + pos);
});

test('cello: high melody prefers fingers 1-2 over 3-4 when it can shift', function () {
    const r = core.solveChords(melody([69, 70, 69, 70, 69, 70, 69, 70]), 0, undefined, 'cello');
    r.forEach(function (e) { assert.ok(e.combo[0][FING] <= 2, 'finger ' + e.combo[0][FING]); });
});

test('cello: double stops land on contiguous strings', function () {
    // C2 + A3: the wide interval cannot sit on strings 0 and 3
    const r = core.solveChords([{pitches: [{pitch: 36}, {pitch: 57}]}], 0, undefined, 'cello');
    assert.ok(r);
    const ss = r[0].combo.map(function (c) { return c[STR]; }).sort();
    assert.strictEqual(ss[1] - ss[0], 1);
});

test('cello: L/H labels disabled by config', function () {
    assert.strictEqual(core.INSTRUMENTS.cello.hand.hlEnabled, false);
});

// --- INSTRUMENTS consistency ---

test('INSTRUMENTS: per-string and per-finger arrays match the config', function () {
    Object.keys(core.INSTRUMENTS).forEach(function (name) {
        const inst = core.INSTRUMENTS[name];
        const n = inst.strings.tuning.length;
        assert.strictEqual(inst.strings.names.length, n, name + ' strings.names');
        assert.strictEqual(inst.strings.labels.length, n, name + ' strings.labels');
        assert.strictEqual(inst.cost.open.length, n, name + ' cost.open');
        const nFing = inst.hand.thumb ? 5 : 4;   // 4 fingers, plus the thumb
        assert.strictEqual(inst.hand.frameOffsets.length, 4, name + ' hand.frameOffsets');
        assert.strictEqual(inst.cost.fingerCost.length, nFing, name + ' cost.fingerCost');
        assert.strictEqual(inst.cost.fingerHighPos.length, nFing, name + ' cost.fingerHighPos');
        assert.ok(inst.hand.minPosition <= inst.hand.maxPosition, name + ' position range');
    });
});

test('INSTRUMENTS: only cello and 5-string violin are experimental', function () {
    const exp = Object.keys(core.INSTRUMENTS).filter(function (n) {
        return core.INSTRUMENTS[n].experimental;
    });
    assert.deepStrictEqual(exp, ['cello', 'violin5']);
});

// --- 5-string violin ---

test('violin5: never auto-detected; violin and viola ids unchanged', function () {
    assert.strictEqual(core.detectInstrument('strings.violin'), 'violin');
    assert.strictEqual(core.detectInstrument('strings.viola'), 'viola');
});

test('violin5: open E is a candidate and costs are finite', function () {
    const open = core.candidatesForPitch(76, 0, 7, 'violin5')
        .filter(function (c) { return c[0] === 4 && c[1] === 0; });
    assert.strictEqual(open.length, 1);
    // string 1 = highest: pins the open E (index 4), which needs a finite open cost
    const res = core.solveChords(melody([{pitch: 76, string: 1}]), 0, 7, 'violin5');
    assert.ok(res);
    assert.strictEqual(res[0].combo[0][STR], 4);
    assert.strictEqual(res[0].combo[0][FING], 0);
});

// --- thumb (cello) and annotation vocabulary ---

test('thumb: only the cello has one; finger 5 is the thumb', function () {
    assert.ok(core.INSTRUMENTS.cello.hand.thumb);
    assert.ok(!core.INSTRUMENTS.violin.hand.thumb);
    assert.ok(!core.INSTRUMENTS.viola.hand.thumb);
    assert.strictEqual(core.fingerFromText('T'), -1);                 // a letter is not a thumb
    assert.strictEqual(core.fingerFromText('3'), 3);
    assert.strictEqual(core.fingerFromText('<b>3</b>'), 3);
    assert.strictEqual(core.fingerFromText('II'), -1);
});

test('thumb: pitch sits thumb.offset below finger 1 of the same position', function () {
    const th = core.INSTRUMENTS.cello.hand.thumb;
    for (const pos of [th.minPosition, th.minPosition + 3])
        assert.strictEqual(core.fingerPitch(3, pos, core.THUMB, 0, 'cello'),
                           core.fingerPitch(3, pos, 1, 0, 'cello') + th.offset);
});

test('thumb: candidates only from minPosition, never on violin/viola', function () {
    const th = core.INSTRUMENTS.cello.hand.thumb;
    const cands = core.candidatesForPitch(70, 0, 20, 'cello')
        .filter(function (c) { return c[1] === core.THUMB; });
    assert.ok(cands.length > 0);
    cands.forEach(function (c) { assert.ok(c[2] >= th.minPosition); });
    ['violin', 'viola'].forEach(function (n) {
        core.candidatesForPitch(79, 0, 7, n).forEach(function (c) {
            assert.ok(c[1] <= 4, n);
        });
    });
});

test('thumb: a pinned thumb is honored', function () {
    const th = core.INSTRUMENTS.cello.hand.thumb;
    const res = core.solveChords(melody([{pitch: 70, finger: core.THUMB}]), 0, 20, 'cello');
    assert.ok(res);
    assert.strictEqual(res[0].combo[0][FING], core.THUMB);
    assert.ok(res[0].combo[0][POS] >= th.minPosition);
    const c = res[0].combo[0];
    assert.strictEqual(core.hlLabel(c[STR], c[FING], c[POS], c[4], 0, 'cello'),
                       core.THUMB_KEY);
});

test('thumb: same-pitch thumb on adjacent strings is a barre (cheap), not a crossing', function () {
    // thumb at one spot across A and D (a perfect fifth): pitches 70 (A) and 63 (D)
    const t = core.THUMB;
    const posA = 14, posD = 14;
    const a = {combo: [[3, t, posA, 0, core.fingerPitch(3, posA, t, 0, 'cello')]], pos: posA, openOnly: false};
    const b = {combo: [[2, t, posD, 0, core.fingerPitch(2, posD, t, 0, 'cello')]], pos: posD, openOnly: false};
    const cost = core.chordTransCost(a, b, 'cello');
    const inst = core.INSTRUMENTS.cello.cost;
    assert.ok(cost < inst.sameFingerCross, 'barre cost ' + cost);
});

test('annotation vocabulary: string labels, position marks, string counts', function () {
    assert.strictEqual(core.stringFromLabel('③'), 3);
    assert.strictEqual(core.stringFromLabel('⑤'), 5);   // 5-string violin
    assert.strictEqual(core.stringFromLabel('A'), 0);
    assert.strictEqual(core.maxStrings(), 5);
    ['\u00bd', 'I', 'VIII', 'IX', 'XX'].forEach(function (m) {
        assert.ok(core.isPositionMark(m), m);
    });
    assert.ok(!core.isPositionMark('XXI'));
    assert.ok(!core.isPositionMark('T'));
});

test('thumb: articulation recognised by symbol id or subtype name', function () {
    assert.ok(core.isThumbArticulation(core.THUMB_SYMID, undefined));
    assert.ok(core.isThumbArticulation(-1, 'Thumb position'));
    assert.ok(!core.isThumbArticulation(1234, 'Staccato'));
});

test('thumb: competes only where the four-finger cost exceeds the threshold', function () {
    const th = core.INSTRUMENTS.cello.hand.thumb;
    const saved = th.threshold;
    const passage = melody([69, 72, 70, 74, 76, 72, 69, 65, 62, 64, 65, 70, 76, 71, 73, 79, 76, 74, 72, 70]);
    const thumbs = function () {
        return core.solveChords(passage, 0, 20, 'cello')
            .filter(function (r) { return r.combo[0][FING] === core.THUMB; }).length;
    };
    try {
        th.threshold = 1e9;
        assert.strictEqual(thumbs(), 0, 'never flagged: no thumb');
        th.threshold = -1;
        assert.ok(thumbs() > 0, 'always flagged: the thumb competes and wins somewhere');
    } finally { th.threshold = saved; }
});

test('thumb: an easy low passage never uses it with the default threshold', function () {
    const res = core.solveChords(melody([36, 38, 40, 41, 43, 45, 47, 48]), 0, 20, 'cello');
    res.forEach(function (r) { assert.notStrictEqual(r.combo[0][FING], core.THUMB); });
});
