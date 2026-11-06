// Run with node tests/favorite-views.cjs. No live Stash instance is required.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'multiView-player.js'), 'utf8');
const views = source.slice(source.indexOf('    function readViews()'),
    source.indexOf('    function setupViews()'));
const sceneMeta = source.slice(source.indexOf('    async function fetchSceneMeta('),
    source.indexOf('    async function loadSceneMeta('));
const initialSource = source.slice(source.indexOf('            const baseSrc = pickStream(id);'),
    source.indexOf('            video.autoplay = true;'));
const keys = source.slice(source.indexOf('    function normalizeKey('),
    source.indexOf('    function keyLabel('));
const runBinding = source.slice(source.indexOf('    function runBinding('),
    source.indexOf('    let keybindCaptureActive'));
const merge = source.slice(source.indexOf('    function mergeKeybinds('),
    source.indexOf('    function loadPlayerSettings'));
const keyHandlerStart = source.indexOf("        document.addEventListener('keydown', e => {", source.indexOf('    async function init()'));
const keyHandler = source.slice(keyHandlerStart + "        document.addEventListener('keydown', ".length,
    source.indexOf("        // Mouse-button shortcuts.", keyHandlerStart)).trim().replace(/;$/, '').replace(/\)$/, '');
const defaults = source.match(/    const DEFAULT_KEYBINDS = .*;/)[0];
const seekBinding = source.slice(source.indexOf('    function matchingSeekBinding('),
    source.indexOf('    // Fire the action'));
const view = { name: 'Pair', scenes: ['1', '2'], sizes: [null, null], positions: [39, 70] };
let stored = JSON.stringify([view]);
const actions = [];
let videos = [];
let lateStarts = [];
let unavailable;
let transcodeId;
let liveQueue = [];
let writes = 0;
let restoredSplit;
const context = vm.createContext({
    console,
    recordAction: id => actions.push(id),
    localStorage: { getItem: () => stored },
    document: { getElementById: () => ({ children: [], open: false }) },
    fetch: async (_url, request) => {
        const { id } = JSON.parse(request.body).variables;
        return {
            ok: true,
            json: async () => ({ data: { findScene: {
                title: 'Fixture video',
                files: id === unavailable ? [] : [{ path: '/fixture.webm', duration: 180 }],
                sceneStreams: [],
            } } }),
        };
    },
    parseStreams: () => ({}),
    mutateConfigQueue: async callback => {
        const result = callback(liveQueue);
        if (result) writes++;
        return result;
    },
    refreshUndoButton() {},
    isPairSplit: value => Number.isInteger(value) && value >= 20 && value <= 80,
    storePairSplit: (_scenes, split) => { restoredSplit = split; },
    flushDeferredQueueSync() {},
    flushDeferredAdvances() {},
    removeRenderedCell() {},
    getLoop: () => null,
    getResumeTime: () => 130,
    pickStream: id => '/scene/' + id + (id === transcodeId ? '/stream.webm' : '/stream'),
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
    ${sceneMeta}
    ${views}
    ${keys}
    ${seekBinding}
    ${defaults}
    const KEYBIND_ACTIONS = ['seekBack', 'seekForward', 'saveFavorite', 'undoRoll', 'previousPane', 'previousBoth'].map(id => ({
        id, run: () => recordAction(id)
    }));
    const keybindCaptureActive = false;
    const isFineSeek = e => e.shiftKey;
    const isAllCellsSeek = e => e.altKey;
    ${runBinding}
    ${merge}
    globalThis.dispatch = ${keyHandler};
    globalThis.mergeKeybinds = mergeKeybinds;
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
    stored = JSON.stringify([{ ...view, pairSplit: 81 }]);
    assert.equal(context.readViews().length, 0);
    stored = JSON.stringify([{ ...view, pairSplit: 65 }]);
    assert.equal(context.readViews().length, 1);
    const legacy = { ...view };
    delete legacy.positions;
    stored = JSON.stringify([legacy]);
    assert.equal(context.readViews().length, 1);

    unavailable = '2';
    await assert.rejects(context.restoreView(view), /saved video is unavailable/);
    assert.equal(writes, 0, 'a saved scene with no video file leaves the queue untouched');
    unavailable = undefined;
    liveQueue = ['3'];
    await assert.rejects(context.restoreView(view), /queue changed/);
    assert.equal(writes, 0, 'an intervening queue edit is preserved');
    liveQueue = [];

    assert.equal(await context.restoreView({ ...view, pairSplit: 65 }), true);
    assert.equal(restoredSplit, 65);
    lateStarts.forEach(start => start());
    videos.forEach(video => video.dispatchEvent(new Event('loadedmetadata')));
    assert.deepEqual(videos.map(video => video.currentTime), [39, 70],
        'saved timestamps override remembered positions, including staggered cells');

    transcodeId = '2';
    await context.restoreView({ ...view, positions: [179.8, 179.9] });
    lateStarts.forEach(start => start());
    videos[0].dispatchEvent(new Event('loadedmetadata'));
    assert.equal(videos[0].currentTime, 179.8, 'valid direct-play offset close to the end');
    assert.equal(videos[1].src, '/scene/2/stream.webm?start=179.9', 'valid transcode offset close to the end');
    transcodeId = undefined;

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
    const dispatch = event => context.dispatch({
        target: {tagName: 'DIV'}, preventDefault() {}, ...event
    });
    context.playerSettings.keybinds = {seekBack: 'ArrowLeft', saveFavorite: 'Alt+ArrowLeft'};
    dispatch({key: 'ArrowLeft', altKey: true});
    assert.equal(actions.pop(), 'saveFavorite');
    context.playerSettings.keybinds = {seekBack: 'j', seekForward: 'Shift+j'};
    dispatch({key: 'J', shiftKey: true});
    assert.equal(actions.pop(), 'seekForward');
    context.playerSettings.keybinds = context.mergeKeybinds({seekBack: 'r'});
    assert.equal(context.playerSettings.keybinds.undoRoll, '');
    dispatch({key: 'R', shiftKey: true});
    assert.equal(actions.pop(), 'seekBack');
    context.playerSettings.keybinds = context.mergeKeybinds({seekBack: 'n'});
    assert.equal(context.playerSettings.keybinds.previousPane, '');
    dispatch({key: 'N', shiftKey: true});
    assert.equal(actions.pop(), 'seekBack');
    context.playerSettings.keybinds = {seekBack: 'Ctrl+j'};
    for (const role of [{shiftKey: true}, {altKey: true}]) {
        dispatch({key: 'j', ctrlKey: true, ...role});
        assert.equal(actions.pop(), 'seekBack');
    }
    context.pickStream = id => '/scene/' + id + '/stream.webm';
    await context.restoreView(view);
    lateStarts.forEach(start => start());
    assert.deepEqual(videos.map(video => video.src),
        ['/scene/1/stream.webm?start=39', '/scene/2/stream.webm?start=70']);
    console.log('Favorite timestamps, staggered initialization, legacy views, validation and seek chords passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
