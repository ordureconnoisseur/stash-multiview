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
    const context = vm.createContext({
        document: { getElementById: get, createElement: () => new Element() },
        Option: class { constructor(label, value) { this.label = label; this.value = value; this.dataset = {}; } },
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
    get('mv-queue-btn').events.click();
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
const modes = vm.createContext({
    playerSettings: { smartLayout: false },
    document: { body: { classList: { toggle() {} } }, getElementById: id => id === 'mv-grid' ? modeGrid : null },
    pairDrag: null,
    getPairSplit: () => null,
    positionPairDivider() {},
    clearJustifiedLayout: () => { cleared++; },
    applyJustifiedLayout: () => { smartLayoutRuns++; }
});
vm.runInContext(focusMode + wallLayout + 'applyFocusMode(true);', modes);
assert.equal(cleared, 1, 'Focus clears automatic sizing when Smart is off');
assert.equal(smartLayoutRuns, 0);
vm.runInContext('playerSettings.smartLayout = true; applyFocusMode(true);', modes);
assert.equal(smartLayoutRuns, 1, 'Smart still sizes panes with Focus on');
