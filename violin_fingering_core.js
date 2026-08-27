.pragma library
// violin_fingering_core.js - violin fingering core (pure JS, MuseScore-independent)
// Copyright (C) 2026 Kenji Noguchi <tokyo246@gmail.com> - GPL-3.0
//
// State = (string, finger, position, accidental_offset).
// The fingering for a given key signature is fixed: in each (string,
// position), the four fingers play four consecutive scale tones. An
// accidental displaces the finger by +/-1 semitone from its key position.

var TUNING = [55, 62, 69, 76];           // G3 D4 A4 E5 (low to high)
var STRING_NAMES = ["G", "D", "A", "E"];

var SHARP_ORDER = [6, 1, 8, 3, 10, 5, 0];   // F# C# G# D# A# E# B# (mod 12)
var FLAT_ORDER  = [10, 3, 8, 1, 6, 11, 4];  // Bb Eb Ab Db Gb Cb Fb

var ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII"];

function keyScale(key) {
    var s = {0:1, 2:1, 4:1, 5:1, 7:1, 9:1, 11:1};   // C major
    if (key > 0) {
        for (var i = 0; i < key; i++) {
            delete s[(SHARP_ORDER[i] - 1 + 12) % 12];
            s[SHARP_ORDER[i]] = 1;
        }
    } else if (key < 0) {
        for (var j = 0; j < -key; j++) {
            delete s[(FLAT_ORDER[j] + 1) % 12];
            s[FLAT_ORDER[j]] = 1;
        }
    }
    var out = [];
    for (var k in s) out.push(parseInt(k));
    return out.sort(function (a, b) { return a - b; });
}

function fingerPitch(stringIdx, position, finger, key) {
    var open = TUNING[stringIdx];
    var scale = keyScale(key);
    var inScale = {};
    for (var i = 0; i < scale.length; i++) inScale[scale[i]] = 1;
    var p = open + 1, hits = [];
    while (hits.length < position + 4) {
        if (inScale[p % 12]) hits.push(p);
        p++;
    }
    return hits[(position - 1) + (finger - 1)];
}

function candidatesForPitch(pitch, key, maxPosition) {
    if (maxPosition === undefined) maxPosition = 7;
    var out = [];
    for (var s = 0; s < 4; s++) {
        if (pitch === TUNING[s]) { out.push([s, 0, 1, 0, pitch]); continue; }
        if (pitch < TUNING[s]) continue;
        for (var p = 1; p <= maxPosition; p++) {
            for (var k = 1; k <= 4; k++) {
                var nominal = fingerPitch(s, p, k, key);
                var off = pitch - nominal;
                if (off === 0) out.push([s, k, p, 0, pitch]);
                else if (off === 1 || off === -1) out.push([s, k, p, off, pitch]);
            }
        }
    }
    return out;
}

// Cost weights
var W_POS_SHIFT = 3.0;
var W_POS_FIXED = 2.5;
// Bow crossing by string distance: staying, adjacent, skip one, skip two.
// Adjacent crossings are nearly free; skipping over strings is a real
// bow maneuver and must cost more than linearly.
var W_CROSS = [0.0, 0.5, 2.5, 5.0];
// Same finger jumping to another string must lift and replace (gap/smear
// risk), comparable to a small shift. Exception: a perfect fifth on
// adjacent strings is a one-finger barre.
var W_SAME_FINGER_CROSS = 1.5;
var W_BARRE = 0.1;
// Same finger sliding a semitone on the same string (audible slide or
// lift-replace). Must cost more than switching to the adjacent finger.
var W_SEMITONE_SLIDE = 0.5;
// Same-string finger move reaching beyond the hand frame (~2 semitones
// per finger step), per excess semitone.
var W_STRETCH = 0.4;
// Open strings cannot be vibrated and stick out in timbre; prefer a
// fingered note when one is reachable. Set equal to one adjacent bow
// crossing: an open string is still chosen when it saves a shift or
// more than one crossing (fast/complex passages), but not otherwise.
var W_OPEN = 0.5;
// Displacing a finger from its key frame. True accidentals pay this on
// every candidate equally; it mainly discourages a displaced finger when
// the in-frame finger for the same pitch is available.
var W_ACCIDENTAL = 0.6;
var W_LOW_POS = 0.05;
// Shifting while an open string sounds hides the slide.
var OPEN_SHIFT_DISCOUNT = 0.5;

