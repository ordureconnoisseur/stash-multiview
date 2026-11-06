// Run with node tests/dashboard.cjs. No Stash instance is required.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'multiView-player.js'), 'utf8');
const picker = source.slice(source.indexOf('    function setupQueuePicker()'),
    source.indexOf('    function computeJustifiedLayout('));

class Element {
    constructor() { this.events = {}; }
    get selectedOptions() { return (this.children || []).filter(child => child.value === this.value); }
    addEventListener(name, handler) { this.events[name] = handler; }
    append(child) { this.children = [child]; }
    replaceChildren(...children) {
        this.children = children;
        this.value = children.find(child => !child.disabled)?.value;
    }
    focus() {}
    showModal() { this.open = true; }
    close() { this.open = false; }
}

(async () => {
    const elements = new Map();
    const get = id => {
        if (!elements.has(id)) elements.set(id, new Element());
        return elements.get(id);
    };
    const changes = [];
    const libraryPages = [];
    let failNextPage = true;
    const context = vm.createContext({
        document: { getElementById: get, createElement: () => new Element() },
        Option: class { constructor(label, value) { this.label = label; this.value = value; this.dataset = {}; } },
        AbortController,
        fetch: async (_, options) => {
            const { page, per_page } = JSON.parse(options.body).variables.filter;
            libraryPages.push(page);
            if (page === 2 && failNextPage) {
                failNextPage = false;
                return { ok: false, json: async () => ({ errors: [{}] }) };
            }
            const offset = (page - 1) * per_page;
            const scenes = Array.from({ length: Math.min(per_page, 26 - offset) }, (_, i) =>
                ({ id: String(offset + i + 1), title: `Library scene ${offset + i + 1}` }));
            return { ok: true, json: async () => ({ data: { findScenes: { count: 26, scenes } } }) };
        },
        closeMenuPanel() {},
        chooseScene: async (target, id, swapOnly) => { changes.push([target, id, swapOnly]); }
    });
    vm.runInContext(`
        let queue = ['1', '2', '3'];
        let resolvedRaw = JSON.stringify(queue);
        const scenes = {};
        ${picker}
        setupQueuePicker();
    `, context);
    await get('mv-queue-btn').events.click();
    const results = get('mv-search-results');
    assert.deepEqual(libraryPages, [1], 'the picker browses the library when opened');
    assert.equal(results.children.length, 24);
    await get('mv-library-next').events.click();
    assert.equal(results.children.length, 24, 'a failed page request keeps the previous results');
    assert.equal(get('mv-library-next').disabled, false, 'the failed page remains reachable');
    await get('mv-library-next').events.click();
    assert.deepEqual(libraryPages, [1, 2, 2]);
    assert.equal(results.children.length, 2);
    assert.equal(get('mv-library-next').disabled, true);
    const target = get('mv-queue-target');
    assert.equal(target.value, '1');

    vm.runInContext("queue = ['2', '3']; resolvedRaw = JSON.stringify(queue);", context);
    get('mv-grid').events['mv-wall-rendered']();
    assert.equal(target.selectedOptions[0].disabled, true);
    target.value = '2';
    vm.runInContext("queue = ['3', '2']; resolvedRaw = JSON.stringify(queue);", context);
    get('mv-grid').events['mv-wall-rendered']();
    assert.equal(target.selectedOptions[0].disabled, true, 'reorder requires a fresh destination');
    const choice = get('mv-queued-scenes').children[0].children[0];
    await choice.events.click();
    assert.equal(changes.length, 0, 'a vanished destination cannot change another pane');
    target.value = '2';
    await choice.events.click();
    assert.deepEqual(changes, [['2', '3', true]]);
    console.log('Queue picker requires a new destination after the chosen pane disappears');
})().catch(error => { console.error(error); process.exitCode = 1; });

const layout = source.slice(source.indexOf('    function computeJustifiedLayout('),
    source.indexOf('    function applyJustifiedLayout()'));
