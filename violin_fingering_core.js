.pragma library
// violin_fingering_core.js - violin fingering core (pure JS, MuseScore-independent)
// Copyright (C) 2026 Kenji Noguchi <tokyo246@gmail.com> - GPL-3.0
//
// State = (string, finger, position, accidental_offset).
// The fingering for a given key signature is fixed: in each (string,
// position), the four fingers play four consecutive scale tones. An
// accidental displaces the finger by +/-1 semitone from its key position.

// Everything instrument-specific lives in INSTRUMENTS. Each instrument has
//   strings: what it is   - tuning, names, labels
//   hand:    left-hand geometry - frame model, finger offsets, positions
//   cost:    weights the solver minimises
// "experimental: true" instruments are hidden in the dialog unless the
// experimental option is on.
// Functions take an instrument (name or config object) as their trailing
// argument; omitted means violin.

// Cost weights shared by instruments that do not override them. These are
// the violin's; viola is the same hand a fifth lower, so it uses them as is.
var DEFAULT_COST = {
    // Position shifts: fixed + per position of distance.
    posShift: 3.0,
    posFixed: 2.5,
    // Shifting while an open string sounds hides the slide.
    openShiftDiscount: 0.5,
    // Bow crossing by string distance: staying, adjacent, skip one, skip
    // two. Adjacent crossings are nearly free; skipping over strings is a
    // real bow maneuver and must cost more than linearly.
    cross: [0.0, 0.5, 2.5, 5.0],
    // Same finger jumping to another string must lift and replace (gap/
    // smear risk), comparable to a small shift. Exception: a perfect fifth
    // on adjacent strings is a one-finger barre.
    sameFingerCross: 1.5,
    barre: 0.1,
    // Same finger sliding a semitone on the same string (audible slide or
    // lift-replace). Must cost more than switching to the adjacent finger.
    semitoneSlide: 0.5,
    // Same-string finger move reaching beyond the hand frame
    // (stretchPerFinger semitones per finger step), per excess semitone.
    stretch: 0.4,
    stretchPerFinger: 2,
    // Open strings cannot be vibrated and stick out in timbre - but not
    // equally: the open E glares in any lyric line, while the open G often
    // has no alternative and its growl is usually welcome. A fingered note
    // is preferred when reachable; the open still wins when it saves a
    // shift or more than one crossing. Indexed by string, low to high.
    open: [0.25, 0.3, 0.4, 0.65],
    // Displacing a finger from its key frame. True accidentals pay this on
    // every candidate equally; it mainly discourages a displaced finger
    // when the in-frame finger for the same pitch is available.
    accidental: 0.6,
    // A displaced finger should honor the spelling: a sharp is a raised
    // lower finger, a flat a lowered upper finger. Tie-breaker only.
    spell: 0.05,
    // Per-position cost, indexed by position. Deliberately not linear:
    // I and III are home, V is common, II and IV are visited on purpose,
    // VI and up are thin air. The differences stay small (a couple of
    // these per note must never outweigh one shift) so they act on ties,
    // not on structure. Positions past the end extrapolate by posCostSlope.
    posCost: [0, 0, 0.15, 0.06, 0.11, 0.10, 0.20, 0.16],
    posCostSlope: 0.1,
    // High positions get harder the lower the string: the arm has to reach
    // around the instrument's shoulder. Per position step, per string
    // below the top one.
    altLowString: 0.03,
    // Position spread across the fingered strings of one chord.
    posSpread: 0.5,
    // Position span across the fingered notes of one event: triple and
    // quadruple stops need a compact hand; a double stop may spread one
    // position further (fingered tenths), paying the span cost.
    chordPosSpan: 1,
    chordPosSpanPair: 2,
    // Per-finger cost (index = finger - 1) and a surcharge per position
    // step beyond highPosStart. Zero for violin/viola; cello leans on
    // fingers 1 and 2 as the hand goes up the neck.
    fingerCost: [0, 0, 0, 0],
    fingerHighPos: [0, 0, 0, 0],
    highPosStart: 0,
    // Departing from the instrument's key map (cello only; see CELLO_KEY_MAP).
    keyMap: 0
};

function withDefaults(over) {
    var cost = {};
    for (var k in DEFAULT_COST) cost[k] = DEFAULT_COST[k];
    for (var k2 in over) cost[k2] = over[k2];
    return cost;
}