// --- chord-aware (multi-note per event) ---------------

var CHORD_POS_SPAN = 1;

function candidatesForEvent(notes, key, maxPosition) {
    if (maxPosition === undefined) maxPosition = 7;
    var perNote = [];
    for (var i = 0; i < notes.length; i++) {
        var cs = candidatesForPitch(notes[i].pitch, key, maxPosition);
        if (notes[i].string != null) {
            var ms = 4 - notes[i].string;
            cs = cs.filter(function (c) { return c[0] === ms; });
        }
        if (notes[i].finger != null) {
            var fg = notes[i].finger;
            cs = cs.filter(function (c) { return c[1] === fg; });
        }
        if (!cs.length) return [];
        perNote.push(cs);
    }
    var out = [];
    function recurse(idx, picked, usedStrings, fingeredPositions) {
        if (idx === notes.length) {
            if (fingeredPositions.length) {
                var pos = fingeredPositions[0];
                for (var z = 1; z < fingeredPositions.length; z++)
                    if (fingeredPositions[z] < pos) pos = fingeredPositions[z];
                out.push({combo: picked.slice(), pos: pos, openOnly: false});
            } else {
                // All open strings: the hand does not have to move. Emit
                // one candidate per position so the Viterbi carries the
                // hand position through instead of snapping to I.
                for (var q = 1; q <= maxPosition; q++)
                    out.push({combo: picked.slice(), pos: q, openOnly: true});
            }
            return;
        }
        for (var i = 0; i < perNote[idx].length; i++) {
            var cand = perNote[idx][i];
            var s = cand[0], k = cand[1], p = cand[2];
            if (usedStrings[s]) continue;
            var newSet = fingeredPositions;
            if (k > 0) {
                newSet = fingeredPositions.concat([p]);
                var mn = newSet[0], mx = newSet[0];
                for (var z = 1; z < newSet.length; z++) {
                    if (newSet[z] < mn) mn = newSet[z];
                    if (newSet[z] > mx) mx = newSet[z];
                }
                if (mx - mn > CHORD_POS_SPAN) continue;
            }
            picked.push(cand);
            usedStrings[s] = true;
            recurse(idx + 1, picked, usedStrings, newSet);
            picked.pop();
            delete usedStrings[s];
        }
    }
    recurse(0, [], {}, []);
    return out;
}

function chordLocalCost(entry) {
    var combo = entry.combo;
    var c = 0.0;
    var positions = [];
    for (var i = 0; i < combo.length; i++) {
        var k = combo[i][1], p = combo[i][2], off = combo[i][3];
        if (k === 0) c += W_OPEN;
        if (off !== 0) c += W_ACCIDENTAL;
        if (k > 0) positions.push(p);
    }
    // Open-only events have no real hand placement; their pos is virtual.
    if (!entry.openOnly) c += W_LOW_POS * (entry.pos - 1);
    // Penalize position span across fingered strings (hand shape contortion).
    // Different fingers per se are not a cost; only the position spread is.
    if (positions.length >= 2) {
        var mn = positions[0], mx = positions[0];
        for (var z = 1; z < positions.length; z++) {
            if (positions[z] < mn) mn = positions[z];
            if (positions[z] > mx) mx = positions[z];
        }
        c += 0.5 * (mx - mn);
    }
    return c;
}

