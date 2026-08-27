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
    version: "1.3.0"
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

    // Staff the selection is on (0 when running on the whole score);
    // annotations are read from and written to this staff.
    property int targetStaff: 0

    // -- ownership of plugin-written annotations ----------
    // Everything the plugin writes is recorded in a score meta tag
    // ("violinFingering": JSON {v, items: [[tick, pitch, kind, text], ...]},
    // kind "f"=finger, "s"=string, "p"=position mark, pitch -1 for staff
    // text) and tinted with markerColor. On re-run, annotations matching
    // their registry entry are removed and regenerated; a plugin-written
    // text the user has edited no longer matches and is promoted to a
    // user constraint. Marker-colored elements with no registry slot
    // (registry lost or ticks shifted) fall back to plugin-owned.
    // Plugin annotations are written in autoColor (visible blue) or, when
    // colorize is unchecked, stealthColor (near-black); both are
    // recognized as plugin-owned. Promoted (user-edited) elements are
    // recolored to plain black.
    property string stealthColor: "#010101"
    property string autoColor: "#0065bf"
    property var pluginEls: []     // elements to remove on this run
    property var promotedEls: []   // edited by user: recolor to black
    property var registry: null

    function loadRegistry() {
        var reg = {items: [], consumed: [], byKey: {}, byKind: {}};
        try {
            var raw = curScore.metaTag("violinFingering");
            if (raw) reg.items = JSON.parse(raw).items || [];
        } catch (e) { reg.items = []; }
        for (var i = 0; i < reg.items.length; i++) {
            var it = reg.items[i];
            var key = it[0] + "|" + it[1] + "|" + it[2] + "|" + it[3];
            if (!reg.byKey[key]) reg.byKey[key] = [];
            reg.byKey[key].push(i);
            reg.byKind[it[0] + "|" + it[1] + "|" + it[2]] = true;
            reg.consumed.push(false);
        }
        return reg;
    }

    function isMarkerColored(el) {
        var c = ("" + el.color).toLowerCase();   // "#rrggbb" or "#aarrggbb"
        if (c.length < 7) return false;
        var hex = c.substr(c.length - 6);
        return hex === stealthColor.substr(1) || hex === autoColor.substr(1);
    }

    // "plugin" = remove and regenerate; "human" = honor as constraint.
    function classifyAnnotation(reg, el, tick, pitch, kind, text) {
        var idxs = reg.byKey[tick + "|" + pitch + "|" + kind + "|" + text];
        if (idxs) {
            for (var i = 0; i < idxs.length; i++)
                if (!reg.consumed[idxs[i]]) { reg.consumed[idxs[i]] = true; return "plugin"; }
        }
        if (isMarkerColored(el)) {
            // registered slot with different text = user edited it
            if (reg.byKind[tick + "|" + pitch + "|" + kind]) {
                promotedEls.push(el);
                return "human";
            }
            return "plugin";
        }
        return "human";
    }

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
        targetStaff = staffIdx;
        var byTick = {};
        var keyByTick = {};
        registry = loadRegistry();
        pluginEls = [];
        promotedEls = [];
        for (var voice = 0; voice < 4; voice++) {
            cursor.staffIdx = staffIdx;
            cursor.voice = voice;
            cursor.rewind(endTick < 0 ? Cursor.SCORE_START : Cursor.SELECTION_START);
            cursor.staffIdx = staffIdx;
            cursor.voice = voice;
            while (cursor.segment && (endTick < 0 || cursor.tick < endTick)) {
                // plugin-written position marks live on segments
                if (voice === 0 && cursor.segment.annotations) {
                    var anns = cursor.segment.annotations;
                    for (var an = 0; an < anns.length; an++) {
                        var a = anns[an];
                        if (!a || a.type !== Element.STAFF_TEXT) continue;
                        if (a.track !== undefined && Math.floor(a.track / 4) !== staffIdx) continue;
                        var ptxt = ("" + a.text).replace(/<[^>]*>/g, "").trim();
                        if (!/^(I|II|III|IV|V|VI|VII|VIII)$/.test(ptxt)) continue;
                        if (classifyAnnotation(registry, a, cursor.tick, -1, "p", ptxt) === "plugin")
                            pluginEls.push(a);
                    }
                }
                var el = cursor.element;
                if (el && el.type === Element.CHORD) {
                    if (keyByTick[cursor.tick] === undefined) {
                        try { keyByTick[cursor.tick] = cursor.keySignature; } catch (e0) {}
                    }
                    for (var i = 0; i < el.notes.length; i++) {
                        var note = el.notes[i];
                        if (note.tieBack) continue;
                        var p = note.pitch;
                        var ann = readAnnotations(note, cursor.tick);
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
            events.push({tick: ticks[ti], pitches: pitches,
                         key: keyByTick[ticks[ti]]});
        }
        return events;
    }

    function readAnnotations(note, tick) {
        // Existing finger and string annotations are honored as constraints.
        // - Plain digits 1-4 = finger number
        // - Plain "0" on an open-string pitch (G3/D4/A4/E5) = open-string finger
        // - "0" combined with a 1-4 digit = harmonic notation (lightly touch
        //   at the node with the given finger). Marked harmonic, excluded
        //   from the fingering chain, original annotations preserved.
        // - Lone "0" on a non-open pitch = legacy harmonic marker (ignored)
        // Plugin-owned annotations (see classifyAnnotation) are queued for
        // removal instead and never become constraints.
        var out = {string: null, finger: null, harmonic: false};
        if (!note.elements) return out;
        var isOpenStringPitch = (note.pitch === 55 || note.pitch === 62
                              || note.pitch === 69 || note.pitch === 76);
        var plainDigits = [], humanEls = [];
        for (var i = 0; i < note.elements.length; i++) {
            var el = note.elements[i];
            if (el.type !== Element.FINGERING) continue;
            var txt = ("" + el.text).replace(/<[^>]*>/g, "").trim();
            var isString = false;
            try {
                if (el.subStyle !== undefined && typeof Tid !== "undefined" &&
                    el.subStyle === Tid.STRING_NUMBER)
                    isString = true;
            } catch (e) {}
            var kind;
            if (/^[0-9]$/.test(txt)) kind = isString ? "s" : "f";
            else if (/^[①-④]$/.test(txt)) kind = "s";  // circled string number
            else if (/^(I|II|III|IV)$/.test(txt)) kind = "s";    // legacy plugin string mark
            else continue;
            if (classifyAnnotation(registry, el, tick, note.pitch, kind, txt) === "plugin") {
                pluginEls.push(el);
                continue;
            }
            humanEls.push(el);
            if (/^[①-④]$/.test(txt)) {
                out.string = txt.charCodeAt(0) - 0x2460 + 1;
                continue;
            }
            if (!/^[0-9]$/.test(txt)) continue;   // human Roman text: no constraint
            var v = parseInt(txt);
            if (kind === "s" && v >= 1 && v <= 4) out.string = v;
            else if (kind === "f") plainDigits.push(v);
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
        // Overwrite mode: manual finger/string annotations are replaced
        // too (harmonic notation is always preserved).
        if (overwrite.checked && !out.harmonic && humanEls.length) {
            for (var r = 0; r < humanEls.length; r++) pluginEls.push(humanEls[r]);
            out.string = null;
            out.finger = null;
        }
        return out;
    }

    // Detect key signature from the score. MuseScore stores key signatures as
    // sharp count (+) / flat count (-) on KeySig elements.
    function readKeySignature() {
        var c = curScore.newCursor();
        c.staffIdx = targetStaff; c.voice = 0;
        c.rewind(Cursor.SCORE_START);
        c.staffIdx = targetStaff; c.voice = 0;
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

    // -- clear plugin annotations ------------------------
    // Removes all plugin-owned annotations in the selection (or the whole
    // score) and updates the registry. Manual annotations are untouched
    // unless "Replace manual fingerings too" is checked.
    function clearAnnotations() {
        if (!curScore) { statusText.text = "No score is open"; return; }
        collectEvents();   // classifies annotations into pluginEls/promotedEls
        curScore.startCmd();
        for (var pr = 0; pr < promotedEls.length; pr++) {
            try { promotedEls[pr].color = "#000000"; } catch (e) {}
        }
        var removed = 0;
        for (var r = 0; r < pluginEls.length; r++) {
            try { removeElement(pluginEls[r]); removed++; } catch (e2) {}
        }
        var items = [];
        for (var q = 0; q < registry.items.length; q++)
            if (!registry.consumed[q]) items.push(registry.items[q]);
        curScore.setMetaTag("violinFingering", JSON.stringify({v: 1, items: items}));
        curScore.endCmd();
        statusText.text = "Cleared " + removed + " plugin annotation" + (removed === 1 ? "" : "s")
            + (items.length ? " (" + items.length + " outside the selection kept)" : "");
    }

    // -- write fingering annotations ---------------------
    function writeAnnotations(events, result) {
        curScore.startCmd();
        // annotations the user edited are theirs now: recolor to black
        for (var pr = 0; pr < promotedEls.length; pr++) {
            try { promotedEls[pr].color = "#000000"; } catch (e) {}
        }
        // remove what the plugin wrote on a previous run
        for (var r = 0; r < pluginEls.length; r++) {
            try { removeElement(pluginEls[r]); } catch (e) {}
        }
        var markerColor = colorize.checked ? autoColor : stealthColor;
        var newItems = [];
        var nFing = 0, nStr = 0, nPos = 0, nSkip = 0;
        var prevPos = -1;
        var cursor = curScore.newCursor();
        cursor.staffIdx = targetStaff; cursor.voice = 0;
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
                    fing.color = markerColor;
                    noteRefs[0].add(fing);
                    newItems.push([events[i].tick, pitchInfo.midi, "f", "" + k]);
                    nFing++;
                }
                if (writeStrings.checked && !hadString) {
                    var stringNum = 4 - s;
                    var sn = newElement(Element.FINGERING);
                    // Real string number = FINGERING with the String Number
                    // text style; MuseScore draws the circle itself.
                    var styled = false;
                    try {
                        if (typeof Tid !== "undefined") {
                            sn.subStyle = Tid.STRING_NUMBER;
                            styled = true;
                        }
                    } catch (e3) {}
                    sn.text = styled ? "" + stringNum
                                     : ["①","②","③","④"][stringNum - 1];
                    sn.color = markerColor;
                    noteRefs[0].add(sn);
                    newItems.push([events[i].tick, pitchInfo.midi, "s", sn.text]);
                    nStr++;
                }
            }
            // position mark once per hand-position change
            if (writePositions.checked && handPos !== prevPos) {
                cursor.rewindToTick(events[i].tick);
                var stx = newElement(Element.STAFF_TEXT);
                stx.text = Core.ROMAN[handPos];
                stx.color = markerColor;
                cursor.add(stx);
                newItems.push([events[i].tick, -1, "p", stx.text]);
                prevPos = handPos;
                nPos++;
            }
        }
        // Persist the registry: entries not consumed this run (e.g. outside
        // the selection) survive; consumed ones are replaced by newItems.
        var items = [];
        for (var q = 0; q < registry.items.length; q++)
            if (!registry.consumed[q]) items.push(registry.items[q]);
        items = items.concat(newItems);
        curScore.setMetaTag("violinFingering", JSON.stringify({v: 1, items: items}));
        curScore.endCmd();
        return {fing: nFing, str: nStr, pos: nPos, skip: nSkip};
    }

    function apply() {
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
                key: e.key,   // key signature in effect at this tick
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
            var bad = [];
            for (var bi = 0; bi < events.length && bad.length < 10; bi++)
                for (var bj = 0; bj < events[bi].pitches.length && bad.length < 10; bj++)
                    if (Core.candidatesForPitch(events[bi].pitches[bj].midi, key, 7).length === 0)
                        bad.push(noteName(events[bi].pitches[bj].midi) + " at tick " + events[bi].tick);
            statusText.text = "ViolinFingering could not solve this score (some notes outside violin range).\n"
                + (bad.length ? "Unplayable: " + bad.join(", ") + "\n" : "")
                + "Report issues at https://github.com/knoguchi/violin-fingering/issues";
            return;
        }
        var stats = writeAnnotations(events, result);
        // Position distribution
        var posDist = {};
        for (var i = 0; i < result.length; i++) {
            var st = result[i];
            if (!st || st.harmonic) continue;
            var p = st.pos;
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
        CheckBox { id: writeStrings;   checked: false; text: "Write string numbers (①=E, ②=A, ③=D, ④=G)" }
        CheckBox { id: colorize;       checked: true;  text: "Color auto-written annotations blue" }
        CheckBox { id: overwrite;      checked: false; text: "Replace manual fingerings too (plugin's own are always replaced)" }
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
                text: "Clear"
                onClicked: {
                    try { plugin.clearAnnotations(); }
                    catch (e) { statusText.text = "Exception while clearing: " + e + "\n" + (e.stack || "")
                        + "\nPlease report: https://github.com/knoguchi/violin-fingering/issues"; }
                }
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
                text: "v1.3.0 (selection staff + mid-piece key changes) - Run computes violin fingering and writes annotations; re-running replaces the plugin's own annotations while manual ones are honored as constraints. Clear removes the plugin's annotations. Issues: github.com/knoguchi/violin-fingering"
                wrapMode: TextEdit.Wrap
                readOnly: true
                selectByMouse: true
                color: "black"
            }
        }
    }
}
