// Run with node tests/favorite-views.cjs. No live Stash instance is required.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'multiView-player.js'), 'utf8');
const functions = source.slice(source.indexOf('    function readViews()'),
    source.indexOf('    function setupViews()'));
const firstVideo = new EventTarget();
firstVideo.readyState = 1;
firstVideo.currentTime = 8;
const secondVideo = new EventTarget();
secondVideo.readyState = 0;
secondVideo.currentTime = 0;
const seeks = [];
const cells = [firstVideo, secondVideo].map((video, index) => ({
    dataset: { sceneId: String(index + 1) },
    isConnected: true,
    querySelector: () => video,
}));
const view = { name: 'Pair', scenes: ['1', '2'], sizes: [null, null], positions: [39, 70] };
let stored = JSON.stringify([view]);
const context = vm.createContext({
    AbortController,
    console,
    localStorage: { getItem: () => stored },
    document: { getElementById: () => ({ children: cells }) },
    mutateConfigQueue: async callback => callback([]),
    resyncFromCache: async () => {},
    refreshUndoButton() {},
    flushDeferredQueueSync() {},
    flushDeferredAdvances() {},
    effectivePlayhead: video => video.currentTime,
    getLoop: () => null,
    applyWheelSeek: (id, video, delta) => {
        seeks.push([id, delta]);
        video.currentTime += delta;
    },
});
vm.runInContext(`
    const VIEWS_KEY = 'views';
    let rouletteBusy = false, queueRemoval = null, queueResync = null;
    let resolvedRaw = '[]', paneSizes = [], viewSeekController = null;
    ${functions}
    globalThis.readViews = readViews;
    globalThis.restoreView = restoreView;
`, context);

(async () => {
    assert.equal(context.readViews().length, 1);
    stored = JSON.stringify([{ ...view, positions: [-1, 70] }]);
    assert.equal(context.readViews().length, 0);
    stored = JSON.stringify([{ ...view, positions: [39] }]);
    assert.equal(context.readViews().length, 0);
    const legacy = { ...view };
    delete legacy.positions;
    stored = JSON.stringify([legacy]);
    assert.equal(context.readViews().length, 1);

    await context.restoreView(view);
    assert.deepEqual(seeks, [['1', 31]]);
    secondVideo.dispatchEvent(new Event('loadedmetadata'));
    assert.deepEqual(seeks, [['1', 31], ['2', 70]]);

    secondVideo.currentTime = 0;
    await context.restoreView(view);
    await context.restoreView(legacy);
    const count = seeks.length;
    secondVideo.dispatchEvent(new Event('loadedmetadata'));
    assert.equal(seeks.length, count, 'a later load cancels the pending saved seek');
    console.log('Saved positions, delayed metadata, cancellation, legacy views and invalid positions passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
