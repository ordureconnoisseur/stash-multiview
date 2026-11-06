// Run with node tests/navigation-keybinds.cjs. No live Stash instance is required.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'multiView-player.js'), 'utf8');
const actions = source.slice(source.indexOf('    const KEYBIND_ACTIONS ='),
    source.indexOf('    // Targets where a non-left button'));
const settings = source.slice(source.indexOf('    function mergeKeybinds('),
    source.indexOf('    let playerSettings ='));
const volume = source.slice(source.indexOf('    function adjustVolume('),
    source.indexOf('    function muteHoveredCell('));
const calls = [];
const sliders = [1, 1].map(value => ({
    value, events: 0,
    dispatchEvent(event) { assert.equal(event.type, 'input'); this.events++; },
}));
const cells = sliders.map(slider => ({ querySelector: () => slider }));
const context = vm.createContext({
    Event,
    rerollPane: () => calls.push('one'),
    loadRoulette: (count, mode) => calls.push([count, mode]),
    undoLastRoll: () => calls.push('previous'),
    hoveredCell: event => event.cell || null,
    document: { querySelectorAll: () => cells },
});
vm.runInContext(`
    let undoSceneId = null;
    const DEFAULT_QUALITY = {};
    const SEEK_STEP_MAX = 120;
    const SEEK_ACTION_IDS = ['seekBack', 'seekForward'];
    const SEEK_MODIFIERS = [{value:'none'}, {value:'shift'}, {value:'alt'}, {value:'ctrl'}];
    ${actions}
    ${settings}
    ${volume}
    globalThis.loadSettings = loadPlayerSettings;
    globalThis.runAction = (id, event = {}) => KEYBIND_ACTIONS.find(action => action.id === id).run(event);
    globalThis.setUndoScene = id => { undoSceneId = id; };
`, context);

const legacy = context.loadSettings({keybinds:{reroll:'r',undoRoll:'Shift+r'}});
assert.equal(legacy.keybinds.reroll, 'n');
assert.equal(legacy.keybinds.previousPane, 'Shift+n');
assert.equal(legacy.keybinds.rollBoth, 'r');
assert.equal(legacy.keybinds.previousBoth, 'Shift+r');
assert.equal(legacy.keybinds.volumeUp, '.');
assert.equal(legacy.keybinds.volumeDown, ',');
const customized = context.loadSettings({navigationKeybindVersion:1,keybinds:{reroll:'r'}});
assert.equal(customized.keybinds.reroll, 'r');
assert.equal(customized.keybinds.rollBoth, '');

context.runAction('reroll');
assert.equal(calls.pop(), 'one');
context.runAction('rollBoth');
assert.deepEqual(calls.pop(), [2, 'replace']);
context.runAction('rollBoth', {repeat:true});
assert.equal(calls.length, 0);
context.setUndoScene('1');
context.runAction('previousBoth');
assert.equal(calls.length, 0);
context.runAction('previousPane');
assert.equal(calls.pop(), 'previous');
context.setUndoScene(null);
context.runAction('previousPane');
assert.equal(calls.length, 0);
context.runAction('previousBoth');
assert.equal(calls.pop(), 'previous');
context.runAction('volumeUp');
assert.deepEqual(sliders.map(slider => Number(slider.value)), [1.05, 1.05]);
context.runAction('volumeDown', {cell: cells[1]});
assert.deepEqual(sliders.map(slider => Number(slider.value)), [1.05, 1]);
sliders[0].value = 2;
context.runAction('volumeUp', {cell:cells[0]});
assert.equal(Number(sliders[0].value), 2);
sliders[0].value = 0;
context.runAction('volumeDown', {cell:cells[0]});
assert.equal(Number(sliders[0].value), 0);
console.log('Navigation defaults, one-time migration, editable overrides, roll scopes, previous scopes and volume bounds passed');
