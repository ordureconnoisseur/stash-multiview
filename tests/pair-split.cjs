// Run with node tests/pair-split.cjs. No Stash instance is required.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'multiView-player.js'), 'utf8');
const storage = source.slice(source.indexOf('    function isPairSplit('),
    source.indexOf('    function applyWallLayout('));
let saved = '{"1:3":10,"1:4":"35"}';
const context = vm.createContext({
    localStorage: {
        getItem: () => saved,
        setItem: (_key, value) => { saved = value; }
    }
});
vm.runInContext(`
    const PAIR_SPLITS_KEY = 'split';
    const PAIR_SPLIT_MIN = 20, PAIR_SPLIT_MAX = 80, PAIR_SPLIT_LIMIT = 100;
    ${storage}
    let pairSplits = readPairSplits();
`, context);
const run = script => vm.runInContext(script, context);

assert.equal(run("getPairSplit(['1','3'])"), null);
assert.equal(run("getPairSplit(['1','4'])"), null);
run("storePairSplit(['10','2'], 67)");
assert.equal(run("getPairSplit(['10','2'])"), 67);
assert.equal(run("getPairSplit(['2','10'])"), 33);
assert.equal(run("getPairSplit(['10','3'])"), null);
assert.equal(run("getPairSplit(['10','2','3'])"), null);
run('pairSplits = readPairSplits()');
assert.equal(run("getPairSplit(['2','10'])"), 33);
run("storePairSplit(['2','10'], null)");
assert.equal(run("getPairSplit(['10','2'])"), null);
assert.deepEqual(JSON.parse(saved), {});
console.log('Pair splits persist, follow the videos after a swap, and reset independently');
