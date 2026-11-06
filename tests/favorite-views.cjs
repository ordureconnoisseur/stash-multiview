// Run with node tests/favorite-views.cjs. No live Stash instance is required.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'multiView-player.js'), 'utf8');
const views = source.slice(source.indexOf('    function readViews()'),
    source.indexOf('    function setupViews()'));
const initialSource = source.slice(source.indexOf('            const baseSrc = pickStream(id);'),
    source.indexOf('            video.autoplay = true;'));
const keys = source.slice(source.indexOf('    function normalizeKey('),
    source.indexOf('    function keyLabel('));
const seekBinding = source.slice(source.indexOf('    function matchingSeekBinding('),
    source.indexOf('    // Fire the action'));
const view = { name: 'Pair', scenes: ['1', '2'], sizes: [null, null], positions: [39, 70] };
let stored = JSON.stringify([view]);
let videos = [];
let lateStarts = [];
const context = vm.createContext({
    console,
    localStorage: { getItem: () => stored },
    document: { getElementById: () => ({ children: [] }) },
    mutateConfigQueue: async callback => callback([]),
    refreshUndoButton() {},
    flushDeferredQueueSync() {},
    flushDeferredAdvances() {},
    removeRenderedCell() {},
    getLoop: () => null,
    getResumeTime: () => 130,
    pickStream: id => '/scene/' + id + '/stream',
    isTranscodeUrl: src => src.includes('.webm'),
    withStart: (src, time) => src + '?start=' + time,
    clearResumeTime() {},
    resyncFromCache: async () => {
        videos = ['1', '2'].map(id => {
            const video = new EventTarget();
            video.currentTime = 0;
            return video;
        });
        const starts = videos.map((video, i) => context.makeInitialSource(String(i + 1), video));
        starts[0]();
        lateStarts = starts.slice(1);
    },
});
vm.runInContext(`
    const VIEWS_KEY = 'views';
    let rouletteBusy = false, queueRemoval = null, queueResync = null;
    let resolvedRaw = '[]', paneSizes = [], favoritePositions = null;
    const scenes = { '1': {duration: 180}, '2': {duration: 180} };
    const PROGRESS_END_MARGIN = 10;
    const seekBases = new Map();
    const playerSettings = {fineModifier: 'shift', allCellsModifier: 'alt', keybinds: {}};
    const SEEK_ACTION_IDS = ['seekBack', 'seekForward'];
    ${views}
    ${keys}
    ${seekBinding}
    globalThis.makeInitialSource = (id, video) => {
        const isFilterBacked = false;
        ${initialSource}
        return applyInitialSrc;
    };
    globalThis.readViews = readViews;
    globalThis.restoreView = restoreView;
    globalThis.playerSettings = playerSettings;
    globalThis.matchingSeekBinding = matchingSeekBinding;
`, context);

(async () => {
    assert.equal(context.readViews().length, 1);
    for (const positions of [[-1, 70], [39], ['39', 70]]) {
        stored = JSON.stringify([{ ...view, positions }]);
        assert.equal(context.readViews().length, 0);
    }
    const legacy = { ...view };
    delete legacy.positions;
    stored = JSON.stringify([legacy]);
    assert.equal(context.readViews().length, 1);

    await context.restoreView(view);
    lateStarts.forEach(start => start());
    videos.forEach(video => video.dispatchEvent(new Event('loadedmetadata')));
    assert.deepEqual(videos.map(video => video.currentTime), [39, 70],
        'saved timestamps override remembered positions, including staggered cells');

    await context.restoreView(legacy);
    lateStarts.forEach(start => start());
    videos.forEach(video => video.dispatchEvent(new Event('loadedmetadata')));
    assert.deepEqual(videos.map(video => video.currentTime), [130, 130]);

    context.playerSettings.keybinds.seekBack = 'r';
    assert.equal(context.matchingSeekBinding({key: 'R', shiftKey: true}), 'r');
    context.playerSettings.keybinds.seekBack = 'Ctrl+j';
    assert.equal(context.matchingSeekBinding({key: 'j', ctrlKey: true}), 'Ctrl+j');
    assert.equal(context.matchingSeekBinding({key: 'J', ctrlKey: true, shiftKey: true}), 'Ctrl+j');
    assert.equal(context.matchingSeekBinding({key: 'j', ctrlKey: true, altKey: true}), 'Ctrl+j');
    assert.equal(context.matchingSeekBinding({key: 'j', altKey: true}), undefined);
    console.log('Favorite timestamps, staggered initialization, legacy views, validation and seek chords passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
