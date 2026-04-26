(function () {
    'use strict';

    if (window.multiViewLoaded) return;
    window.multiViewLoaded = true;

    const STORAGE_KEY = 'stash-multiview-queue';
    const MODE_STORAGE_KEY = 'stash-multiview-picking-mode';
    const PLAYER_URL = '/plugin/multiView/assets/index.html';

    function getPickingMode() {
        return localStorage.getItem(MODE_STORAGE_KEY) === 'true';
    }

    function togglePickingMode() {
        const newState = !getPickingMode();
        localStorage.setItem(MODE_STORAGE_KEY, newState ? 'true' : 'false');
        applyPickingMode();
    }

    function applyPickingMode() {
        document.body.classList.toggle('mv-picking-mode', getPickingMode());
        document.querySelectorAll('.mv-picking-toggle-btn').forEach(btn => {
            btn.classList.toggle('active', getPickingMode());
            btn.title = getPickingMode() ? 'Disable Multiview Picking Mode' : 'Enable Multiview Picking Mode';
        });
        updateLauncher();
    }

    function getQueue() {
        try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
        catch { return []; }
    }

    function saveQueue(q) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(q));
        updateAllButtons();
        updateLauncher();
    }

    function isQueued(id) {
        return getQueue().includes(String(id));
    }

    function toggleScene(id) {
        const q = getQueue();
        const idx = q.indexOf(String(id));
        if (idx === -1) {
            if (q.length >= 9) { alert('Maximum 9 scenes in the multiview queue.'); return; }
            q.push(String(id));
        } else {
            q.splice(idx, 1);
        }
        saveQueue(q);
    }

    // ── Picking Toggle Button ─────────────────────────────────────────────────

    function createPickingToggleBtn() {
        const btn = document.createElement('button');
        btn.className = 'btn btn-secondary mv-picking-toggle-btn' + (getPickingMode() ? ' active' : '');
        btn.title = getPickingMode() ? 'Disable Multiview Picking Mode' : 'Enable Multiview Picking Mode';
        btn.innerHTML = GRID_ICON_SVG;
        btn.addEventListener('click', e => {
            e.preventDefault();
            togglePickingMode();
        });
        return btn;
    }

    function injectPickingModeToggle() {
        if (window.location.pathname.match(/^\/scenes\/\d+/)) {
            document.getElementById('mv-picking-standalone')?.remove();
            return;
        }

        // Priority 1: append into the display-mode button group (last btn-group before the zoom slider)
        const zoomSlider = document.querySelector('input[type="range"]');
        if (zoomSlider) {
            document.getElementById('mv-picking-standalone')?.remove();
            const allGroups = [...document.querySelectorAll('.btn-group')];
            const lastBtnGroup = allGroups.reverse().find(g =>
                g.compareDocumentPosition(zoomSlider) & Node.DOCUMENT_POSITION_FOLLOWING
            );
            if (lastBtnGroup) {
                if (!lastBtnGroup.querySelector('.mv-picking-toggle-btn')) {
                    lastBtnGroup.appendChild(createPickingToggleBtn());
                }
            } else if (!zoomSlider.parentElement.querySelector('.mv-picking-toggle-btn')) {
                zoomSlider.parentElement.insertBefore(createPickingToggleBtn(), zoomSlider);
            }
            return;
        }

        // Priority 2: pagination bar
        const paginations = document.querySelectorAll('.pagination');
        if (paginations.length) {
            document.getElementById('mv-picking-standalone')?.remove();
            paginations.forEach(pagination => {
                if (pagination.querySelector('.mv-picking-toggle-btn')) return;
                const btn = createPickingToggleBtn();
                btn.style.marginLeft = '12px';
                pagination.appendChild(btn);
            });
            return;
        }

        // Priority 3: standalone fixed button when scene cards are present
        if (!document.querySelector('.scene-card')) {
            document.getElementById('mv-picking-standalone')?.remove();
            return;
        }
        if (document.getElementById('mv-picking-standalone')) return;

        const btn = createPickingToggleBtn();
        btn.id = 'mv-picking-standalone';
        document.body.appendChild(btn);
    }

    // ── Card buttons ──────────────────────────────────────────────────────────

    function injectCardButtons() {
        document.querySelectorAll('.scene-card').forEach(card => {
            if (card.querySelector('.mv-add-btn')) return;

            const link = card.querySelector('a[href*="/scenes/"]');
            if (!link) return;
            const match = link.getAttribute('href').match(/\/scenes\/(\d+)/);
            if (!match) return;
            const id = match[1];

            const btn = document.createElement('button');
            btn.className = 'mv-add-btn' + (isQueued(id) ? ' mv-queued' : '');
            btn.dataset.sceneId = id;
            btn.title = 'Add to Multiview';
            btn.textContent = isQueued(id) ? '✓' : '+';

            btn.addEventListener('click', e => {
                e.preventDefault();
                e.stopPropagation();
                toggleScene(id);
                btn.textContent = isQueued(id) ? '✓' : '+';
                btn.classList.toggle('mv-queued', isQueued(id));
            });

            card.style.position = 'relative';
            card.appendChild(btn);
        });
    }

    // ── Scene detail page button ──────────────────────────────────────────────

    function injectScenePageButton() {
        const match = window.location.pathname.match(/^\/scenes\/(\d+)/);
        if (!match || window.location.pathname.includes('/edit')) return;
        const id = match[1];
        if (document.getElementById('mv-scene-btn')) return;

        const toolbar = document.querySelector('.scene-toolbar .scene-toolbar-group:last-child, .scene-toolbar');
        if (!toolbar) return;

        const btn = document.createElement('button');
        btn.id = 'mv-scene-btn';
        btn.className = 'mv-scene-page-btn btn btn-secondary' + (isQueued(id) ? ' active' : '');
        btn.title = isQueued(id) ? 'Remove from Multiview' : 'Add to Multiview';
        btn.innerHTML = GRID_ICON_SVG;

        btn.addEventListener('click', () => {
            toggleScene(id);
            const queued = isQueued(id);
            btn.classList.toggle('active', queued);
            btn.title = queued ? 'Remove from Multiview' : 'Add to Multiview';
        });

        toolbar.appendChild(btn);
    }

    // ── Update all existing card buttons ──────────────────────────────────────

    function updateAllButtons() {
        document.querySelectorAll('.mv-add-btn').forEach(btn => {
            const queued = isQueued(btn.dataset.sceneId);
            btn.textContent = queued ? '✓' : '+';
            btn.classList.toggle('mv-queued', queued);
        });
        const sceneBtn = document.getElementById('mv-scene-btn');
        if (sceneBtn) {
            const m = window.location.pathname.match(/^\/scenes\/(\d+)/);
            if (m) {
                const queued = isQueued(m[1]);
                sceneBtn.classList.toggle('active', queued);
                sceneBtn.title = queued ? 'Remove from Multiview' : 'Add to Multiview';
            }
        }
    }

    // ── Floating launcher ─────────────────────────────────────────────────────

    function updateLauncher() {
        const q = getQueue();
        let el = document.getElementById('mv-launcher');

        if (q.length === 0 || !getPickingMode()) { if (el) el.remove(); return; }

        if (!el) {
            el = document.createElement('div');
            el.id = 'mv-launcher';
            el.innerHTML = `
                <button id="mv-open-btn" title="Open Multiview">
                    <span id="mv-queue-count"></span>
                    Open Multiview
                </button>
                <button id="mv-clear-queue" title="Clear queue">✕</button>
            `;
            document.body.appendChild(el);
            document.getElementById('mv-open-btn').addEventListener('click', () => {
                window.open(PLAYER_URL, '_blank');
            });
            document.getElementById('mv-clear-queue').addEventListener('click', () => saveQueue([]));
        }

        document.getElementById('mv-queue-count').textContent = q.length;
    }

    // ── SVG icon ──────────────────────────────────────────────────────────────

    const GRID_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"></rect><rect x="14" y="3" width="7" height="7" rx="1"></rect><rect x="14" y="14" width="7" height="7" rx="1"></rect><rect x="3" y="14" width="7" height="7" rx="1"></rect></svg>`;

    // ── Init & navigation ─────────────────────────────────────────────────────

    let injectDebounce = null;
    const observer = new MutationObserver(() => {
        clearTimeout(injectDebounce);
        injectDebounce = setTimeout(() => {
            injectCardButtons();
            injectPickingModeToggle();
        }, 150);
    });
    observer.observe(document.body, { childList: true, subtree: true });

    function onNavigate() {
        setTimeout(() => {
            applyPickingMode();
            injectPickingModeToggle();
            injectCardButtons();
            injectScenePageButton();
            updateAllButtons();
            updateLauncher();
        }, 400);
    }

    // Sync queue badge if player tab removes scenes
    window.addEventListener('storage', e => {
        if (e.key === STORAGE_KEY) { updateAllButtons(); updateLauncher(); }
    });

    if (typeof PluginApi !== 'undefined' && PluginApi?.Event?.addEventListener) {
        PluginApi.Event.addEventListener('stash:location', onNavigate);
    }

    onNavigate();
})();