const { justified, banded } = vm.runInNewContext(
    layout + '\n({ justified: computeJustifiedLayout, banded: computeBandedLayout })');
for (const [compute, ratios] of [
    [justified, Array(16).fill(16 / 9)],
    [banded, [9 / 16, ...Array(15).fill(16 / 9)]]
]) {
    const panes = compute(ratios, 390, 800, 3);
    assert.equal(panes.length, 16);
    for (const pane of panes) {
        assert.ok(pane.left >= 0 && pane.left + pane.width <= 390);
        assert.ok(pane.top >= 0 && pane.top + pane.height <= 800.001,
            'layout accounts for the gaps within the viewport');
    }
}

const focusLayout = source.slice(source.indexOf('    function applyJustifiedLayout()'),
    source.indexOf('    function clearJustifiedLayout()'));
const mixed = [...Array(3).fill(16 / 9), ...Array(13).fill(9 / 16)];
const cells = mixed.map(videoWidth => ({
    querySelector: () => ({ videoWidth, videoHeight: 1 }),
    style: { setProperty(name, value) { this[name] = value; } }
}));
const grid = { clientWidth: 390, clientHeight: 844, querySelectorAll: () => cells };
vm.runInNewContext(layout + focusLayout + 'applyJustifiedLayout();', {
    playerSettings: { focusMode: true, smartLayout: true },
    document: { getElementById: id => id === 'mv-grid' ? grid : { offsetHeight: 44 } }
});
for (const cell of cells) {
    const top = parseFloat(cell.style.top);
    const bottom = top + parseFloat(cell.style.height);
    assert.ok(top >= 44 && bottom <= 844.001,
        'Focus leaves room for the toolbar and pane controls on a crowded narrow wall');
}

const chooseScene = source.slice(source.indexOf('    async function chooseScene('),
    source.indexOf('    function setupQueuePicker()'));
let writes = 0;
const swapping = vm.createContext({
    fetchSceneMeta: async () => true,
    refreshUndoButton() {},
    flushDeferredQueueSync() {},
    flushDeferredAdvances() {},
    setUndoRoll() {},
    render() {},
    mutateConfigQueue: async change => {
        writes++;
        return change(['1', { type: 'filter', filter: {} }]);
    }
});
vm.runInContext(`
    let rouletteBusy = false, queueRemoval = null, queueResync = null;
    const queue = ['1', '3'], rawSlots = [0, 1], filterBackedCells = new Map();
    let resolvedRaw = JSON.stringify(['1', { type: 'filter', filter: {} }]);
    ${chooseScene}
`, swapping);
(async () => {
    await assert.rejects(vm.runInContext("chooseScene('1', '2', true)", swapping), /video changed/);
    assert.equal(writes, 0, 'an old Playing now choice cannot become a library replacement');
    await assert.rejects(vm.runInContext("chooseScene('1', '3', false)", swapping), /already playing/);
    assert.equal(writes, 0, 'a library choice cannot become a swap');
    await vm.runInContext("chooseScene('1', '3', true)", swapping);
    assert.equal(writes, 1);
    assert.equal(vm.runInContext("queue.join(',')", swapping), '3,1');
})().catch(error => { console.error(error); process.exitCode = 1; });

const focusMode = source.slice(source.indexOf('    function applyFocusMode('),
    source.indexOf('    function toggleSmartLayout('));
let cleared = 0;
let smartLayoutRuns = 0;
const wallLayout = source.slice(source.indexOf('    function applyWallLayout('),
    source.indexOf('    function positionPairDivider('));