// Cello key map: per key signature and mode (maj / min = melodic minor), the zero-cost
// (string index, finger) of each scale tone, taken from a cellist's two-octave scale
// fingerings. Departing from it costs cost.keyMap, the way an accidental costs on the
// violin. Strings are indexed low to high (0 = C). Which mode applies is read from the
// notes (see keyModes).
var CELLO_KEY_MAP = {
    "-4": {
        maj: {
            44: [[1,1]], 46: [[1,3]], 48: [[1,1]], 49: [[1,2]], 51: [[1,4]], 53: [[2,1]],
            55: [[2,3]], 56: [[2,4]], 58: [[3,1]], 60: [[3,3]], 61: [[3,2]], 63: [[3,4]],
            65: [[3,1]], 67: [[3,3]], 68: [[3,4]]
        }
    },
    "-3": {
        maj: {
            39: [[0,2]], 41: [[0,4]], 43: [[1,0]], 44: [[1,1]], 46: [[1,2]], 48: [[1,4]],
            50: [[2,0]], 51: [[2,1]], 53: [[2,2]], 55: [[2,1]], 56: [[2,2]], 58: [[2,4]],
            60: [[3,1]], 62: [[3,3]], 63: [[3,4]]
        },
        min: {
            36: [[0,0]], 38: [[0,1]], 39: [[0,2]], 41: [[0,4]], 43: [[1,0]], 45: [[1,1]],
            47: [[1,3]], 48: [[1,4]], 50: [[2,0]], 51: [[2,1]], 53: [[2,2]], 55: [[2,4]],
            57: [[3,0]], 59: [[3,1]], 60: [[3,2]]
        }
    },
    "-2": {
        maj: {
            46: [[1,2]], 48: [[1,4]], 50: [[2,0]], 51: [[2,1]], 53: [[2,2]], 55: [[2,4]],
            57: [[3,0]], 58: [[3,1]], 60: [[3,2]], 62: [[3,1]], 63: [[3,2]], 65: [[3,4]],
            67: [[3,1]], 69: [[3,2]], 70: [[3,3]]
        },
        min: {
            43: [[1,0]], 45: [[1,1]], 46: [[1,2]], 48: [[1,4]], 50: [[2,0]], 52: [[2,1]],
            54: [[2,3]], 55: [[2,4]], 57: [[3,0]], 58: [[3,1]], 60: [[3,2]], 62: [[3,4]],
            64: [[3,1]], 66: [[3,3]], 67: [[3,4]]
        }
    },
    "-1": {
        maj: {
            41: [[0,4]], 43: [[1,0]], 45: [[1,1]], 46: [[1,2]], 48: [[1,4]], 50: [[2,0]],
            52: [[2,1]], 53: [[2,2]], 55: [[2,4]], 57: [[3,0]], 58: [[3,1]], 60: [[3,2]],
            62: [[3,1]], 64: [[3,3]], 65: [[3,4]]
        },
        min: {
            38: [[0,1]], 40: [[0,3]], 41: [[0,4]], 43: [[1,0]], 45: [[1,1]], 47: [[1,2]],
            49: [[1,4]], 50: [[2,0]], 52: [[2,1]], 53: [[2,2]], 55: [[2,4]], 57: [[3,0]],
            59: [[3,1]], 61: [[3,3]], 62: [[3,4]], 64: [[3,2]]
        }
    },
    "0": {
        maj: {
            36: [[0,0]], 38: [[0,1]], 40: [[0,3]], 41: [[0,4]], 43: [[1,0]], 45: [[1,1]],
            47: [[1,3]], 48: [[1,4]], 50: [[2,0]], 52: [[2,1]], 53: [[2,2]], 55: [[2,4]],
            57: [[3,0]], 59: [[3,1]], 60: [[3,2]]
        },
        min: {
            45: [[1,1]], 47: [[1,3]], 48: [[1,4]], 50: [[2,0]], 52: [[2,1]], 54: [[2,2]],
            56: [[2,4]], 57: [[3,0]], 59: [[3,1]], 60: [[3,2]], 62: [[3,1]], 64: [[3,3]],
            66: [[3,1]], 68: [[3,2]], 69: [[3,3]]
        }
    },
    "1": {
        maj: {
            43: [[1,0]], 45: [[1,1]], 47: [[1,3]], 48: [[1,4]], 50: [[2,0]], 52: [[2,1]],
            54: [[2,3]], 55: [[2,4]], 57: [[3,0]], 59: [[3,1]], 60: [[3,2]], 62: [[3,4]],
            64: [[3,1]], 66: [[3,3]], 67: [[3,4]]
        },
        min: {
            40: [[0,2]], 42: [[0,4]], 43: [[1,0]], 45: [[1,1]], 47: [[1,2]], 49: [[1,4]],
            51: [[2,1]], 52: [[2,2]], 54: [[2,4]], 55: [[2,1]], 57: [[2,2]], 59: [[2,4]],
            61: [[3,1]], 63: [[3,3]], 64: [[3,4]]
        }
    },
    "2": {
        maj: {
            38: [[0,1]], 40: [[0,2]], 42: [[0,4]], 43: [[1,0]], 45: [[1,1]], 47: [[1,2]],
            49: [[1,4]], 50: [[2,0]], 52: [[2,1]], 54: [[2,3]], 55: [[2,4]], 57: [[3,0]],
            59: [[3,1]], 61: [[3,3]], 62: [[3,4]]
        },
        min: {
            47: [[1,1]], 49: [[1,4]], 50: [[2,0]], 52: [[2,1]], 54: [[2,2]], 56: [[2,4]],
            58: [[3,1]], 59: [[3,2]], 61: [[3,4]], 62: [[3,1]], 64: [[3,2]], 66: [[3,4]],
            68: [[3,1]], 70: [[3,3]], 71: [[3,4]]
        }
    },
    "3": {
        maj: {
            45: [[1,1]], 47: [[1,2]], 49: [[1,4]], 50: [[2,0]], 52: [[2,1]], 54: [[2,2]],
            56: [[2,4]], 57: [[3,0]], 59: [[3,1]], 61: [[3,3]], 62: [[3,1]], 64: [[3,3]],
            66: [[3,1]], 68: [[3,2]], 69: [[3,3]]
        },
        min: {
            42: [[0,2]], 44: [[0,4]], 45: [[1,1]], 47: [[1,2]], 49: [[1,4]], 51: [[2,1]],
            53: [[2,3]], 54: [[2,4]], 56: [[2,1]], 57: [[2,2]], 59: [[2,4]], 61: [[3,1]],
            63: [[3,3]], 65: [[3,3]], 66: [[3,4]]
        }
    },
    "4": {
        maj: {
            40: [[0,1]], 42: [[0,2]], 44: [[0,4]], 45: [[1,1]], 47: [[1,2]], 49: [[1,4]],
            51: [[2,1]], 52: [[2,2]], 54: [[2,4]], 56: [[2,1]], 57: [[2,2]], 59: [[2,4]],
            61: [[3,1]], 63: [[3,3]], 64: [[3,4]]
        }
    },
    "5": {
        maj: {
            47: [[1,2]], 49: [[1,4]], 51: [[2,1]], 52: [[2,2]], 54: [[2,4]], 56: [[2,1]],
            58: [[2,3]], 59: [[2,4]], 61: [[3,1]], 63: [[3,3]], 64: [[3,1]], 66: [[3,3]],
            68: [[3,1]], 70: [[3,2]], 71: [[3,3]]
        }
    },
    "6": {
        maj: {
            42: [[0,2]], 44: [[0,4]], 46: [[1,1]], 47: [[1,2]], 49: [[1,4]], 51: [[2,1]],
            53: [[2,3]], 54: [[2,4]], 56: [[2,1]], 58: [[2,3]], 59: [[3,1]], 61: [[3,3]],
            63: [[3,1]], 65: [[3,3]], 66: [[3,4]]
        }
    }
};

