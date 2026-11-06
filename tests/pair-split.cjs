// Run with node tests/pair-split.cjs. No Stash instance is required.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'multiView-player.js'), 'utf8');
const storage = source.slice(source.indexOf('    function isPairSplit('),
    source.indexOf('    function applyWallLayout('));
const saved = new Map([['old', '{"1:3":10,"1:4":"35","5:6":68}']]);
const localStorage = {
    getItem: key => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, value),
    removeItem: key => saved.delete(key)
};
function tab() {
    const context = vm.createContext({ localStorage });
    vm.runInContext(`
        const LEGACY_PAIR_SPLITS_KEY = 'old', PAIR_SPLIT_PREFIX = 'split:';
        const PAIR_SPLIT_MIN = 20, PAIR_SPLIT_MAX = 80;
        const unsavedPairSplits = new Map();
        ${storage}
        migratePairSplits();
    `, context);
    return script => vm.runInContext(script, context);
}

const first = tab();
const second = tab();
assert.equal(first("getPairSplit(['1','3'])"), null);
assert.equal(first("getPairSplit(['1','4'])"), null);
assert.equal(first("getPairSplit(['5','6'])"), 68);
assert.equal(saved.has('old'), false);
first("storePairSplit(['10','2'], 67)");
second("storePairSplit(['3','4'], 74)");
assert.equal(tab()("getPairSplit(['10','2'])"), 67, 'another tab cannot overwrite a different pair');
assert.equal(first("getPairSplit(['2','10'])"), 33);
assert.equal(first("getPairSplit(['3','4'])"), 74);
assert.equal(first("getPairSplit(['10','3'])"), null);
assert.equal(first("getPairSplit(['10','2','3'])"), null);
second("storePairSplit(['2','10'], null)");
assert.equal(first("getPairSplit(['10','2'])"), null);
assert.equal(first("getPairSplit(['3','4'])"), 74);
console.log('Pair splits migrate, persist across tabs, follow swapped videos, and reset independently');
