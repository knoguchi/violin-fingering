// Refactor guard: solveChords output for violin/viola must match the
// snapshot in golden.json (made by gen_golden.js before the per-instrument
// config refactor).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const core = require('./load_core.js');
const golden = require('./golden.json');

test('golden: violin/viola solveChords unchanged', function () {
    golden.forEach(function (c, i) {
        const res = core.solveChords(c.events, c.key, 7, c.inst);
        assert.deepStrictEqual(JSON.parse(JSON.stringify(res)), c.result,
            'case ' + i + ' ' + c.inst + ' key ' + c.key);
    });
});
