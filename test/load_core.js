// Loads violin_fingering_core.js for Node tests. The core is written for
// the QML JS engine (".pragma library" directive on line 1); strip that
// line and evaluate the rest, exposing the internals under test.
'use strict';
const fs = require('fs');
const path = require('path');

const src = fs
    .readFileSync(path.join(__dirname, '..', 'violin_fingering_core.js'), 'utf8')
    .replace(/^\.pragma[^\n]*\n/, '');

module.exports = new Function(src + `
return {keyScale: keyScale, fingerPitch: fingerPitch,
        candidatesForPitch: candidatesForPitch,
        candidatesForEvent: candidatesForEvent, solveChords: solveChords,
        chordTransCost: chordTransCost, effortProfile: effortProfile,
        ROMAN: ROMAN, STRING_NAMES: STRING_NAMES, TUNING: TUNING};
`)();