var INSTRUMENTS = {
    violin: {
        name: "violin",
        label: "Violin",
        detect: /violin/i,
        strings: {
            tuning: [55, 62, 69, 76],          // G3 D4 A4 E5 (low to high)
            names: ["G", "D", "A", "E"],
            // Circled string numbers, index = string number - 1 (1 = highest).
            labels: ["①", "②", "③", "④"]
        },
        hand: {
            frameModel: "diatonic",
            // Semitone offsets of fingers 1-4 for the 1-23-4 hand shape, and
            // the first-position anchor above the open string (L/H labels).
            frameOffsets: [0, 2, 3, 5],
            frameAnchor: 2,
            hlEnabled: true,
            minPosition: 1,
            maxPosition: 7
        },
        cost: DEFAULT_COST
    },
    viola: {
        name: "viola",
        label: "Viola",
        detect: /viola/i,
        strings: {
            tuning: [48, 55, 62, 69],          // C3 G3 D4 A4
            names: ["C", "G", "D", "A"],
            labels: ["①", "②", "③", "④"]
        },
        hand: {
            frameModel: "diatonic",
            frameOffsets: [0, 2, 3, 5],
            frameAnchor: 2,
            hlEnabled: true,
            minPosition: 1,
            maxPosition: 7
        },
        cost: DEFAULT_COST
    },
    // Cello: chromatic hand frame - the four fingers of a position sit on
    // consecutive semitones, so key signature and accidental displacement play
    // no role (a position is a semitone step, not a scale step). Starting
    // weights, to be tuned against real cello fingerings.
    cello: {
        name: "cello",
        label: "Cello",
        experimental: true,
        detect: /cello/i,
        strings: {
            tuning: [36, 43, 50, 57],          // C2 G2 D3 A3
            names: ["C", "G", "D", "A"],
            labels: ["①", "②", "③", "④"]
        },
        keyMap: CELLO_KEY_MAP,
        hand: {
            frameModel: "chromatic",
            frameOffsets: [0, 1, 2, 3],
            // Open hand (extension): finger 1 stays, a whole tone to finger 2, then
            // semitones. Reachable only where the key map lists such a finger.
            openOffsets: [0, 2, 3, 4],
            frameAnchor: 2,
            hlEnabled: false,
            minPosition: 0,         // half position: finger 1 a semitone above the open string
            maxPosition: 30,        // E6 with finger 1; the cost of high positions keeps it rare
            // Thumb (finger 5, the thumb-position sign): a fifth hand slot
            // lying across the strings, offset semitones from finger 1 of the
            // same position, usable from minPosition up. A special case, not a
            // regular finger: the solver first fingers without it, and only
            // where the cost, averaged over +/- `window` events, exceeds
            // `threshold` may the thumb compete (a hand-placed sign always
            // counts). Placeholder values, to be tuned.
            thumb: {offset: -2, minPosition: 12, window: 6, threshold: 2.5}
        },
        cost: withDefaults({
                // One position step is a semitone: shifts are cheaper per step, the
                // hand frame is exactly one semitone per finger, chords may spread
                // over more steps.
                posShift: 1.0,
                posFixed: 2.0,
                stretchPerFinger: 1,
                // Open strings are idiomatic on the cello (Bach's G major
                // prelude arpeggiates them), so they cost little: with the
                // violin-like values it fingered bar 1 in V instead of
                // G D open, B 1, A open in I.
                open: [0.08, 0.1, 0.15, 0.22],
                posCost: [0, 0, 0.08, 0.08, 0.06, 0.06, 0.1, 0.1, 0.12, 0.14, 0.16, 0.18, 0.2],
                posCostSlope: 0.08,
                altLowString: 0.015,
                posSpread: 0.25,
                chordPosSpan: 2,
                chordPosSpanPair: 4,
                // Cost of departing from the cello key map (CELLO_KEY_MAP).
                keyMap: 0.6,
                // Fourth finger is rarely used in the lower positions and almost
                // never up the neck; third thins out too (1/2 dominate high up).
                // The 5th entry is the thumb (see hand.thumb for when it
                // may compete at all).
                fingerCost: [0, 0, 0.5, 1.0, 0.5],
                fingerHighPos: [0, 0, 0.1, 0.3, 0],
                highPosStart: 9
        })
    },
    // Five-string violin (C G D A E): the violin hand on a viola-plus-E
    // tuning. Never auto-detected from the part; pick it with the radio.
    violin5: {
        name: "violin5",
        label: "5-string violin",
        experimental: true,
        detect: null,
        strings: {
            tuning: [48, 55, 62, 69, 76],      // C3 G3 D4 A4 E5
            names: ["C", "G", "D", "A", "E"],
            labels: ["①", "②", "③", "④", "⑤"]
        },
        hand: {
            frameModel: "diatonic",
            frameOffsets: [0, 2, 3, 5],
            frameAnchor: 2,
            hlEnabled: true,
            minPosition: 1,
            maxPosition: 7
        },
        // Starting values: the low C is as forgiving as the viola's.
        cost: withDefaults({
            open: [0.25, 0.3, 0.4, 0.5, 0.65]
        })
    }
};