function chordTransCost(prev, cur) {
    var c = 0.0;
    if (prev.pos !== cur.pos) {
        var shift = W_POS_FIXED + W_POS_SHIFT * Math.abs(prev.pos - cur.pos);
        if (prev.openOnly || cur.openOnly) shift *= OPEN_SHIFT_DISCOUNT;
        c += shift;
    }
    // Bow crossing: gap between the string ranges of the two events.
    var mn1 = 4, mx1 = -1, mn2 = 4, mx2 = -1;
    for (var i = 0; i < prev.combo.length; i++) {
        var s1 = prev.combo[i][0];
        if (s1 < mn1) mn1 = s1;
        if (s1 > mx1) mx1 = s1;
    }
    for (var j = 0; j < cur.combo.length; j++) {
        var s2 = cur.combo[j][0];
        if (s2 < mn2) mn2 = s2;
        if (s2 > mx2) mx2 = s2;
    }
    var gap = Math.max(0, mn2 - mx1, mn1 - mx2);
    c += W_CROSS[Math.min(gap, 3)];
    // Melodic finger continuity (single-note events only).
    if (prev.combo.length === 1 && cur.combo.length === 1) {
        var a = prev.combo[0], b = cur.combo[0];
        if (a[1] > 0 && a[1] === b[1] && a[0] !== b[0]) {
            // Barre = same physical spot on adjacent strings (perfect fifth),
            // regardless of how the key frame labels the two notes.
            var barre = Math.abs(a[0] - b[0]) === 1
                && a[4] - TUNING[a[0]] === b[4] - TUNING[b[0]];
            c += barre ? W_BARRE : W_SAME_FINGER_CROSS;
        } else if (a[0] === b[0] && a[1] > 0 && b[1] > 0 && a[1] !== b[1]) {
            // Dropping/lifting to another finger in frame is free;
            // only reaching beyond the frame costs.
            var stretch = Math.abs(a[4] - b[4]) - 2 * Math.abs(a[1] - b[1]);
            if (stretch > 0) c += W_STRETCH * stretch;
        } else if (a[0] === b[0] && a[1] > 0 && a[1] === b[1] && a[3] !== b[3]) {
            c += W_SEMITONE_SLIDE;
        }
    }
    return c;
}

// Solve chord events. Each event = {pitches: [{pitch, string?, finger?}, ...]}
// with an optional per-event key override (mid-piece key signature changes);
// events without one use the piece-level key argument.
// Returns aligned list of {combo, pos} or null.
//
// A manually noted finger is a reset: the player has declared where the
// hand is, so the chain restarts there. Each segment [pin, next pin) is
// solved independently - downstream context cannot drag notes before a
// pin away from the pinned position, and vice versa.
function solveChords(events, key, maxPosition) {
    if (!events.length) return [];
    var out = [];
    var start = 0;
    for (var i = 1; i <= events.length; i++) {
        if (i < events.length && !eventHasPin(events[i])) continue;
        var seg = solveChordSeg(events.slice(start, i), key, maxPosition);
        if (!seg) return null;
        out = out.concat(seg);
        start = i;
    }
    return out;
}

function eventHasPin(e) {
    for (var i = 0; i < e.pitches.length; i++)
        if (e.pitches[i].finger != null) return true;
    return false;
}

function solveChordSeg(events, key, maxPosition) {
    if (!events.length) return [];
    var layers = [];
    for (var i = 0; i < events.length; i++) {
        var evKey = events[i].key != null ? events[i].key : key;
        var combos = candidatesForEvent(events[i].pitches, evKey, maxPosition);
        if (!combos.length) return null;
        layers.push(combos);
    }
    var n = events.length;
    var cost = [layers[0].map(chordLocalCost)];
    var back = [layers[0].map(function () { return -1; })];
    for (var t = 1; t < n; t++) {
        var ct = [], bt = [];
        for (var j = 0; j < layers[t].length; j++) {
            var lc = chordLocalCost(layers[t][j]);
            var best = Infinity, bestK = -1;
            for (var k2 = 0; k2 < layers[t - 1].length; k2++) {
                var cand = cost[t - 1][k2]
                    + chordTransCost(layers[t - 1][k2], layers[t][j])
                    + lc;
                if (cand < best) { best = cand; bestK = k2; }
            }
            ct.push(best); bt.push(bestK);
        }
        cost.push(ct); back.push(bt);
    }
    var jb = 0;
    for (var jj = 1; jj < cost[n - 1].length; jj++)
        if (cost[n - 1][jj] < cost[n - 1][jb]) jb = jj;
    var path = new Array(n);
    for (var tt = n - 1; tt >= 0; tt--) {
        path[tt] = layers[tt][jb];
        jb = back[tt][jb];
    }
    return path;
}
