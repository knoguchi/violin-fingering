// Regenerates test/golden.json: solveChords snapshots for violin/viola.
// Run only to deliberately re-baseline; golden.test.js guards refactors.
'use strict';
const fs = require('fs');
const path = require('path');
const core = require('./load_core.js');

let seed = 12345;
function rnd(n) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; }

const CASES = [];
const tunings = {violin: core.TUNING, viola: core.VIOLA_TUNING};
for (const inst of Object.keys(tunings)) {
    const lo = tunings[inst][0];
    for (const key of [0, 2, -3, 4, -1]) {
        for (let r = 0; r < 6; r++) {
            const events = [];
            let p = lo + 7 + rnd(10);
            const n = 12 + rnd(10);
            for (let i = 0; i < n; i++) {
                p += rnd(7) - 3;
                if (p < lo + 1) p = lo + 1;
                if (p > lo + 24) p = lo + 24;
                const ev = {pitches: [{pitch: p}]};
                const m = rnd(10);
                if (m === 0) ev.pitches.push({pitch: p + 7});          // double stop
                if (m === 1) ev.pitches.push({pitch: p + 7}, {pitch: p + 14 - 2});
                if (m === 2) ev.pitches[0].spell = rnd(2) ? 1 : -1;
                if (m === 3 && i === 4) ev.pitches[0].finger = 1 + rnd(4);
                if (m === 4 && i === 6) ev.pitches[0].string = 1 + rnd(4);
                if (m === 5 && i === 8) ev.key = rnd(5) - 2;
                events.push(ev);
            }
            CASES.push({inst, key, events});
        }
    }
}
for (const c of CASES)
    c.result = core.solveChords(c.events, c.key, 7, tunings[c.inst]);
fs.writeFileSync(path.join(__dirname, 'golden.json'), JSON.stringify(CASES));
console.log(CASES.length, 'cases,', CASES.filter(c => c.result === null).length, 'unsolvable');
