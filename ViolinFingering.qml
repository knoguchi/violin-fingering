// ViolinFingering - automatic violin fingering for MuseScore Studio 4.4+
// Copyright (C) 2026 Kenji Noguchi <tokyo246@gmail.com>
// License: GPL-3.0 (see LICENSE)
// https://github.com/knoguchi/violin-fingering
//
// Computes (string, finger, position) for every note of a violin score using
// position-aware Viterbi dynamic programming, and writes finger numbers and
// position marks as annotations on the staff. Tuning is fixed to G3 D4 A4 E5;
// the key signature is read from the score and determines the finger layout
// at each (string, position).

import QtQuick
import QtQuick.Controls
import QtQuick.Layouts 1.3
import MuseScore 3.0
import "violin_fingering_core.js" as Core

MuseScore {
    id: plugin
    version: "1.4"
    title: "ViolinFingering"
    description: "Violin fingering (string/finger/position) by dynamic programming. Reads key signature; writes finger numbers and Roman-numeral position marks."
    categoryCode: "composing-arranging-tools"
    pluginType: "dialog"
    width: 420
    height: 460

    onRun: {
        if (!curScore) {
            statusText.text = "No score is open";
        }
    }

    property var voiceCounts: [0, 0, 0, 0]
    property var voiceEvents: [[], [], [], []]
    property var trace: []
    function tlog(s) { trace.push(s); console.log("[ViolinFingering] " + s); }

    // -- score scanning ----------------------------------
    function collectEvents() {
        var cursor = curScore.newCursor();
        cursor.rewind(Cursor.SELECTION_START);
        var staffIdx = 0, endTick = -1;
        if (cursor.segment) {
            staffIdx = cursor.staffIdx;
            var c2 = curScore.newCursor();
            c2.rewind(Cursor.SELECTION_END);
            endTick = c2.tick === 0 ? curScore.lastSegment.tick + 1 : c2.tick;
        }
        var byTick = {};
        voiceCounts = [0, 0, 0, 0];
        voiceEvents = [[], [], [], []];
        for (var voice = 0; voice < 4; voice++) {
            cursor.staffIdx = staffIdx;
            cursor.voice = voice;
            cursor.rewind(endTick < 0 ? Cursor.SCORE_START : Cursor.SELECTION_START);
            cursor.staffIdx = staffIdx;
            cursor.voice = voice;
            while (cursor.segment && (endTick < 0 || cursor.tick < endTick)) {
                var el = cursor.element;
                if (el && el.type === Element.REST) {
                    voiceEvents[voice].push({tick: cursor.tick, rest: true,
                        mTick: cursor.measure ? cursor.measure.firstSegment.tick : -1,
                        dur: el.duration
                             ? {num: el.duration.numerator, den: el.duration.denominator}
                             : {num: 1, den: 4}});
                }
                if (el && el.type === Element.CHORD) {
                    var t0 = cursor.tick;
                    var vEv = {tick: t0, pitches: [], ties: [],
                               mTick: cursor.measure ? cursor.measure.firstSegment.tick : -1,
                               dur: el.duration
                                    ? {num: el.duration.numerator, den: el.duration.denominator}
                                    : {num: 1, den: 4}};
                    for (var i0 = 0; i0 < el.notes.length; i0++) {
                        vEv.pitches.push(el.notes[i0].pitch);
                        if (el.notes[i0].tieBack) vEv.ties.push(el.notes[i0].pitch);
                    }
                    voiceEvents[voice].push(vEv);
                    for (var i = 0; i < el.notes.length; i++) {
                        var note = el.notes[i];
                        if (note.tieBack) continue;
                        voiceCounts[voice]++;
                        var p = note.pitch;
                        var ann = readAnnotations(note);
                        var t = cursor.tick;
                        if (!byTick[t]) byTick[t] = {};
                        if (byTick[t][p]) {
                            byTick[t][p].refs.push(note);
                            if (byTick[t][p].string === null) byTick[t][p].string = ann.string;
                            if (byTick[t][p].finger === null) byTick[t][p].finger = ann.finger;
                            if (ann.harmonic) byTick[t][p].harmonic = true;
                        } else {
                            byTick[t][p] = {midi: p, string: ann.string, finger: ann.finger,
                                            harmonic: ann.harmonic, refs: [note]};
                        }
                    }
                }
                cursor.next();
            }
        }
        var ticks = Object.keys(byTick).map(Number).sort(function (a, b) { return a - b; });
        var events = [];
        for (var ti = 0; ti < ticks.length; ti++) {
            var pitches = Object.keys(byTick[ticks[ti]])
                .map(function (k) { return byTick[ticks[ti]][k]; })
                .sort(function (a, b) { return b.midi - a.midi; });
            events.push({tick: ticks[ti], pitches: pitches});
        }
        return events;
    }

    function readAnnotations(note) {
        // Existing finger and string annotations are honored as constraints.
        // - Plain digits 1-4 = finger number
        // - Plain "0" on an open-string pitch (G3/D4/A4/E5) = open-string finger
        // - "0" combined with a 1-4 digit = harmonic notation (lightly touch
        //   at the node with the given finger). Marked harmonic, excluded
        //   from the fingering chain, original annotations preserved.
        // - Lone "0" on a non-open pitch = legacy harmonic marker (ignored)
        var out = {string: null, finger: null, harmonic: false};
        if (!note.elements) return out;
        var isOpenStringPitch = (note.pitch === 55 || note.pitch === 62
                              || note.pitch === 69 || note.pitch === 76);
        var plainDigits = [];
        for (var i = 0; i < note.elements.length; i++) {
            var el = note.elements[i];
            if (el.type !== Element.FINGERING) continue;
            var txt = ("" + el.text).replace(/<[^>]*>/g, "").trim();
            if (!/^[0-9]$/.test(txt)) continue;
            var v = parseInt(txt);
            var isString = false;
            try {
                if (el.subStyle !== undefined && typeof Tid !== "undefined" &&
                    el.subStyle === Tid.STRING_NUMBER)
                    isString = true;
            } catch (e) {}
            if (isString && v >= 1 && v <= 4) out.string = v;
            else plainDigits.push(v);
        }
        var hasZero = plainDigits.indexOf(0) >= 0;
        var nonZero = plainDigits.filter(function (d) { return d > 0 && d <= 4; });
        if (hasZero && nonZero.length >= 1) {
            // "0" + finger digit = harmonic
            out.harmonic = true;
        } else if (nonZero.length === 1) {
            out.finger = nonZero[0];
        } else if (plainDigits.length === 1 && plainDigits[0] === 0 && isOpenStringPitch) {
            out.finger = 0;
        }
        return out;
    }

    // Detect key signature from the score. MuseScore stores key signatures as
    // sharp count (+) / flat count (-) on KeySig elements.
    function readKeySignature() {
        var c = curScore.newCursor();
        c.staffIdx = 0; c.voice = 0;
        c.rewind(Cursor.SCORE_START);
        c.staffIdx = 0; c.voice = 0;
        // The key signature is associated with segments. Try to read from
        // the first measure's KeySig if present; default to 0 (C major).
        var key = 0;
        try {
            if (c.keySignature !== undefined) key = c.keySignature;
        } catch (e) {}
        return key;
    }

    function noteName(midi) {
        var n = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
        return n[midi % 12] + (Math.floor(midi / 12) - 1);
    }

    // -- diagnostics -------------------------------------
    function diagnose() {
        var lines = [];
        function log(s) { lines.push(s); console.log("[ViolinFingering] " + s); }
        log("ViolinFingering v1.0 / MuseScore " + (mscoreVersion !== undefined ? mscoreVersion : "?"));
        if (!curScore) { log("no score is open"); return lines.join("\n"); }
        log("score: " + curScore.scoreName + " / staves " + curScore.nstaves);
        var key = readKeySignature();
        log("key signature: " + key + " (sharps if +, flats if -)");
        var events;
        try { events = collectEvents(); }
        catch (e) { log("exception while collecting: " + e); return lines.join("\n"); }
        log("events: " + events.length);
        if (events.length === 0) return lines.join("\n");
        var lo = 999, hi = 0, maxNotes = 0;
        var annStr = 0, annFing = 0;
        for (var i = 0; i < events.length; i++) {
            if (events[i].pitches.length > maxNotes) maxNotes = events[i].pitches.length;
            for (var j = 0; j < events[i].pitches.length; j++) {
                var p3 = events[i].pitches[j];
                if (p3.midi < lo) lo = p3.midi;
                if (p3.midi > hi) hi = p3.midi;
                if (p3.string !== null) annStr++;
                if (p3.finger !== null) annFing++;
            }
        }
        log("pitch range: " + noteName(lo) + "(" + lo + ") - " + noteName(hi) + "(" + hi + ")");
        log("max simultaneous notes: " + maxNotes + " / annotations: strings " + annStr + " fingers " + annFing);
        log("notes per voice: " + voiceCounts.join(" / "));
        // Try to solve
        try {
            var chordEv = events.map(function (e) {
                return {pitches: e.pitches.map(function (p) {
                    return {pitch: p.midi, string: p.string, finger: p.finger};
                })};
            });
            var result = Core.solveChords(chordEv, key, 7);
            log(result ? "Viterbi: solution found (ready to write)"
                       : "Viterbi: no solution (some notes unplayable on violin)");
            if (!result) {
                for (var k = 0; k < events.length; k++) {
                    var cand = Core.candidatesForPitch(events[k].pitches[0].midi, key, 7);
                    if (cand.length === 0) {
                        log("unplayable: " + noteName(events[k].pitches[0].midi) + " at tick " + events[k].tick);
                        if (lines.length > 30) break;
                    }
                }
            }
        } catch (e2) { log("solve exception: " + e2); }
        return lines.join("\n");
    }

    // -- write fingering annotations ---------------------
    function writeAnnotations(events, result) {
        curScore.startCmd();
        var nFing = 0, nStr = 0, nPos = 0, nSkip = 0;
        var prevPos = -1;
        var cursor = curScore.newCursor();
        cursor.staffIdx = 0; cursor.voice = 0;
        for (var i = 0; i < result.length; i++) {
            var st = result[i];
            if (!st || st.harmonic) { nSkip++; continue; }
            var combo = st.combo, handPos = st.pos;
            // Write finger and string number for EACH note in the chord
            for (var j = 0; j < combo.length; j++) {
                var s = combo[j][0], k = combo[j][1];
                var pitchInfo = events[i].pitches[j];
                var noteRefs = pitchInfo.refs;
                var hadFinger = pitchInfo.finger !== null;
                var hadString = pitchInfo.string !== null;
                if (writeFingers.checked && !hadFinger) {
                    // open string finger = 0
                    var fing = newElement(Element.FINGERING);
                    fing.text = "" + k;
                    noteRefs[0].add(fing);
                    nFing++;
                }
                if (writeStrings.checked && !hadString) {
                    var stringNum = 4 - s;
                    var sn = newElement(Element.FINGERING);
                    sn.text = ["I","II","III","IV"][stringNum - 1];
                    noteRefs[0].add(sn);
                    nStr++;
                }
            }
            // position mark once per hand-position change
            if (writePositions.checked && handPos !== prevPos) {
                cursor.rewindToTick(events[i].tick);
                var stx = newElement(Element.STAFF_TEXT);
                stx.text = Core.ROMAN[handPos];
                cursor.add(stx);
                prevPos = handPos;
                nPos++;
            }
        }
        curScore.endCmd();
        return {fing: nFing, str: nStr, pos: nPos, skip: nSkip};
    }

    function apply() {
        trace = [];
        var events = collectEvents();
        if (events.length === 0) { statusText.text = "No notes found"; return; }
        var key = readKeySignature();
        // Build chord events. Events with any harmonic note become segment
        // boundaries: solved independently from neighboring segments because
        // the hand may move freely to and from the node.
        var chordEvents = events.map(function (e) {
            var hasHarmonic = e.pitches.some(function (p) { return p.harmonic; });
            return {
                pitches: e.pitches.map(function (p) {
                    return {pitch: p.midi, string: p.string, finger: p.finger,
                            harmonic: p.harmonic || false};
                }),
                isHarmonic: hasHarmonic
            };
        });
        // Split into segments at harmonic events; solve each independently.
        var result = new Array(chordEvents.length);
        var segStart = 0;
        for (var ei = 0; ei <= chordEvents.length; ei++) {
            var atEnd = (ei === chordEvents.length);
            var isBoundary = atEnd || chordEvents[ei].isHarmonic;
            if (isBoundary) {
                // Solve [segStart, ei) as one segment
                if (ei > segStart) {
                    var seg = chordEvents.slice(segStart, ei).filter(function (e) {
                        return !e.isHarmonic;
                    });
                    if (seg.length > 0) {
                        var segResult = Core.solveChords(seg, key, 7);
                        if (segResult) {
                            var ri = 0;
                            for (var k = segStart; k < ei; k++) {
                                if (chordEvents[k].isHarmonic) {
                                    result[k] = {harmonic: true};
                                } else {
                                    result[k] = segResult[ri++];
                                }
                            }
                        }
                    } else {
                        // segment is entirely harmonic
                        for (var k2 = segStart; k2 < ei; k2++) result[k2] = {harmonic: true};
                    }
                }
                if (!atEnd && chordEvents[ei].isHarmonic) {
                    result[ei] = {harmonic: true};
                }
                segStart = ei + 1;
            }
        }
        var result_orig = result;
        // Check if anything was solved
        var hasAnySolved = result.some(function (r) { return r && !r.harmonic; });
        result = hasAnySolved ? result : null;
        if (!result) {
            statusText.text = "ViolinFingering could not solve this score (some notes outside violin range).\n"
                + "Click Diagnose to see which notes are unplayable.\n"
                + "Report issues at https://github.com/knoguchi/violin-fingering/issues";
            return;
        }
        var stats = writeAnnotations(events, result);
        // Position distribution
        var posDist = {};
        for (var i = 0; i < result.length; i++) {
            var p = result[i].pos;
            posDist[p] = (posDist[p] || 0) + 1;
        }
        var posStr = Object.keys(posDist).sort().map(function (k) {
            return "pos" + k + ":" + posDist[k];
        }).join(" ");
        statusText.text = "Key: " + key + " (" + (key > 0 ? key + " sharps" : key < 0 ? (-key) + " flats" : "C major / A minor") + ")\n"
            + "Done: " + events.length + " events processed\n"
            + "Fingers written: " + stats.fing
            + (writeStrings.checked ? " / strings: " + stats.str : "")
            + (writePositions.checked ? " / positions: " + stats.pos : "")
            + "\nPosition use: " + posStr;
    }

    // -- UI ----------------------------------------------
    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 14
        spacing: 6
        Text {
            Layout.fillWidth: true
            wrapMode: Text.Wrap
            text: "Computes violin fingering for the selection (or whole score) and writes finger numbers and position marks as annotations.\nExisting finger/string annotations are honored as constraints."
        }
        CheckBox { id: writeFingers;   checked: true;  text: "Write left-hand finger numbers (1-4)" }
        CheckBox { id: writePositions; checked: true;  text: "Write positions (Roman numerals)" }
        CheckBox { id: writeStrings;   checked: false; text: "Write string numbers (I=E, II=A, III=D, IV=G)" }
        CheckBox { id: overwrite;      checked: false; text: "Also write on notes with existing annotations" }
        RowLayout {
            Button {
                text: "Run"
                onClicked: {
                    statusText.text = "Running...";
                    try { plugin.apply(); }
                    catch (e) { statusText.text = "Exception while running: " + e + "\n" + (e.stack || "")
                        + "\nPlease report: https://github.com/knoguchi/violin-fingering/issues"; }
                }
            }
            Button {
                text: "Diagnose"
                onClicked: {
                    try { statusText.text = plugin.diagnose(); }
                    catch (e) { statusText.text = "Exception in diagnostics: " + e + "\n" + (e.stack || "")
                        + "\nPlease report: https://github.com/knoguchi/violin-fingering/issues"; }
                }
            }
            Button {
                text: "Copy log"
                onClicked: { statusText.selectAll(); statusText.copy(); statusText.deselect(); }
            }
            Button { text: "Close"; onClicked: quit() }
        }
        Flickable {
            Layout.fillWidth: true
            Layout.fillHeight: true
            contentHeight: statusText.height
            clip: true
            TextEdit {
                id: statusText
                width: parent.width
                text: "v1.4 - Run computes violin fingering and writes annotations. Chord events are solved as joint hand frames. Use Copy log to share results. Issues: github.com/knoguchi/violin-fingering"
                wrapMode: TextEdit.Wrap
                readOnly: true
                selectByMouse: true
                color: "black"
            }
        }
    }
}