const modeGrid = { children: [], hasAttribute: () => false, toggleAttribute() {} };
const focusButton = { classList: { toggle() {} } };
const resetButton = {};
const modeControls = { 'mv-grid': modeGrid, 'mv-focus-btn': focusButton, 'mv-reset-layout-btn': resetButton };
const modes = vm.createContext({
    playerSettings: { smartLayout: false },
    document: { body: { classList: { toggle() {} } }, getElementById: id => modeControls[id] ?? null },
    pairDrag: null,
    getPairSplit: () => null,
    positionPairDivider() {},
    clearJustifiedLayout: () => { cleared++; },
    applyJustifiedLayout: () => { smartLayoutRuns++; }
});
vm.runInContext(focusMode + wallLayout + 'applyFocusMode(true);', modes);
assert.equal(focusButton.title, 'Exit Focus Mode');
assert.equal(resetButton.disabled, true, 'Automatic layout has no custom sizes to reset');
assert.equal(cleared, 1, 'Focus clears automatic sizing when Smart is off');
assert.equal(smartLayoutRuns, 0);
vm.runInContext('playerSettings.smartLayout = true; applyFocusMode(true);', modes);
assert.equal(smartLayoutRuns, 1, 'Smart still sizes panes with Focus on');

const filterSearch = source.slice(source.indexOf('    async function findFilterScenes('),
    source.indexOf('    async function resolveFilterSlot('));
const advance = source.slice(source.indexOf('    async function advanceFilterCell('),
    source.indexOf('    function seekToStart('));
const withFile = id => ({ id: String(id), files: [{ id: String(id) }] });
const fileless = Array.from({ length: 24 }, (_, index) => ({ id: String(index + 3), files: [] }));
(async () => {
    for (const [scenes, playable, expected, statusText, pages] of [
        [null, true, '2', 'Could not load next', 1],
        [[withFile(1), withFile(2)], true, '2', 'No other playable match', 1],
        [[withFile(3)], false, '2', 'Could not load next', 1],
        [[withFile(3)], true, '3', 'Loading next video', 1],
        [[withFile(1), withFile(2), ...fileless, withFile(27)], true, '27', 'Loading next video', 2],
        [[withFile(1), withFile(2), ...fileless], true, '2', 'No other playable match', 2]
    ]) {
        const status = { textContent: 'Auto-next' };
        const video = {};
        const lookups = [];
        let replays = 0;
        let renders = 0;
        const context = vm.createContext({
            buildSceneFilter() {},
            fetch: async (_, options) => {
                const { per_page, page, sort } = JSON.parse(options.body).variables.filter;
                lookups.push({ page, sort });
                const offset = (page - 1) * per_page;
                const json = scenes
                    ? { data: { findScenes: { scenes: scenes.slice(offset, offset + per_page) } } }
                    : { errors: [{ message: 'Stash unavailable' }] };
                return { ok: true, json: async () => json };
            },
            fetchSceneMeta: async () => playable,
            render: () => { renders++; },
            seekToStart: () => { replays++; },
            document: { querySelector: () => ({ querySelector: selector => selector === 'video' ? video : status }) }
        });
        vm.runInContext(`
            const queue = ['1', '2'];
            const filterBackedCells = new Map([['2', { type: 'filter' }]]);
            const unmutedIds = new Set();
            const advancingCells = new Set();
            const deferredAdvances = new Set();
            const rouletteBusy = false, queueResync = null, undoSceneId = null;
            ${filterSearch}
            ${advance}
        `, context);
        await Promise.all([
            vm.runInContext("advanceFilterCell('2')", context),
            vm.runInContext("advanceFilterCell('2')", context)
        ]);
        assert.deepEqual(lookups.map(lookup => lookup.page), Array.from({ length: pages }, (_, i) => i + 1),
            'one advance visits each required page once');
        assert.match(lookups[0].sort, /^random_\d+$/);
        assert.ok(lookups.every(lookup => lookup.sort === lookups[0].sort), 'page requests keep one random order');
        assert.equal(status.textContent, statusText);
        assert.equal(vm.runInContext("queue.join(',')", context), '1,' + expected);
        assert.equal(replays, expected === '2' ? 1 : 0);
        assert.equal(renders, expected === '2' ? 0 : 1);
    }
    console.log('Auto-next replaces only its own pane and distinguishes missing matches from errors');
})().catch(error => { console.error(error); process.exitCode = 1; });