// Accepts an instrument name or a config object; anything else means violin.
function resolveInst(x) {
    if (typeof x === "string") return INSTRUMENTS[x] || INSTRUMENTS.violin;
    return x || INSTRUMENTS.violin;
}

// Instrument for a part's id string (MuseScore instrumentId / musicXmlId),
// or "" when unrecognized.
function detectInstrument(id) {
    for (var n in INSTRUMENTS)
        if (INSTRUMENTS[n].detect && INSTRUMENTS[n].detect.test(id || "")) return n;
    return "";
}

// Position labels, indexed by position. "\u00bd" is ½: half position (cello).
var ROMAN = ["\u00bd", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X",
             "XI", "XII", "XIII", "XIV", "XV", "XVI", "XVII", "XVIII", "XIX", "XX"];

// Scale tones (pitch classes) of a key; key = signature count, + sharps / - flats.
function keyScale(key) {
    var SHARP_ORDER = [6, 1, 8, 3, 10, 5, 0];   // F# C# G# D# A# E# B# (mod 12)
    var FLAT_ORDER  = [10, 3, 8, 1, 6, 11, 4];  // Bb Eb Ab Db Gb Cb Fb
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

// Finger 5 is the thumb (cello). MuseScore stores the thumb-position sign
// as an Articulation on the chord (not a Fingering on a note): SMuFL symbol
// stringsThumbPosition, plugin-API SymId 2673 in MuseScore 4.7 (subtype
// name "Thumb position"). The id is matched together with the name, since
// the numeric SymId can shift between MuseScore versions.
var THUMB = 5;
var THUMB_SYMID = 2673;
var THUMB_SUBTYPE_NAME = "Thumb position";
// Registry key of a plugin-written thumb mark (it is chord-level, so its
// "pitch" slot holds THUMB_PITCH).
var THUMB_KEY = "T";
var THUMB_PITCH = -2;

function isThumbArticulation(symbol, subtypeName) {
    return symbol === THUMB_SYMID || subtypeName === THUMB_SUBTYPE_NAME;
}

// Offset of a candidate's finger in its own hand shape (closed or open).
function shapeOffset(inst, c) {
    return c[7] ? inst.hand.openOffsets[c[1] - 1] : inst.hand.frameOffsets[c[1] - 1];
}

// Semitone offset of a finger within the hand frame (thumb included).
function handOffset(inst, finger) {
    return finger === THUMB ? inst.hand.thumb.offset : inst.hand.frameOffsets[finger - 1];
}

// --- annotation vocabulary -----------------------------
// What the plugin writes and has to recognise again (Clear, re-run,
// manual constraints). Derived from the config so a new instrument or
// position can't be missed.

// Finger number of a fingering text ("3" -> 3, markup ignored), or -1.
// The thumb is not a text: see isThumbArticulation.
function fingerFromText(raw) {
    var txt = ("" + raw).replace(/<[^>]*>/g, "").trim();
    return /^[0-9]$/.test(txt) ? parseInt(txt, 10) : -1;
}

// String number of a circled mark ("③" -> 3), or 0 if it is not one.
function stringFromLabel(txt) {
    for (var n in INSTRUMENTS) {
        var i = INSTRUMENTS[n].strings.labels.indexOf(txt);
        if (i >= 0) return i + 1;
    }
    return 0;
}

// Largest string count of any instrument (bound for string-number marks).
function maxStrings() {
    var m = 0;
    for (var n in INSTRUMENTS)
        m = Math.max(m, INSTRUMENTS[n].strings.tuning.length);
    return m;
}

// True for a position mark the plugin writes ("\u00bd", "I" ... "XX").
function isPositionMark(txt) {
    return ROMAN.indexOf(txt) >= 0;
}

function fingerPitch(stringIdx, position, finger, key, instrument) {
    var inst = resolveInst(instrument);
    var open = inst.strings.tuning[stringIdx];
    if (inst.hand.frameModel === "chromatic")
        return open + 1 + position + (finger === THUMB
            ? inst.hand.thumb.offset : inst.hand.frameOffsets[finger - 1]);
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

// --- L/H placement indicators (issue #4) -------------
// Labels describe where a finger lands, not which note it plays: the
// same finger number covers two spots a semitone apart, and beginner
// method books mark the less usual one (2 vs 2L, 3 vs 3H, 1 vs 1L).
// The unlabeled hand shape is 1-23-4 (first position on the A string:
// B C# D E), i.e. semitone offsets 0, 2, 3, 5 from the first finger.
// Pure post-processing of a solved (string, finger, position, pitch):
// the solver never sees these labels.

// Where the first finger of the unlabeled shape sits. First position is
// anchored to the nut (a whole tone above the open string) regardless
// of key, which is what makes F natural on the E string "1L" even in C
// major. Higher positions are named after where the hand is placed, so
// they take the solver's key frame.
function hlFrameBase(stringIdx, position, key, instrument) {
    var inst = resolveInst(instrument);
    if (position === 1) return inst.strings.tuning[stringIdx] + inst.hand.frameAnchor;
    return fingerPitch(stringIdx, position, 1, key, inst);
}

// Finger label with placement suffix: "0" for an open string, otherwise
// the finger digit followed by L (lower) or H (higher) per semitone of
// deviation from the unlabeled spot. Deviations of two semitones are
// rare (only reachable through unusual candidates) and are written
// doubled ("2LL") rather than hidden.
function hlLabel(stringIdx, finger, position, pitch, key, instrument) {
    var inst = resolveInst(instrument);
    if (finger === 0) return "0";
    if (finger === THUMB) return THUMB_KEY;
    var d = pitch - (hlFrameBase(stringIdx, position, key, inst)
                     + inst.hand.frameOffsets[finger - 1]);
    var suffix = "";
    for (var i = 0; i < Math.abs(d); i++) suffix += d < 0 ? "L" : "H";
    return "" + finger + suffix;
}

function candidatesForPitch(pitch, key, maxPosition, instrument) {
    var inst = resolveInst(instrument);
    if (maxPosition === undefined) maxPosition = inst.hand.maxPosition;
    var tun = inst.strings.tuning;
    var out = [];
    for (var s = 0; s < tun.length; s++) {
        if (pitch === tun[s]) { out.push([s, 0, 1, 0, pitch]); continue; }
        if (pitch < tun[s]) continue;
        for (var p = inst.hand.minPosition; p <= maxPosition; p++) {
            for (var k = 1; k <= (inst.hand.thumb ? THUMB : 4); k++) {
                if (k === THUMB && p < inst.hand.thumb.minPosition) continue;
                var nominal = fingerPitch(s, p, k, key, inst);
                var off = pitch - nominal;
                if (off === 0) out.push([s, k, p, 0, pitch]);
                else if (inst.hand.frameModel !== "chromatic" && (off === 1 || off === -1))
                    out.push([s, k, p, off, pitch]);
            }
        }
    }
    return out;
}

function posCost(inst, p) {
    var pc = inst.cost.posCost;
    return p < pc.length ? pc[p]
         : pc[pc.length - 1] + inst.cost.posCostSlope * (p - pc.length + 1);
}

// --- chord-aware (multi-note per event) ---------------

// Mode (maj / min = melodic minor) at each event, read from the notes around it: a melodic
// minor has the raised seventh of the relative minor, a pitch class outside the major scale.
// Local on purpose: a major piece that visits its relative minor for a bar is still major
// elsewhere. KEY_MODE_WINDOW is how many events each side to look at.
var KEY_MODE_WINDOW = 8;
function keyModes(events, key) {
    var modes = [];
    for (var i = 0; i < events.length; i++) {
        var k = events[i].key != null ? events[i].key : key;
        var raised7 = ((((k * 7) % 12) + 12) % 12 + 8) % 12;   // relative minor's raised 7th
        var minor = false;
        for (var j = Math.max(0, i - KEY_MODE_WINDOW); j <= Math.min(events.length - 1, i + KEY_MODE_WINDOW) && !minor; j++)
            for (var q = 0; q < events[j].pitches.length; q++)
                if (events[j].pitches[q].pitch % 12 === raised7) { minor = true; break; }
        modes.push(minor ? "min" : "maj");
    }
    return modes;
}

// 1 when the instrument has a key map entry for this pitch and the candidate
// (string, finger) is not among its choices; 0 otherwise.
function keyMapMiss(km, cand) {
    var opts = km && km[cand[4]];
    if (!opts) return 0;
    for (var i = 0; i < opts.length; i++)
        if (opts[i][0] === cand[0] && opts[i][1] === cand[1]) return 0;
    return 1;
}

// The instrument's key map for a signature and mode ("min" or anything else = major).
function keyMapFor(inst, key, mode) {
    var slot = inst.keyMap && inst.keyMap[key];
    return slot ? slot[mode === "min" ? "min" : "maj"] : null;
}

// The key map may name an open-hand finger (index 7 = 1) that the closed hand
// cannot play at that pitch; make it a candidate at the position it implies.
function addKeyMapCandidates(cs, pitch, km, maxPosition, inst) {
    var opts = km && km[pitch];
    if (!opts || !inst.hand.openOffsets) return;
    var tun = inst.strings.tuning;
    for (var i = 0; i < opts.length; i++) {
        var s = opts[i][0], f = opts[i][1], have = false;
        if (f < 2 || f > 4) continue;
        var p = pitch - tun[s] - 1 - inst.hand.openOffsets[f - 1];
        for (var j = 0; j < cs.length; j++)
            if (cs[j][0] === s && cs[j][1] === f && cs[j][2] === p) { have = true; break; }
        if (!have && p >= inst.hand.minPosition && p <= maxPosition)
            cs.push([s, f, p, 0, pitch, 0, 0, 1]);
    }
}

function candidatesForEvent(notes, key, maxPosition, instrument, mode) {
    var inst = resolveInst(instrument);
    if (maxPosition === undefined) maxPosition = inst.hand.maxPosition;
    var perNote = [];
    for (var i = 0; i < notes.length; i++) {
        var cs = candidatesForPitch(notes[i].pitch, key, maxPosition, inst);
        addKeyMapCandidates(cs, notes[i].pitch, keyMapFor(inst, key, mode), maxPosition, inst);
        if (notes[i].string != null) {
            var ms = inst.strings.tuning.length - notes[i].string;
            cs = cs.filter(function (c) { return c[0] === ms; });
        }
        if (notes[i].finger != null) {
            var fg = notes[i].finger;
            cs = cs.filter(function (c) { return c[1] === fg; });
        }
        if (!cs.length) return [];
        // Mark candidates whose displacement direction contradicts the
        // note's spelling (+1 sharp side, -1 flat side, 0/absent unknown).
        var sp = notes[i].spell;
        var km = keyMapFor(inst, key, mode);
        cs = cs.map(function (c) {
            var d = c.slice();
            d[5] = (sp && d[3] !== 0 && d[3] !== sp) ? 1 : 0;
            if (km) d[6] = keyMapMiss(km, d);
            return d;
        });
        perNote.push(cs);
    }
    var out = [];
    var posSpan = notes.length >= 3 ? inst.cost.chordPosSpan : inst.cost.chordPosSpanPair;
    function recurse(idx, picked, usedStrings, fingeredPositions) {
        if (idx === notes.length) {
            // Simultaneous notes must sit on contiguous strings: a double
            // stop with a silent string in the middle cannot be bowed.
            if (picked.length >= 2) {
                var ss = [];
                for (var y = 0; y < picked.length; y++) ss.push(picked[y][0]);
                ss.sort();
                for (var y2 = 1; y2 < ss.length; y2++)
                    if (ss[y2] !== ss[y2 - 1] + 1) return;
            }
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
                if (mx - mn > posSpan) continue;
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

function chordLocalCost(entry, inst) {
    var top = inst.strings.tuning.length - 1;
    var combo = entry.combo;
    var c = 0.0;
    var positions = [];
    for (var i = 0; i < combo.length; i++) {
        var s = combo[i][0], k = combo[i][1], p = combo[i][2], off = combo[i][3];
        if (k === 0) c += inst.cost.open[s];
        if (off !== 0) c += inst.cost.accidental;
        if (combo[i][5]) c += inst.cost.spell;
        if (combo[i][6]) c += inst.cost.keyMap;
        if (k > 0) {
            positions.push(p);
            c += inst.cost.altLowString * Math.max(0, p - 1) * (top - s);
            c += inst.cost.fingerCost[k - 1]
                + inst.cost.fingerHighPos[k - 1] * Math.max(0, p - inst.cost.highPosStart);
        }
    }
    // Open-only events have no real hand placement; their pos is virtual.
    if (!entry.openOnly) c += posCost(inst, entry.pos);
    // Penalize position span across fingered strings (hand shape contortion).
    // Different fingers per se are not a cost; only the position spread is.
    if (positions.length >= 2) {
        var mn = positions[0], mx = positions[0];
        for (var z = 1; z < positions.length; z++) {
            if (positions[z] < mn) mn = positions[z];
            if (positions[z] > mx) mx = positions[z];
        }
        c += inst.cost.posSpread * (mx - mn);
    }
    return c;
}

function chordTransCost(prev, cur, instrument) {
    var inst = resolveInst(instrument);
    var tun = inst.strings.tuning;
    var nStr = tun.length;
    var c = 0.0;
    if (prev.pos !== cur.pos) {
        var shift = inst.cost.posFixed + inst.cost.posShift * Math.abs(prev.pos - cur.pos);
        if (prev.openOnly || cur.openOnly) shift *= inst.cost.openShiftDiscount;
        c += shift;
    }
    // Bow crossing: gap between the string ranges of the two events.
    var mn1 = nStr, mx1 = -1, mn2 = nStr, mx2 = -1;
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
    c += inst.cost.cross[Math.min(gap, inst.cost.cross.length - 1)];
    // Melodic finger continuity (single-note events only). Only within a
    // position: once the hand shifts, finger spacing and offsets are
    // relative to a new frame and the shift cost already covers the move.
    if (prev.combo.length === 1 && cur.combo.length === 1
            && prev.pos === cur.pos) {
        var a = prev.combo[0], b = cur.combo[0];
        if (a[1] > 0 && a[1] === b[1] && a[0] !== b[0]) {
            // Barre = same physical spot on adjacent strings (perfect fifth),
            // regardless of how the key frame labels the two notes.
            var barre = Math.abs(a[0] - b[0]) === 1
                && a[4] - tun[a[0]] === b[4] - tun[b[0]];
            c += barre ? inst.cost.barre : inst.cost.sameFingerCross;
        } else if (a[0] === b[0] && a[1] > 0 && b[1] > 0 && a[1] !== b[1]) {
            // Dropping/lifting to another finger in frame is free;
            // only reaching beyond the frame costs.
            // The thumb sits below finger 1 by its own frame offset, not
            // one finger step away.
            var reach = (a[1] === THUMB || b[1] === THUMB)
                ? Math.abs(handOffset(inst, a[1]) - handOffset(inst, b[1]))
                : (a[7] || b[7])
                    ? Math.abs(shapeOffset(inst, a) - shapeOffset(inst, b))
                    : inst.cost.stretchPerFinger * Math.abs(a[1] - b[1]);
            var stretch = Math.abs(a[4] - b[4]) - reach;
            if (stretch > 0) c += inst.cost.stretch * stretch;
        } else if (a[0] === b[0] && a[1] > 0 && a[1] === b[1] && a[3] !== b[3]) {
            c += inst.cost.semitoneSlide;
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
function solveChords(events, key, maxPosition, instrument) {
    var inst = resolveInst(instrument);
    if (!events.length) return [];
    var modes = inst.keyMap ? keyModes(events, key) : null;
    var out = [];
    var start = 0;
    for (var i = 1; i <= events.length; i++) {
        if (i < events.length && !eventHasPin(events[i])) continue;
        var seg = solveSegWithThumb(events.slice(start, i), key, maxPosition, inst, modes && modes.slice(start, i));
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

// Fingers a segment. Without a thumb in the instrument's config this is
// one Viterbi pass. With one: solve without the thumb, then, where the
// cost averaged over a window around an event exceeds hand.thumb.threshold,
// solve again letting the thumb compete there (and wherever a hand-placed
// sign pins it). The second pass can only lower the cost: every first-pass
// choice is still available to it.
function solveSegWithThumb(events, key, maxPosition, instrument, modes) {
    var inst = resolveInst(instrument);
    var th = inst.hand.thumb;
    if (!th) return solveChordSeg(events, key, maxPosition, inst, null, modes);
    var n = events.length;
    var allow = [];
    for (var i = 0; i < n; i++) allow.push(eventPinsThumb(events[i]));
    var first = solveChordSeg(events, key, maxPosition, inst, allow, modes);
    if (!first) return null;
    var per = pathEventCosts(first, inst);
    var any = false;
    var next = allow.slice();
    for (var e = 0; e < n; e++) {
        var sum = 0, cnt = 0;
        for (var k = Math.max(0, e - th.window); k <= Math.min(n - 1, e + th.window); k++) {
            sum += per[k]; cnt++;
        }
        if (sum / cnt > th.threshold) { next[e] = true; any = true; }
    }
    if (!any) return first;
    return solveChordSeg(events, key, maxPosition, inst, next, modes) || first;
}

function eventPinsThumb(e) {
    for (var i = 0; i < e.pitches.length; i++)
        if (e.pitches[i].finger === THUMB) return true;
    return false;
}

// Cost each event adds along a chosen path (its own plus the move into it).
function pathEventCosts(path, inst) {
    var out = [];
    for (var i = 0; i < path.length; i++)
        out.push(chordLocalCost(path[i], inst)
                 + (i ? chordTransCost(path[i - 1], path[i], inst) : 0));
    return out;
}

function noThumb(entry) {
    for (var i = 0; i < entry.combo.length; i++)
        if (entry.combo[i][1] === THUMB) return false;
    return true;
}

// allowThumb: per-event flags, or null for an instrument without a thumb.
function solveChordSeg(events, key, maxPosition, instrument, allowThumb, modes) {
    var inst = resolveInst(instrument);
    if (!events.length) return [];
    var layers = [];
    for (var i = 0; i < events.length; i++) {
        var evKey = events[i].key != null ? events[i].key : key;
        var combos = candidatesForEvent(events[i].pitches, evKey, maxPosition, inst, modes && modes[i]);
        if (allowThumb && !allowThumb[i]) combos = combos.filter(noThumb);
        if (!combos.length) return null;
        layers.push(combos);
    }
    var n = events.length;
    var cost = [layers[0].map(function (e) { return chordLocalCost(e, inst); })];
    var back = [layers[0].map(function () { return -1; })];
    for (var t = 1; t < n; t++) {
        var ct = [], bt = [];
        for (var j = 0; j < layers[t].length; j++) {
            var lc = chordLocalCost(layers[t][j], inst);
            var best = Infinity, bestK = -1;
            for (var k2 = 0; k2 < layers[t - 1].length; k2++) {
                var cand = cost[t - 1][k2]
                    + chordTransCost(layers[t - 1][k2], layers[t][j], inst)
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
