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
    get selectedOptions() { return this.children.filter(child => child.value === this.value); }
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
        Option: class { constructor(label, value) { this.label = label; this.value = value; } },
        closeMenuPanel() {},
        chooseScene: async (target, id) => { changes.push([target, id]); }
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
    assert.equal(target.value, '1');
    assert.equal(target.selectedOptions[0].disabled, true);
    const choice = get('mv-queued-scenes').children[1].children[0];
    await choice.events.click();
    assert.equal(changes.length, 0, 'a vanished destination cannot change another pane');
    target.value = '2';
    await choice.events.click();
    assert.deepEqual(changes, [['2', '3']]);
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
