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
        if (pitch === TUNING[s]) { out.push([s, 0, 1, 0]); continue; }
        if (pitch < TUNING[s]) continue;
        for (var p = 1; p <= maxPosition; p++) {
            for (var k = 1; k <= 4; k++) {
                var nominal = fingerPitch(s, p, k, key);
                var off = pitch - nominal;
                if (off === 0) out.push([s, k, p, 0]);
                else if (off === 1 || off === -1) out.push([s, k, p, off]);
            }
        }
    }
    return out;
}

// Cost weights
var W_POS_SHIFT = 3.0;
var W_POS_FIXED = 2.5;
var W_STRING_MOVE = 1.0;
var W_FINGER_MOVE = 0.1;
var W_OPEN_BONUS = -0.2;
var W_ACCIDENTAL = 0.3;
var W_LOW_POS = 0.05;

function transitionCost(prev, cur) {
    var s1 = prev[0], k1 = prev[1], p1 = prev[2];
    var s2 = cur[0],  k2 = cur[1],  p2 = cur[2];
    var ep1 = k1 > 0 ? p1 : p2;
    var ep2 = k2 > 0 ? p2 : p1;
    var c = 0.0;
    if (ep1 !== ep2) c += W_POS_FIXED + W_POS_SHIFT * Math.abs(ep1 - ep2);
    if (s1 !== s2) c += W_STRING_MOVE * Math.abs(s1 - s2);
    else if (k1 !== k2 && k1 > 0 && k2 > 0) c += W_FINGER_MOVE;
    return c;
}

function localCost(state) {
    var k = state[1], p = state[2], off = state[3];
    var c = 0.0;
    if (k === 0) c += W_OPEN_BONUS;
    if (off !== 0) c += W_ACCIDENTAL;
    c += W_LOW_POS * (p - 1);
    return c;
}

// Solve a sequence of single-note events. Each event = {pitch: midi}.
// Returns [[s, k, p, off], ...] or null if unplayable.
function solve(events, key, maxPosition) {
    if (!events.length) return [];
    var layers = [];
    for (var i = 0; i < events.length; i++) {
        var c = candidatesForPitch(events[i].pitch, key, maxPosition);
        if (!c.length) return null;
        layers.push(c);
    }
    var n = events.length;
    var cost = [layers[0].map(localCost)];
    var back = [layers[0].map(function () { return -1; })];
    for (var t = 1; t < n; t++) {
        var ct = [], bt = [];
        for (var j = 0; j < layers[t].length; j++) {
            var st = layers[t][j];
            var lc = localCost(st);
            var best = Infinity, bestK = -1;
            for (var k2 = 0; k2 < layers[t - 1].length; k2++) {
                var cand = cost[t - 1][k2] + transitionCost(layers[t - 1][k2], st) + lc;
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
            var pos = 1;
            if (fingeredPositions.length) {
                pos = fingeredPositions[0];
                for (var z = 1; z < fingeredPositions.length; z++)
                    if (fingeredPositions[z] < pos) pos = fingeredPositions[z];
            }
            out.push({combo: picked.slice(), pos: pos});
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

function chordLocalCost(combo, pos) {
    var c = 0.0;
    var positions = [];
    for (var i = 0; i < combo.length; i++) {
        var k = combo[i][1], p = combo[i][2], off = combo[i][3];
        if (k === 0) c += W_OPEN_BONUS;
        if (off !== 0) c += W_ACCIDENTAL;
        if (k > 0) positions.push(p);
    }
    c += W_LOW_POS * (pos - 1);
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

function chordTransCost(prevPos, curPos) {
    if (prevPos !== curPos) return W_POS_FIXED + W_POS_SHIFT * Math.abs(prevPos - curPos);
    return 0.0;
}

// Solve chord events. Each event = {pitches: [{pitch, string?, finger?}, ...]}
// Returns aligned list of {combo, pos} or null.
function solveChords(events, key, maxPosition) {
    if (!events.length) return [];
    var layers = [];
    for (var i = 0; i < events.length; i++) {
        var combos = candidatesForEvent(events[i].pitches, key, maxPosition);
        if (!combos.length) return null;
        layers.push(combos);
    }
    var n = events.length;
    var cost = [layers[0].map(function (st) { return chordLocalCost(st.combo, st.pos); })];
    var back = [layers[0].map(function () { return -1; })];
    for (var t = 1; t < n; t++) {
        var ct = [], bt = [];
        for (var j = 0; j < layers[t].length; j++) {
            var lc = chordLocalCost(layers[t][j].combo, layers[t][j].pos);
            var best = Infinity, bestK = -1;
            for (var k2 = 0; k2 < layers[t - 1].length; k2++) {
                var cand = cost[t - 1][k2]
                    + chordTransCost(layers[t - 1][k2].pos, layers[t][j].pos)
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
