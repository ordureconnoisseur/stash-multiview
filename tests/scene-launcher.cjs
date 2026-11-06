// Run with node tests/scene-launcher.cjs. No Stash instance is required.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'multiView.js'), 'utf8');
const inject = source.slice(source.indexOf('    async function sceneHasVideo('),
    source.indexOf('    function updateAllButtons()'));

class Element {
    constructor() {
        this.dataset = {};
        this.children = [];
        this.handlers = {};
    }
    append(...children) { this.children.push(...children); }
    appendChild(child) { this.append(child); }
    addEventListener(name, fn) { this.handlers[name] = fn; }
    setAttribute() {}
}

(async () => {
    const toolbar = new Element();
    const navigations = [];
    const tab = {
        location: { set href(url) { navigations.push(url); } },
        close() { this.closed = true; },
    };
    let result;
    let scene = { files: [{ id: '1' }] };
    let openedTab = tab;
    const intents = [];
    const context = vm.createContext({
        window: {
            location: { pathname: '/scenes/123', assign: url => navigations.push(url) },
            open: () => openedTab
        },
        document: {
            getElementById: () => null,
            querySelector: () => toolbar,
            createElement: () => new Element()
        },
        fetch: async () => ({ ok: true, json: async () => ({ data: { findScene: scene } }) }),
        setSceneQueued(id, want) {
            intents.push([id, want]);
            return new Promise(resolve => { result = resolve; });
        },
        isQueued: () => true,
        updateAllButtons() {},
    });
    vm.runInContext(`const PLAYER_URL = '/player'; ${inject} injectScenePageButton();`, context);
    const [queue, play, status] = toolbar.children[0].children;
    const flush = () => new Promise(setImmediate);
    const pending = play.handlers.click();
    await flush();
    assert.deepEqual(intents, [['123', true]], 'Play sets queue membership even when already queued');
    assert.equal(navigations.length, 0, 'navigation waits for the queue write');
    result(true);
    await pending;
    assert.match(navigations.pop(), /^\/player\?t=/);
    const rejected = play.handlers.click();
    await flush();
    result(false);
    await rejected;
    assert.equal(tab.closed, true);
    assert.equal(navigations.length, 0);
    assert.match(status.textContent, /Could not queue/);
    openedTab = null;
    const fallback = play.handlers.click();
    await flush();
    result(true);
    await fallback;
    assert.match(navigations.pop(), /^\/player\?t=/, 'blocked popups fall back to the current tab');
    const intentCount = intents.length;
    for (const unavailable of [{ files: [] }, null]) {
        scene = unavailable;
        await play.handlers.click();
        assert.equal(intents.length, intentCount, 'a missing or fileless scene does not change the queue');
        assert.equal(navigations.length, 0);
        assert.match(status.textContent, /no video file/);
    }
    const remove = queue.handlers.click();
    result(true);
    await remove;
    assert.deepEqual(intents.at(-1), ['123', false], 'Queue still toggles membership');
    console.log('Scene launcher waits for persistence, keeps existing picks, and handles write and popup failures');
})().catch(error => { console.error(error); process.exitCode = 1; });
