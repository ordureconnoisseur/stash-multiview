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
        injectFilterBtn();
    }

    function getQueue() {
        try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
        catch { return []; }
    }

    function saveQueue(q) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(q));
        updateAllButtons();
        updateLauncher();
        injectFilterBtn();
    }

    function getSceneCount() {
        return getQueue().filter(item => typeof item === 'string').length;
    }

    function getFilterCount() {
        return getQueue().filter(item => typeof item === 'object' && item !== null).length;
    }

    function parseCurrentFilter() {
        const path = window.location.pathname;
        const params = new URLSearchParams(window.location.search);
        const f = {};

        // Entity-scoped scene pages. On these routes Stash injects the
        // entity as an implicit criterion via its useXxxFilterHook —
        // there's no c-param, so we have to add it ourselves.
        const performerMatch = path.match(/^\/performers\/(\d+)\/scenes/);
        const tagMatch       = path.match(/^\/tags\/(\d+)\/scenes/);
        const studioMatch    = path.match(/^\/studios\/(\d+)\/scenes/);
        const groupMatch     = path.match(/^\/groups\/(\d+)\/scenes/);
        if (performerMatch) f.performerId = performerMatch[1];
        if (tagMatch)       f.tagId       = tagMatch[1];
        if (studioMatch)    f.studioId    = studioMatch[1];
        if (groupMatch)     f.groupId     = groupMatch[1];

        // Query-string filters (scenes browse page)
        if (params.get('q')) f.q = params.get('q');
        const cParams = params.getAll('c');
        if (cParams.length) f.c = cParams;

        return Object.keys(f).length ? f : null;
    }

    function countCurrentFilterSlots() {
        const f = parseCurrentFilter();
        if (!f) return 0;
        const key = JSON.stringify(f);
        return getQueue().filter(item =>
            typeof item === 'object' && item !== null && JSON.stringify(item.filter) === key
        ).length;
    }

    function addFilterSlot() {
        const f = parseCurrentFilter();
        if (!f) return;
        const q = getQueue();
        if (q.length >= 16) { alert('Maximum 16 items in the multiview queue.'); return; }
        q.push({ type: 'filter', filter: f });
        saveQueue(q);
    }

    function isQueued(id) {
        return getQueue().includes(String(id));
    }

    function toggleScene(id) {
        const q = getQueue();
        const idx = q.indexOf(String(id));
        if (idx === -1) {
            if (q.length >= 16) { alert('Maximum 16 items in the multiview queue.'); return; }
            q.push(String(id));
        } else {
            q.splice(idx, 1);
        }
        saveQueue(q);
    }

    // ?"??"? Picking Toggle Button ?"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"?

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
            document.querySelectorAll('.mv-picking-toggle-btn').forEach(b => b.remove());
            return;
        }

        const zoomSlider = document.querySelector('input[type="range"]');
        if (!zoomSlider) {
            document.getElementById('mv-picking-standalone')?.remove();
            return;
        }

        document.getElementById('mv-picking-standalone')?.remove();
        document.querySelectorAll('.pagination .mv-picking-toggle-btn').forEach(b => b.remove());

        // Anchor: last btn-group before the zoom slider (the display-mode group).
        const allGroups = [...document.querySelectorAll('.btn-group')];
        const lastBtnGroup = allGroups.reverse().find(g =>
            g.compareDocumentPosition(zoomSlider) & Node.DOCUMENT_POSITION_FOLLOWING
        );

        // Place the toggle as a SIBLING after the btn-group instead of inside it.
        // Themes commonly hide / replace the display-mode btn-group (e.g. with a
        // chevron dropdown) and the toggle would get hidden along with it; placing
        // it outside keeps it visible and avoids cross-plugin "rescue" hacks.
        let targetParent, insertBefore;
        if (lastBtnGroup) {
            targetParent = lastBtnGroup.parentElement;
            insertBefore = lastBtnGroup.nextSibling;
        } else {
            targetParent = zoomSlider.parentElement;
            insertBefore = zoomSlider;
        }
        if (!targetParent) return;

        // If the toggle already sits at the right spot, no-op.
        const existing = targetParent.querySelector(':scope > .mv-picking-toggle-btn');
        if (existing) return;

        // Otherwise clean any orphaned instances (e.g. inside a re-rendered group)
        // and inject fresh at the stable location.
        document.querySelectorAll('.mv-picking-toggle-btn').forEach(b => b.remove());
        targetParent.insertBefore(createPickingToggleBtn(), insertBefore);
    }

    // ?"??"? Card buttons ?"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"?

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
            btn.innerHTML = isQueued(id) ? CHECK_SVG : PLUS_ICON_SVG;

            btn.addEventListener('click', e => {
                e.preventDefault();
                e.stopPropagation();
                toggleScene(id);
                btn.innerHTML = isQueued(id) ? CHECK_SVG : PLUS_ICON_SVG;
                btn.classList.toggle('mv-queued', isQueued(id));
            });

            card.style.position = 'relative';
            card.appendChild(btn);
        });
    }

    // ?"??"? Scene detail page button ?"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"?

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

    // ?"??"? Update all existing card buttons ?"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"?

    function updateAllButtons() {
        document.querySelectorAll('.mv-add-btn').forEach(btn => {
            const queued = isQueued(btn.dataset.sceneId);
            btn.innerHTML = queued ? CHECK_SVG : PLUS_ICON_SVG;
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

    // ?"??"? Floating launcher ?"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"?

    // Picking mode is opt-in, so when it's on the launcher follows the
    // user everywhere — single-scene page included. The X button on the
    // launcher handles "I'm done" (clears queue, then disables picking).
    function isLauncherAllowedHere() {
        return true;
    }

    function updateLauncher() {
        let el = document.getElementById('mv-launcher');

        if (!isLauncherAllowedHere() || !getPickingMode()) {
            if (el) el.remove();
            return;
        }

        if (!el) {
            el = document.createElement('div');
            el.id = 'mv-launcher';
            el.innerHTML = `
                <button id="mv-open-btn" title="Open Multiview">${GRID_ICON_SVG}</button>
                <span id="mv-scene-count" class="mv-launcher-count"></span>
                <span id="mv-filter-count" class="mv-launcher-count mv-launcher-filter-count"></span>
                <button id="mv-clear-queue" title="Clear queue">&times;</button>
            `;
            document.body.appendChild(el);
            document.getElementById('mv-open-btn').addEventListener('click', () => {
                window.open(PLAYER_URL, '_blank');
            });
            // First press clears the queue; with an already-empty queue the
            // X dismisses the launcher by disabling picking mode.
            document.getElementById('mv-clear-queue').addEventListener('click', () => {
                if (getQueue().length > 0) saveQueue([]);
                else togglePickingMode();
            });
        }

        const sceneCount = getSceneCount();
        const filterCount = getFilterCount();
        const total = sceneCount + filterCount;

        const sceneEl = document.getElementById('mv-scene-count');
        const filterEl = document.getElementById('mv-filter-count');
        const clearBtn = document.getElementById('mv-clear-queue');

        sceneEl.textContent = sceneCount;
        sceneEl.style.display = sceneCount ? '' : 'none';
        filterEl.textContent = filterCount;
        filterEl.style.display = filterCount ? '' : 'none';
        clearBtn.title = total ? 'Clear queue' : 'Disable picking mode';
    }

    // ?"??"? Filter add button ?"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"?

    function updateFilterBtn(btn) {
        const count = countCurrentFilterSlots();
        if (!btn.querySelector('svg')) btn.insertAdjacentHTML('afterbegin', PLUS_ICON_SVG);
        let badge = btn.querySelector('.mv-filter-badge');
        if (count > 0) {
            if (!badge) { badge = document.createElement('span'); badge.className = 'mv-filter-badge'; btn.appendChild(badge); }
            badge.textContent = String(count);
        } else if (badge) {
            badge.remove();
        }
        btn.title = count > 0
            ? `Add another slot for this filter (${count} already queued)`
            : 'Add current search as filter card';
        btn.classList.toggle('mv-filter-has-slots', count > 0);
    }

    // The filter-add button only makes sense when the page is currently
    // listing scenes. Whitelist the routes that primarily render scene
    // cards — the main scenes list and entity-scoped /scenes tabs for
    // performers/studios/tags/groups. /galleries, /images, /movies (no
    // longer a route in modern Stash), and other-tab routes are excluded.
    // The runtime .scene-card check catches /scenes/markers and tabs that
    // haven't finished rendering their cards yet.
    function isFilterAddBtnAllowedHere() {
        const p = window.location.pathname;
        if (/^\/scenes\/\d+/.test(p)) return false;
        const isScenesList   = /^\/scenes(\/|$)/.test(p);
        const isEntityScenes = /^\/(performers|studios|tags|groups)\/\d+\/scenes/.test(p);
        if (!isScenesList && !isEntityScenes) return false;
        return !!document.querySelector('.scene-card');
    }

    function injectFilterBtn() {
        if (!isFilterAddBtnAllowedHere() || !getPickingMode()) {
            document.getElementById('mv-filter-add-btn')?.remove();
            return;
        }

        if (document.getElementById('mv-filter-add-btn')) {
            updateFilterBtn(document.getElementById('mv-filter-add-btn'));
            return;
        }

        // Find insertion point: prefer Stash's filter toolbar btn-group, then filter button, then picking toggle
        const toolbarGroup = document.querySelector('.filtered-list-toolbar .btn-group');
        const filterBtn = document.querySelector('button.filter-button');
        const pickingToggle = document.querySelector('.mv-picking-toggle-btn');

        let container, insertRef;
        if (toolbarGroup) {
            container = toolbarGroup;
            insertRef = null; // appendChild
        } else if (filterBtn) {
            container = filterBtn.parentElement;
            insertRef = filterBtn.nextSibling;
        } else if (pickingToggle) {
            container = pickingToggle.parentElement;
            insertRef = pickingToggle.nextSibling;
        } else {
            return;
        }

        const btn = document.createElement('button');
        btn.id = 'mv-filter-add-btn';
        btn.className = 'btn btn-secondary mv-filter-add-btn';
        btn.type = 'button';
        updateFilterBtn(btn);
        btn.addEventListener('click', e => {
            e.preventDefault();
            addFilterSlot();
        });

        container.insertBefore(btn, insertRef);
    }

    // ?"??"? SVG icon ?"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"?

    const GRID_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"></rect><rect x="14" y="3" width="7" height="7" rx="1"></rect><rect x="14" y="14" width="7" height="7" rx="1"></rect><rect x="3" y="14" width="7" height="7" rx="1"></rect></svg>`;

    const PLUS_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 12H18M12 6V18"/></svg>`;

    const CHECK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12L10 17L19 8"/></svg>`;


    // ?"??"? Init & navigation ?"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"??"?

    let injectDebounce = null;
    const observer = new MutationObserver(() => {
        clearTimeout(injectDebounce);
        injectDebounce = setTimeout(() => {
            injectCardButtons();
            injectPickingModeToggle();
            injectFilterBtn();
            injectScenePageButton();
        }, 50);
    });
    observer.observe(document.body, { childList: true, subtree: true });

    function onNavigate() {
        setTimeout(() => {
            applyPickingMode();
            injectPickingModeToggle();
            injectCardButtons();
            injectScenePageButton();
            injectFilterBtn();
            updateAllButtons();
            updateLauncher();
        }, 400);
    }

    // Sync queue badge if player tab removes scenes
    window.addEventListener('storage', e => {
        if (e.key === STORAGE_KEY) {
            updateAllButtons();
            updateLauncher();
            const filterBtn = document.getElementById('mv-filter-add-btn');
            if (filterBtn) updateFilterBtn(filterBtn);
        }
    });

    if (typeof PluginApi !== 'undefined' && PluginApi?.Event?.addEventListener) {
        PluginApi.Event.addEventListener('stash:location', onNavigate);
    }

    onNavigate();
})();

