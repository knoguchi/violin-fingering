// ViolinFingering - automatic violin fingering for MuseScore Studio 4.4+
// Copyright (C) 2026 Kenji Noguchi <tokyo246@gmail.com>
// License: GPL-3.0 (see LICENSE)
// https://github.com/knoguchi/violin-fingering
//
// Computes (string, finger, position) for every note of a violin, viola or cello
// staff using position-aware Viterbi dynamic programming, and writes finger
// numbers and position marks as annotations. The staff is chosen in the
// dialog; its instrument (per the radio buttons) is
// pre-selected from the part. The key signature is read from the score and
// determines the finger layout at each (string, position).

import QtQuick
import QtQuick.Controls
import QtQuick.Layouts 1.3
import MuseScore 3.0
import "violin_fingering_core.js" as Core

MuseScore {
    id: plugin
    version: "1.6.0-rc2"
    title: "ViolinFingering"
    description: "Violin fingering (string/finger/position) by dynamic programming. Reads key signature; writes finger numbers and Roman-numeral position marks."
    pluginType: "dialog"
    width: 420
    height: 530

    onRun: {
        if (!curScore) {
            statusBody = "No score is open";
            return;
        }
        staffModel = buildStaffModel();
        lastStaff = -1;
        refreshTarget();
    }

    // The staff being processed. A range selection wins: its first staff and
    // its tick range. With no selection the staff dropdown picks the staff
    // and the whole staff is processed. One staff at a time.
    property int targetStaff: 0
    property var staffModel: []
    // {has, staff, nStaves} describing the current range selection.
    property var sel: ({has: false, staff: 0, nStaves: 0})
    property int lastStaff: -1

    function readSelection() {
        var out = {has: false, staff: 0, nStaves: 0};
        var c = curScore.newCursor();
        c.rewind(Cursor.SELECTION_START);
        if (!c.segment) return out;
        out.has = true;
        out.staff = c.staffIdx;
        out.nStaves = 1;
        try {
            var n = curScore.selection.endStaff - curScore.selection.startStaff;
            if (n > 1) out.nStaves = n;
        } catch (e) {}
        return out;
    }

    function staffEntry(staffIdx) {
        for (var i = 0; i < staffModel.length; i++)
            if (staffModel[i].staff === staffIdx) return staffModel[i];
        return null;
    }

    function effectiveStaff() {
        if (sel.has) return sel.staff;
        return staffModel.length
            ? staffModel[Math.max(0, staffSelect.currentIndex)].staff : 0;
    }

    // Re-read the selection (it may have changed while the dialog is open)
    // and pre-select the instrument when the staff under work changed.
    function refreshTarget() {
        sel = readSelection();
        var st = effectiveStaff();
        if (st !== lastStaff) { lastStaff = st; instrumentForStaff(); }
    }

    // "Selection: 2: Violin II - 5-string violin", for the line above the options.
    function targetSummary() {
        var e = staffEntry(effectiveStaff());
        var txt = (sel.has ? "Selection: " : "Whole staff: ") + (e ? e.text : "?");
        if (sel.nStaves > 1)
            txt += " (first of " + sel.nStaves + " selected staves; one at a time)";
        return txt + " - " + (activeInst ? activeInst.label : "");
    }

    // Instrument being fingered: the instrument radio buttons. The
    // staff dropdown pre-selects it from the part's instrument id; the
    // last choice is remembered (see prefs) for parts with unknown ids.
    // All geometry and cost weights come from Core.INSTRUMENTS.
    property string activeInstrument: "violin"
    readonly property var activeInst: Core.INSTRUMENTS[activeInstrument]
    property var prefs: null
    // Result or error shown under the version line in the status area, so a
    // copied status always carries the version (for issue reports).
    property string statusBody: ""

    // Every instrument in Core.INSTRUMENTS gets a radio button; the ones
    // flagged experimental are marked in red when selected.
    readonly property var instrumentNames: Object.keys(Core.INSTRUMENTS)

    function detectPartInstrument(partIndex) {
        try {
            var part = curScore.parts[partIndex];
            var id = "";
            try { if (part.instrumentId) id += part.instrumentId; } catch (e1) {}
            try { if (part.musicXmlId) id += "|" + part.musicXmlId; } catch (e2) {}
            return Core.detectInstrument(id);
        } catch (e) {}
        return "";   // unknown: keep the radio selection
    }

    function setInstrument(name) {
        if (!Core.INSTRUMENTS[name]) return;
        activeInstrument = name;
        if (prefs) { try { prefs.instrument = name; } catch (e) {} }
    }

    // Pre-select the radio from the chosen staff's part.
    function instrumentForStaff() {
        var entry = staffEntry(effectiveStaff());
        var det = entry ? detectPartInstrument(entry.partIndex) : "";
        if (det) activeInstrument = det;
    }

    Component.onCompleted: {
        // Qt.labs.settings may be missing in some hosts; remembering the
        // last instrument is optional, so create it defensively.
        try {
            prefs = Qt.createQmlObject(
                'import QtQuick 2.9; import Qt.labs.settings 1.0; '
                + 'Settings { category: "ViolinFingering"; '
                + 'property string instrument: "violin" }', plugin, "prefs");
            if (Core.INSTRUMENTS[prefs.instrument])
                activeInstrument = prefs.instrument;
        } catch (e) { prefs = null; }
    }

    // "①=E, ②=A, ③=D, ④=G" for the active instrument.
    function stringKey() {
        var n = activeInst.strings.tuning.length, out = [];
        for (var i = 0; i < n; i++)
            out.push(activeInst.strings.labels[i] + "=" + activeInst.strings.names[n - 1 - i]);
        return out.join(", ");
    }

    // One dropdown entry per staff, labeled with its part name.
    function buildStaffModel() {
        var m = [];
        if (!curScore) return m;
        try {
            var parts = curScore.parts;
            for (var pi = 0; pi < parts.length; pi++) {
                var part = parts[pi];
                var base = Math.floor(part.startTrack / 4);
                var nSt = Math.max(1, Math.round((part.endTrack - part.startTrack) / 4));
                var name = ("" + (part.partName || part.longName || "Staff")).trim();
                for (var si = 0; si < nSt; si++)
                    m.push({text: (base + si + 1) + ": " + name
                                  + (nSt > 1 ? " (staff " + (si + 1) + ")" : ""),
                            staff: base + si, partIndex: pi});
            }
        } catch (e) {}
        if (!m.length) {
            var n = 0;
            try { n = curScore.nstaves; } catch (e2) {}
            for (var s = 0; s < Math.max(1, n); s++)
                m.push({text: "Staff " + (s + 1), staff: s, partIndex: -1});
        }
        return m;
    }

    // -- ownership of plugin-written annotations ----------
    // Everything the plugin writes is recorded in a score meta tag
    // ("violinFingering": JSON {v: 2, items: [[tick, pitch, kind, text,
    // staff], ...]}, kind "f"=finger, "s"=string, "p"=position mark,
    // pitch -1 for staff text) and tinted with markerColor. On re-run,
    // annotations matching their registry entry are removed and
    // regenerated; a plugin-written text the user has edited no longer
    // matches and is promoted to a user constraint. Marker-colored
    // elements with no registry slot (registry lost or ticks shifted)
    // fall back to plugin-owned.
    // v2 keys include the staff so that two staves sharing tick and pitch
    // (quartet unisons) cannot consume each other's entries; v1 items
    // (no staff) are matched staff-blind until rewritten.
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
        var reg = {items: [], consumed: [], byKey: {}, byKind: {},
                   legacyByKey: {}, legacyByKind: {}};
        try {
            var raw = curScore.metaTag("violinFingering");
            if (raw) reg.items = JSON.parse(raw).items || [];
        } catch (e) { reg.items = []; }
        for (var i = 0; i < reg.items.length; i++) {
            var it = reg.items[i];
            if (it.length >= 5) {
                var key = it[4] + "|" + it[0] + "|" + it[1] + "|" + it[2] + "|" + it[3];
                if (!reg.byKey[key]) reg.byKey[key] = [];
                reg.byKey[key].push(i);
                reg.byKind[it[4] + "|" + it[0] + "|" + it[1] + "|" + it[2]] = true;
            } else {
                var lkey = it[0] + "|" + it[1] + "|" + it[2] + "|" + it[3];
                if (!reg.legacyByKey[lkey]) reg.legacyByKey[lkey] = [];
                reg.legacyByKey[lkey].push(i);
                reg.legacyByKind[it[0] + "|" + it[1] + "|" + it[2]] = true;
            }
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
        var idxs = reg.byKey[targetStaff + "|" + tick + "|" + pitch + "|" + kind + "|" + text]
                || reg.legacyByKey[tick + "|" + pitch + "|" + kind + "|" + text];
        if (idxs) {
            for (var i = 0; i < idxs.length; i++)
                if (!reg.consumed[idxs[i]]) { reg.consumed[idxs[i]] = true; return "plugin"; }
        }
        if (isMarkerColored(el)) {
            // registered slot with different text = user edited it
            if (reg.byKind[targetStaff + "|" + tick + "|" + pitch + "|" + kind]
                    || reg.legacyByKind[tick + "|" + pitch + "|" + kind]) {
                promotedEls.push(el);
                return "human";
            }
            return "plugin";
        }
        return "human";
    }

    // -- score scanning ----------------------------------
    function collectEvents() {
        // A range selection decides staff and tick window; otherwise the
        // dropdown's staff, whole.
        sel = readSelection();
        var staffIdx = effectiveStaff();
        var cursor = curScore.newCursor();
        cursor.rewind(Cursor.SELECTION_START);
        var endTick = -1;
        if (cursor.segment) {
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
                        if (!Core.isPositionMark(ptxt)) continue;
                        if (classifyAnnotation(registry, a, cursor.tick, -1, "p", ptxt) === "plugin")
                            pluginEls.push(a);
                    }
                }
                var el = cursor.element;
                if (el && el.type === Element.CHORD) {
                    if (keyByTick[cursor.tick] === undefined) {
                        try { keyByTick[cursor.tick] = cursor.keySignature; } catch (e0) {}
                    }
                    // Grace chords are real played notes: give each one a
                    // synthetic tick just before (grace-after: just after)
                    // the main note so it takes its place in the fingering
                    // chain. Offsets of a few ticks cannot collide with
                    // real onsets (the shortest duration is 15 ticks).
                    var graces = el.graceNotes;
                    var nGrace = graces ? graces.length : 0;
                    for (var gi = 0; gi < nGrace; gi++) {
                        var gch = graces[gi];
                        var after = false;
                        try {
                            after = gch.notes.length > 0
                                && gch.notes[0].noteType >= NoteType.GRACE8_AFTER;
                        } catch (e1) {}
                        var gt = after ? cursor.tick + 1 + gi
                                       : cursor.tick - (nGrace - gi);
                        if (keyByTick[gt] === undefined) keyByTick[gt] = keyByTick[cursor.tick];
                        for (var gn = 0; gn < gch.notes.length; gn++)
                            collectNote(byTick, gch.notes[gn], gt, true);
                    }
                    for (var i = 0; i < el.notes.length; i++)
                        collectNote(byTick, el.notes[i], cursor.tick, false);
                    var thumbPin = readChordThumb(el, cursor.tick);
                    if (thumbPin >= 0 && byTick[cursor.tick] && byTick[cursor.tick][thumbPin]
                            && byTick[cursor.tick][thumbPin].finger === null)
                        byTick[cursor.tick][thumbPin].finger = Core.THUMB;
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
                         key: keyByTick[ticks[ti]],
                         grace: pitches[0].grace || false});
        }
        return events;
    }

    // The thumb-position sign is an Articulation on the chord, not text on a
    // note. Returns the chord's thumb articulations ([] when none or when the
    // API does not expose them).
    function chordThumbs(chord) {
        var out = [];
        try {
            var arts = chord.articulations;
            for (var i = 0; i < arts.length; i++) {
                var nm = "";
                try { nm = arts[i].subtypeName(); } catch (e0) {}
                if (Core.isThumbArticulation(arts[i].symbol, nm)) out.push(arts[i]);
            }
        } catch (e) {}
        return out;
    }

    // Thumb marks of one chord, sorted: plugin-owned ones are queued for
    // removal; a hand-made one pins the chord's lowest note to the thumb
    // (the thumb stops the lowest string, fingers play above it) unless
    // "replace manual fingerings" is on. Returns the pitch to pin, or -1.
    function readChordThumb(chord, tick) {
        var pin = -1;
        if (!activeInst.hand.thumb) return pin;
        var thumbs = chordThumbs(chord);
        for (var i = 0; i < thumbs.length; i++) {
            var cls = classifyAnnotation(registry, thumbs[i], tick, Core.THUMB_PITCH,
                                         "f", Core.THUMB_KEY);
            if (cls === "plugin" || overwrite.checked) {
                pluginEls.push(thumbs[i]);
                continue;
            }
            var lowest = 1000;
            for (var n = 0; n < chord.notes.length; n++)
                if (chord.notes[n].pitch < lowest) lowest = chord.notes[n].pitch;
            pin = lowest;
        }
        return pin;
    }

    function collectNote(byTick, note, t, grace) {
        if (note.tieBack) return;
        var p = note.pitch;
        var ann = readAnnotations(note, t);
        if (!byTick[t]) byTick[t] = {};
        if (byTick[t][p]) {
            byTick[t][p].refs.push(note);
            if (byTick[t][p].string === null) byTick[t][p].string = ann.string;
            if (byTick[t][p].finger === null) byTick[t][p].finger = ann.finger;
            if (ann.harmonic) byTick[t][p].harmonic = true;
        } else {
            byTick[t][p] = {midi: p, string: ann.string, finger: ann.finger,
                            harmonic: ann.harmonic, refs: [note],
                            spell: spellOf(note), grace: !!grace};
        }
    }

    // Spelling from MuseScore's tonal pitch class: tpc 13-19 are naturals,
    // 20 and up the sharp side, 12 and down the flat side. Tells the solver
    // which finger a displaced note is written for (sharp = raised lower
    // finger, flat = lowered upper finger).
    function spellOf(note) {
        try {
            if (note.tpc >= 20) return 1;
            if (note.tpc <= 12) return -1;
        } catch (e) {}
        return 0;
    }

    function readAnnotations(note, tick) {
        // Existing finger and string annotations are honored as constraints.
        // - Plain digits 1-4 = finger number; a placement suffix
        //   ("2L", "3H", written by the L/H option or by hand) is accepted
        //   and the digit is the constraint
        // - Plain "0" on an open-string pitch (G3/D4/A4/E5) = open-string finger
        // - "0" combined with a 1-4 digit = harmonic notation (lightly touch
        //   at the node with the given finger). Marked harmonic, excluded
        //   from the fingering chain, original annotations preserved.
        // - Lone "0" on a non-open pitch = legacy harmonic marker (ignored)
        // Plugin-owned annotations (see classifyAnnotation) are queued for
        // removal instead and never become constraints.
        var out = {string: null, finger: null, harmonic: false};
        if (!note.elements) return out;
        var isOpenStringPitch = activeInst.strings.tuning.indexOf(note.pitch) >= 0;
        var plainDigits = [], humanEls = [];
        for (var i = 0; i < note.elements.length; i++) {
            var el = note.elements[i];
            if (el.type !== Element.FINGERING) continue;
            var txt = ("" + el.text).replace(/<[^>]*>/g, "").trim();
            var fnum = Core.fingerFromText(txt);          // a digit, or -1
            var isString = false;
            try {
                if (el.subStyle !== undefined && typeof Tid !== "undefined" &&
                    el.subStyle === Tid.STRING_NUMBER)
                    isString = true;
            } catch (e) {}
            var kind;
            var hl = !isString && /^[0-4][LH]+$/.test(txt);
            var snum = Core.stringFromLabel(txt);         // circled string number
            if (fnum >= 0) kind = isString ? "s" : "f";
            else if (hl) kind = "f";
            else if (snum > 0) kind = "s";
            else if (/^(I|II|III|IV)$/.test(txt)) kind = "s";    // legacy plugin string mark
            else continue;
            if (classifyAnnotation(registry, el, tick, note.pitch, kind, txt) === "plugin") {
                pluginEls.push(el);
                continue;
            }
            humanEls.push(el);
            if (snum > 0) {
                out.string = snum;
                continue;
            }
            if (fnum < 0 && !hl) continue;   // human Roman text: no constraint
            var v = fnum >= 0 ? fnum : parseInt(txt);
            if (kind === "s" && v >= 1 && v <= Core.maxStrings()) out.string = v;
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
        if (!curScore) { statusBody = "No score is open"; return; }
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
        curScore.setMetaTag("violinFingering", JSON.stringify({v: 2, items: items}));
        curScore.endCmd();
        statusBody = "Cleared " + removed + " plugin annotation" + (removed === 1 ? "" : "s")
            + (items.length ? " (" + items.length + " outside the selection kept)" : "");
    }

    // Adds the thumb-position sign (an Articulation) to the chord of `note`
    // and checks it took. Returns true on success; otherwise tells the user.
    function writeThumb(note, color) {
        try {
            var chord = note.parent;
            var before = chord.articulations.length;
            var art = newElement(Element.ARTICULATION);
            art.symbol = Core.THUMB_SYMID;
            art.color = color;
            chord.add(art);
            var arts = chord.articulations;
            var added = arts.length === before + 1;
            if (added) {
                var nm = "";
                try { nm = arts[arts.length - 1].subtypeName(); } catch (e0) {}
                added = Core.isThumbArticulation(arts[arts.length - 1].symbol, nm);
            }
            if (!added) throw "the sign was not added";
            return true;
        } catch (e) {
            thumbProblem = "" + e;
            return false;
        }
    }
    property string thumbProblem: ""

    // -- write fingering annotations ---------------------
    function writeAnnotations(events, result, key) {
        thumbProblem = "";
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
            var thumbWritten = false;
            // Write finger and string number for EACH note in the chord
            for (var j = 0; j < combo.length; j++) {
                var s = combo[j][0], k = combo[j][1];
                var pitchInfo = events[i].pitches[j];
                var noteRefs = pitchInfo.refs;
                var hadFinger = pitchInfo.finger !== null;
                var hadString = pitchInfo.string !== null;
                if (writeFingers.checked && !hadFinger) {
                    // open string finger = 0; with L/H on, "2L", "3H", ...
                    // Each note of a chord labels against its own position
                    // (a fingered tenth spans two).
                    var ftxt = "" + k;
                    if (writeHL.checked && k !== Core.THUMB) {
                        var evKey = events[i].key != null ? events[i].key : key;
                        ftxt = Core.hlLabel(s, k, combo[j][2], combo[j][4],
                                            evKey, activeInst);
                    }
                    if (k === Core.THUMB) {
                        // chord-level sign, once per chord
                        if (!thumbWritten && writeThumb(noteRefs[0], markerColor)) {
                            newItems.push([events[i].tick, Core.THUMB_PITCH, "f",
                                           Core.THUMB_KEY, targetStaff]);
                            thumbWritten = true;
                            nFing++;
                        }
                    } else {
                        var fing = newElement(Element.FINGERING);
                        fing.text = ftxt;
                        fing.color = markerColor;
                        noteRefs[0].add(fing);
                        newItems.push([events[i].tick, pitchInfo.midi, "f", ftxt, targetStaff]);
                        nFing++;
                    }
                }
                if (writeStrings.checked && !hadString) {
                    var stringNum = activeInst.strings.tuning.length - s;
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
                                     : activeInst.strings.labels[stringNum - 1];
                    sn.color = markerColor;
                    noteRefs[0].add(sn);
                    newItems.push([events[i].tick, pitchInfo.midi, "s", sn.text, targetStaff]);
                    nStr++;
                }
            }
            // position mark once per hand-position change; grace events
            // have synthetic ticks that don't exist as segments, so the
            // mark waits for the main note that carries the position
            if (writePositions.checked && handPos !== prevPos && !events[i].grace) {
                cursor.rewindToTick(events[i].tick);
                var stx = newElement(Element.STAFF_TEXT);
                stx.text = Core.ROMAN[handPos];
                stx.color = markerColor;
                cursor.add(stx);
                newItems.push([events[i].tick, -1, "p", stx.text, targetStaff]);
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
        curScore.setMetaTag("violinFingering", JSON.stringify({v: 2, items: items}));
        curScore.endCmd();
        return {fing: nFing, str: nStr, pos: nPos, skip: nSkip};
    }

    function apply() {
        // The radio selection is authoritative (readAnnotations checks
        // open-string pitches against its tuning).
        var events = collectEvents();
        if (events.length === 0) { statusBody = "No notes found"; return; }
        var key = readKeySignature();
        // Build chord events. Events with any harmonic note become segment
        // boundaries: solved independently from neighboring segments because
        // the hand may move freely to and from the node.
        var chordEvents = events.map(function (e) {
            var hasHarmonic = e.pitches.some(function (p) { return p.harmonic; });
            return {
                pitches: e.pitches.map(function (p) {
                    return {pitch: p.midi, string: p.string, finger: p.finger,
                            spell: p.spell || 0, harmonic: p.harmonic || false};
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
                        var segResult = Core.solveChords(seg, key, undefined, activeInst);
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
                    if (Core.candidatesForPitch(events[bi].pitches[bj].midi, key, undefined, activeInst).length === 0)
                        bad.push(noteName(events[bi].pitches[bj].midi) + " at tick " + events[bi].tick);
            statusBody = "ViolinFingering could not solve this staff (some notes outside "
                + activeInstrument + " range).\n"
                + (bad.length ? "Unplayable: " + bad.join(", ") + "\n" : "")
                + "Report issues at https://github.com/knoguchi/violin-fingering/issues";
            return;
        }
        var stats = writeAnnotations(events, result, key);
        statusBody = "Done: " + events.length + " notes, "
            + (key > 0 ? key + " sharps" : key < 0 ? (-key) + " flats" : "no accidentals") + "\n"
            + (thumbProblem ? "Thumb sign not written: " + thumbProblem + "\n" : "")
            + "Fingers " + stats.fing
            + (writeStrings.checked ? ", strings " + stats.str : "")
            + (writePositions.checked ? ", positions " + stats.pos : "");
    }

    // -- UI ----------------------------------------------
    ColumnLayout {
        anchors.fill: parent
        anchors.margins: 14
        spacing: 6
        Text {
            Layout.fillWidth: true
            wrapMode: Text.WordWrap
            font.bold: true
            color: writeFingers.palette.windowText
            text: plugin.targetSummary()
        }
        RowLayout {
            visible: !plugin.sel.has
            Layout.fillWidth: true
            Text {
                text: "Staff:"
                color: writeFingers.palette.windowText
            }
            ComboBox {
                id: staffSelect
                Layout.fillWidth: true
                model: staffModel
                textRole: "text"
                onActivated: plugin.refreshTarget()
            }
        }
        RowLayout {
            Layout.fillWidth: true
            Text {
                text: "Instrument:"
                Layout.alignment: Qt.AlignTop
                topPadding: 10        // lines up with the first row of radios
                color: writeFingers.palette.windowText
            }
            ButtonGroup { id: instrumentGroup }
            Flow {
                Layout.fillWidth: true
                spacing: 4
                Repeater {
                    model: plugin.instrumentNames
                    RadioButton {
                        ButtonGroup.group: instrumentGroup
                        text: Core.INSTRUMENTS[modelData].label
                        checked: plugin.activeInstrument === modelData
                        onClicked: plugin.setInstrument(modelData)
                    }
                }
            }
        }
        Text {
            visible: !!plugin.activeInst.experimental
            Layout.fillWidth: true
            wrapMode: Text.WordWrap
            color: "#d32f2f"
            font.bold: true
            text: plugin.activeInst.label + " is experimental"
        }
        CheckBox { id: writeFingers;   checked: true;  text: "Finger numbers" }
        CheckBox {
            id: writeHL; checked: false; enabled: activeInst.hand.hlEnabled
            text: "Finger placement (1L 2L 3H 4L)"
            ToolTip.visible: hovered; ToolTip.delay: 400
            ToolTip.text: "Suffix L/H where a finger is lower/higher than the 1-23-4 shape"
        }
        CheckBox { id: writePositions; checked: true;  text: "Positions (I, II, III...)" }
        CheckBox {
            id: writeStrings; checked: false
            text: "String numbers"
            ToolTip.visible: hovered; ToolTip.delay: 400
            ToolTip.text: stringKey()
        }
        CheckBox { id: colorize;       checked: true;  text: "Color new marks blue" }
        CheckBox {
            id: overwrite; checked: false
            text: "Replace my own fingerings"
            ToolTip.visible: hovered; ToolTip.delay: 400
            ToolTip.text: "Off: fingerings you wrote are kept and used as constraints"
        }
        RowLayout {
            Button {
                text: "Run"
                onClicked: {
                    statusBody = "Running...";
                    plugin.refreshTarget();
                    try { plugin.apply(); }
                    catch (e) { statusBody = "Exception while running: " + e + "\n" + (e.stack || "")
                        + "\nPlease report: https://github.com/knoguchi/violin-fingering/issues"; }
                }
            }
            Button {
                text: "Clear"
                onClicked: {
                    plugin.refreshTarget();
                    try { plugin.clearAnnotations(); }
                    catch (e) { statusBody = "Exception while clearing: " + e + "\n" + (e.stack || "")
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
                text: "v" + plugin.version + (plugin.statusBody ? "\n" + plugin.statusBody : "")
                wrapMode: TextEdit.Wrap
                readOnly: true
                selectByMouse: true
                color: writeFingers.palette.windowText
            }
        }
    }
}
