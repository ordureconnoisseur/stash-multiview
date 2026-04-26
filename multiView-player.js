(function () {
    'use strict';

    const STORAGE_KEY = 'stash-multiview-queue';

    // ── SVGs ──────────────────────────────────────────────────────────────────

    const ICON_VOLUME_ON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 512" aria-hidden="true"><path fill="currentColor" d="M533.6 32.5C598.5 85.2 640 165.8 640 256s-41.5 170.7-106.4 223.5c-10.3 8.4-25.4 6.8-33.8-3.5s-6.8-25.4 3.5-33.8C557.5 398.2 592 331.2 592 256s-34.5-142.2-88.7-186.2c-10.3-8.4-11.8-23.5-3.5-33.8s23.5-11.8 33.8-3.5zM473.1 107c43.2 35.2 70.9 88.9 70.9 149s-27.7 113.8-70.9 149c-10.3 8.4-25.4 6.8-33.8-3.5s-6.8-25.4 3.5-33.8C475.3 341.3 496 301.1 496 256s-20.7-85.3-53.2-111.8c-10.3-8.4-11.8-23.5-3.5-33.8s23.5-11.8 33.8-3.5zm-60.5 74.5C434.1 199.1 448 225.9 448 256s-13.9 56.9-35.4 74.5c-10.3 8.4-25.4 6.8-33.8-3.5s-6.8-25.4 3.5-33.8C393.1 284.4 400 271 400 256s-6.9-28.4-17.7-37.3c-10.3-8.4-11.8-23.5-3.5-33.8s23.5-11.8 33.8-3.5zM301.1 34.8C312.6 40 320 51.4 320 64V448c0 12.6-7.4 24-18.9 29.2s-25 3.1-34.4-5.3L131.8 352H64c-35.3 0-64-28.7-64-64V224c0-35.3 28.7-64 64-64h67.8L266.7 40.1c9.4-8.4 22.9-10.7 34.4-5.3z"/></svg>`;

    const ICON_VOLUME_OFF = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 576 512" aria-hidden="true"><path fill="currentColor" d="M301.1 34.8C312.6 40 320 51.4 320 64V448c0 12.6-7.4 24-18.9 29.2s-25 3.1-34.4-5.3L131.8 352H64c-35.3 0-64-28.7-64-64V224c0-35.3 28.7-64 64-64h67.8L266.7 40.1c9.4-8.4 22.9-10.7 34.4-5.3zM425 167l55 55 55-55c9.4-9.4 24.6-9.4 33.9 0s9.4 24.6 0 33.9l-55 55 55 55c9.4 9.4 9.4 24.6 0 33.9s-24.6 9.4-33.9 0l-55-55-55 55c-9.4 9.4-24.6 9.4-33.9 0s-9.4-24.6 0-33.9l55-55-55-55c-9.4-9.4-9.4-24.6 0-33.9s24.6-9.4 33.9 0z"/></svg>`;

    const ICON_REMOVE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512" aria-hidden="true"><path fill="currentColor" d="M342.6 150.6c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L192 210.7 86.6 105.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3L146.7 256 41.4 361.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0L192 301.3 297.4 406.6c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L237.3 256l105.3-105.4z"/></svg>`;

    const ICON_PLAY  = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512" aria-hidden="true"><path fill="currentColor" d="M73 39c-14.8-9.1-33.4-9.4-48.5-.9S0 62.6 0 80V432c0 17.4 9.4 33.4 24.5 41.9S58.2 482 73 473l288-176c14.3-8.7 23-24.2 23-41s-8.7-32.2-23-41L73 39z"/></svg>`;
    const ICON_PAUSE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 512" aria-hidden="true"><path fill="currentColor" d="M48 64C21.5 64 0 85.5 0 112V400c0 26.5 21.5 48 48 48H80c26.5 0 48-21.5 48-48V112c0-26.5-21.5-48-48-48H48zm192 0c-26.5 0-48 21.5-48 48V400c0 26.5 21.5 48 48 48h32c26.5 0 48-21.5 48-48V112c0-26.5-21.5-48-48-48H240z"/></svg>`;
    const ICON_SWEAT = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36" aria-hidden="true"><path fill="currentColor" d="M22.855.758L7.875 7.024l12.537 9.733c2.633 2.224 6.377 2.937 9.77 1.518c4.826-2.018 7.096-7.576 5.072-12.413C33.232 1.024 27.68-1.261 22.855.758zm-9.962 17.924L2.05 10.284L.137 23.529a7.993 7.993 0 0 0 2.958 7.803a8.001 8.001 0 0 0 9.798-12.65zm15.339 7.015l-8.156-4.69l-.033 9.223c-.088 2 .904 3.98 2.75 5.041a5.462 5.462 0 0 0 7.479-2.051c1.499-2.644.589-6.013-2.04-7.523z"/></svg>`;

    // ── State ─────────────────────────────────────────────────────────────────

    let queue = [];
    let scenes = {};         // id → { id, title, streams }
    const unmutedIds = new Set();
    let openPopupId = null;
    const seekBases = new Map(); // id → seconds already consumed before current src load

    // ── Web Audio ─────────────────────────────────────────────────────────────

    let audioCtx = null;
    const cellGains = new Map(); // id → GainNode

    function getAudioCtx() {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        // Browsers suspend AudioContext until a user gesture; resume eagerly
        if (audioCtx.state === 'suspended') audioCtx.resume();
        return audioCtx;
    }

    function connectAudio(id, video) {
        if (cellGains.has(id)) return; // already connected
        try {
            const ctx = getAudioCtx();
            const source = ctx.createMediaElementSource(video);
            const gain = ctx.createGain();
            gain.gain.value = 1.0;
            source.connect(gain);
            gain.connect(ctx.destination);
            cellGains.set(id, gain);
        } catch (e) {
            // Silently ignore — audio still works via video.volume fallback
        }
    }

    function setGain(id, value) {
        getAudioCtx(); // ensure context is resumed
        const gain = cellGains.get(id);
        if (gain) gain.gain.value = value;
    }

    function disconnectAudio(id) {
        const gain = cellGains.get(id);
        if (gain) {
            try { gain.disconnect(); } catch {}
            cellGains.delete(id);
        }
    }

    // ── Queue ─────────────────────────────────────────────────────────────────

    function getQueue() {
        try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
        catch { return []; }
    }

    function saveQueue(q) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(q));
    }

    function removeScene(id) {
        const q = getQueue().filter(x => x !== String(id));
        saveQueue(q);
        queue = q;
        unmutedIds.delete(String(id));
        disconnectAudio(id);
        seekBases.delete(id);
        render();
    }

    // ── Stream selection ──────────────────────────────────────────────────────

    function parseStreams(streamList) {
        const s = {};
        if (!streamList) return s;
        for (const entry of streamList) {
            const label = (entry.label || '').toLowerCase();
            const isWebm = (entry.mime_type || '').includes('webm');
            
            const is1080 = label.includes('1080');
            const is720 = label.includes('720');
            const is480 = label.includes('480');
            const is360 = label.includes('360') || label.includes('240');

            if (is1080 && isWebm)      s.webm1080 = entry.url;
            else if (is1080)           s.mp41080  = entry.url;
            else if (is720 && isWebm)  s.webm720  = entry.url;
            else if (is720)            s.mp4720   = entry.url;
            else if (is480 && isWebm)  s.webm480  = entry.url;
            else if (is480)            s.mp4480   = entry.url;
            else if (is360 && isWebm)  s.webm360  = entry.url;
            else if (is360)            s.mp4360   = entry.url;
            else if (!s.direct)        s.direct   = entry.url;
        }
        return s;
    }

    function pickStream(id) {
        const s = scenes[id]?.streams;
        if (!s) return `/scene/${id}/stream`;
        const count = queue.length;
        
        const res360  = s.webm360  || s.mp4360;
        const res480  = s.webm480  || s.mp4480;
        const res720  = s.webm720  || s.mp4720;
        const res1080 = s.webm1080 || s.mp41080;
        const direct  = s.direct   || `/scene/${id}/stream`;

        if (count >= 7) {
            // 9-grid: Prefer 480p, then 360p, then 720p
            return res480 || res360 || res720 || direct;
        } else if (count >= 5) {
            // 6-grid: Prefer 480p, then 720p, then 1080p
            return res480 || res720 || res1080 || direct;
        } else if (count >= 2) {
            // 2-grid or 4-grid: Prefer 720p, then 480p, then 1080p
            return res720 || res480 || res1080 || direct;
        } else {
            // 1-grid: Prefer 1080p, then 720p, then direct
            return res1080 || res720 || direct;
        }
    }

    // ── GraphQL ───────────────────────────────────────────────────────────────

    async function fetchSceneMeta(id) {
        try {
            const res = await fetch('/graphql', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    query: `query FindScene($id: ID!) {
                        findScene(id: $id) {
                            title
                            o_counter
                            files { path duration }
                            sceneStreams { url mime_type label }
                        }
                    }`,
                    variables: { id: String(id) }
                })
            });
            const data = await res.json();
            const scene = data?.data?.findScene;
            if (!scene) return;
            let title = scene.title;
            if (!title) {
                const path = scene.files?.[0]?.path;
                title = path ? path.split(/[\\/]/).pop().replace(/\.[^.]+$/, '') : String(id);
            }
            scenes[id] = { id, title, oCount: scene.o_counter ?? 0, duration: scene.files?.[0]?.duration ?? null, streams: parseStreams(scene.sceneStreams) };
        } catch {
            if (!scenes[id]) scenes[id] = { id, title: String(id), streams: {} };
        }
    }

    async function loadSceneMeta(ids) {
        await Promise.all(ids.filter(id => !scenes[id]).map(fetchSceneMeta));
    }

    async function incrementO(id) {
        try {
            const res = await fetch('/graphql', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    query: `mutation IncrementO($id: ID!) { sceneIncrementO(id: $id) }`,
                    variables: { id: String(id) }
                })
            });
            const data = await res.json();
            const newCount = data?.data?.sceneIncrementO;
            if (newCount != null && scenes[id]) {
                scenes[id].oCount = newCount;
                const btn = document.querySelector(`.mv-cell[data-scene-id="${id}"] .mv-o-btn span`);
                if (btn) btn.textContent = newCount;
            }
        } catch {}
    }

    async function incrementAllO() {
        await Promise.all(queue.map(incrementO));
    }

    // ── Layout ────────────────────────────────────────────────────────────────

    function autoLayout(count, isPortrait = false) {
        if (count <= 1) return '1x1';
        if (count <= 2) return '2x1';
        if (isPortrait && count === 3) return '3x1';
        if (count <= 4) return '2x2';
        if (count <= 6) return '3x2';
        return '3x3';
    }

    function detectAndApplyOrientation() {
        const videos = [...document.querySelectorAll('.mv-cell video')];
        const loaded = videos.filter(v => v.videoWidth > 0 && v.videoHeight > 0);
        if (!loaded.length) return;

        const portraitCount = loaded.filter(v => v.videoHeight > v.videoWidth).length;
        const isPortrait = portraitCount > loaded.length / 2;

        const grid = document.getElementById('mv-grid');
        const expectedLayout = autoLayout(queue.length, isPortrait);
        if (grid && grid.className !== 'layout-' + expectedLayout) {
            grid.className = 'layout-' + expectedLayout;
        }
    }

    // ── Play / Pause All ──────────────────────────────────────────────────────

    function playPauseAll() {
        const videos = [...document.querySelectorAll('.mv-cell video')];
        const anyPlaying = videos.some(v => !v.paused);
        videos.forEach(v => anyPlaying ? v.pause() : v.play());
        updatePlayPauseAllBtn(!anyPlaying);
    }

    function updatePlayPauseAllBtn(playing) {
        const btn = document.getElementById('mv-playpause-all-btn');
        if (!btn) return;
        btn.innerHTML = playing
            ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 512" aria-hidden="true"><path fill="currentColor" d="M48 64C21.5 64 0 85.5 0 112V400c0 26.5 21.5 48 48 48H80c26.5 0 48-21.5 48-48V112c0-26.5-21.5-48-48-48H48zm192 0c-26.5 0-48 21.5-48 48V400c0 26.5 21.5 48 48 48h32c26.5 0 48-21.5 48-48V112c0-26.5-21.5-48-48-48H240z"/></svg>`
            : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512" aria-hidden="true"><path fill="currentColor" d="M73 39c-14.8-9.1-33.4-9.4-48.5-.9S0 62.6 0 80V432c0 17.4 9.4 33.4 24.5 41.9S58.2 482 73 473l288-176c14.3-8.7 23-24.2 23-41s-8.7-32.2-23-41L73 39z"/></svg>`;
        btn.title = playing ? 'Pause All' : 'Play All';
    }

    // ── Audio mute/unmute ─────────────────────────────────────────────────────

    function applyAudioCell(cell) {
        const id = cell.dataset.sceneId;
        const on = unmutedIds.has(id);
        const video = cell.querySelector('video');
        if (video) video.muted = !on;
        cell.classList.toggle('audio-active', on);
        ['.mv-cell-audio-btn', '.mv-popup-mute-btn'].forEach(sel => {
            const btn = cell.querySelector(sel);
            if (!btn) return;
            btn.classList.toggle('audio-on', on);
            btn.innerHTML = on ? ICON_VOLUME_ON : ICON_VOLUME_OFF;
            btn.title = on ? 'Mute' : 'Unmute';
        });
    }

    function toggleAudio(id) {
        getAudioCtx(); // resume on any interaction
        if (unmutedIds.has(String(id))) unmutedIds.delete(String(id));
        else unmutedIds.add(String(id));
        const cell = document.querySelector(`.mv-cell[data-scene-id="${id}"]`);
        if (cell) applyAudioCell(cell);
        updateMuteAllBtn();
    }

    function updateMuteAllBtn() {
        const btn = document.getElementById('mv-mute-all-btn');
        if (!btn) return;
        const anyUnmuted = unmutedIds.size > 0;
        btn.title = anyUnmuted ? 'Mute All' : 'Unmute All';
        btn.innerHTML = anyUnmuted
            ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 512" aria-hidden="true"><path fill="currentColor" d="M533.6 32.5C598.5 85.2 640 165.8 640 256s-41.5 170.7-106.4 223.5c-10.3 8.4-25.4 6.8-33.8-3.5s-6.8-25.4 3.5-33.8C557.5 398.2 592 331.2 592 256s-34.5-142.2-88.7-186.2c-10.3-8.4-11.8-23.5-3.5-33.8s23.5-11.8 33.8-3.5zM473.1 107c43.2 35.2 70.9 88.9 70.9 149s-27.7 113.8-70.9 149c-10.3 8.4-25.4 6.8-33.8-3.5s-6.8-25.4 3.5-33.8C475.3 341.3 496 301.1 496 256s-20.7-85.3-53.2-111.8c-10.3-8.4-11.8-23.5-3.5-33.8s23.5-11.8 33.8-3.5zm-60.5 74.5C434.1 199.1 448 225.9 448 256s-13.9 56.9-35.4 74.5c-10.3 8.4-25.4 6.8-33.8-3.5s-6.8-25.4 3.5-33.8C393.1 284.4 400 271 400 256s-6.9-28.4-17.7-37.3c-10.3-8.4-11.8-23.5-3.5-33.8s23.5-11.8 33.8-3.5zM301.1 34.8C312.6 40 320 51.4 320 64V448c0 12.6-7.4 24-18.9 29.2s-25 3.1-34.4-5.3L131.8 352H64c-35.3 0-64-28.7-64-64V224c0-35.3 28.7-64 64-64h67.8L266.7 40.1c9.4-8.4 22.9-10.7 34.4-5.3z"/></svg>`
            : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 576 512" aria-hidden="true"><path fill="currentColor" d="M301.1 34.8C312.6 40 320 51.4 320 64V448c0 12.6-7.4 24-18.9 29.2s-25 3.1-34.4-5.3L131.8 352H64c-35.3 0-64-28.7-64-64V224c0-35.3 28.7-64 64-64h67.8L266.7 40.1c9.4-8.4 22.9-10.7 34.4-5.3zM425 167l55 55 55-55c9.4-9.4 24.6-9.4 33.9 0s9.4 24.6 0 33.9l-55 55 55 55c9.4 9.4 9.4 24.6 0 33.9s-24.6 9.4-33.9 0l-55-55-55 55c-9.4 9.4-24.6 9.4-33.9 0s-9.4-24.6 0-33.9l55-55-55-55c-9.4-9.4-9.4-24.6 0-33.9s24.6-9.4 33.9 0z"/></svg>`;
    }

    function toggleMuteAll() {
        getAudioCtx();
        if (unmutedIds.size > 0) {
            unmutedIds.clear();
        } else {
            queue.forEach(id => unmutedIds.add(id));
        }
        document.querySelectorAll('.mv-cell').forEach(applyAudioCell);
        updateMuteAllBtn();
    }

    // ── Seek ──────────────────────────────────────────────────────────────────

    let activeSeek = null; // { seekbar, fill, video, id, ratio }

    function updateSeekFill(e) {
        if (!activeSeek) return;
        const rect = activeSeek.seekbar.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        activeSeek.ratio = ratio;
        activeSeek.fill.style.width = (ratio * 100) + '%';
    }

    function commitSeek() {
        if (!activeSeek || activeSeek.ratio == null) return;
        const { video, id, ratio } = activeSeek;
        const duration = scenes[id]?.duration || (isFinite(video.duration) ? video.duration : null);
        if (!duration) return;

        const targetTime = ratio * duration;
        const currentSrc = video.getAttribute('src');

        // Check if it's a transcoded stream
        const isTranscode = currentSrc && (currentSrc.includes('.webm') || currentSrc.includes('.mp4'));

        if (isTranscode) {
            const baseSrc = currentSrc.split(/[?&]start=/)[0];
            const sep = baseSrc.includes('?') ? '&' : '?';
            seekBases.set(id, targetTime);
            const wasPlaying = !video.paused;
            
            const cell = document.querySelector(`.mv-cell[data-scene-id="${id}"]`);
            if (cell && !cell.querySelector('.mv-loading')) {
                const s = document.createElement('div');
                s.className = 'mv-loading';
                s.innerHTML = '<div class="mv-spinner"></div>';
                cell.appendChild(s);
            }
            
            video.src = baseSrc + sep + 'start=' + targetTime;
            if (wasPlaying || video.autoplay) video.play();
        } else {
            video.currentTime = targetTime;
        }
    }

    // ── Volume popup ──────────────────────────────────────────────────────────

    function closeAllPopups() {
        openPopupId = null;
        document.querySelectorAll('.mv-cell.mv-popup-open').forEach(cell => {
            cell.classList.remove('mv-popup-open');
            const p = cell.querySelector('.mv-vol-popup');
            if (p) p.classList.remove('is-open');
        });
    }

    function togglePopup(id) {
        if (openPopupId === id) { closeAllPopups(); return; }
        closeAllPopups();
        openPopupId = id;
        const cell = document.querySelector(`.mv-cell[data-scene-id="${id}"]`);
        if (!cell) return;
        cell.classList.add('mv-popup-open');
        const p = cell.querySelector('.mv-vol-popup');
        if (p) p.classList.add('is-open');
    }

    // ── Render ────────────────────────────────────────────────────────────────

    function render() {
        const grid = document.getElementById('mv-grid');
        const empty = document.getElementById('mv-empty');
        const titleEl = document.getElementById('mv-title');

        if (queue.length === 0) {
            grid.innerHTML = '';
            grid.className = 'layout-1x1';
            empty.style.display = 'flex';
            titleEl.textContent = 'Stash Multiview';
            return;
        }

        empty.style.display = 'none';
        titleEl.textContent = `${queue.length} scene${queue.length > 1 ? 's' : ''}`;

        const layout = autoLayout(queue.length);
        grid.className = 'layout-' + layout;
        // Correct layout immediately if videos already have dimensions (re-render case)
        detectAndApplyOrientation();

        // Remove cells no longer in queue, and update quality for existing ones
        grid.querySelectorAll('.mv-cell').forEach(cell => {
            const id = cell.dataset.sceneId;
            if (!queue.includes(id)) {
                cell.remove();
                return;
            }

            const video = cell.querySelector('video');
            if (!video) return;

            const optimalSrc = pickStream(id);
            const currentSrc = video.getAttribute('src') || '';
            const baseSrc = currentSrc.split(/[?&]start=/)[0];

            if (baseSrc && baseSrc !== optimalSrc) {
                let currentTime = video.currentTime;
                if (currentSrc.match(/[?&]start=/)) {
                    currentTime += (seekBases.get(id) || 0);
                }

                const wasPlaying = !video.paused;
                const isTranscode = optimalSrc.includes('.webm') || optimalSrc.includes('.mp4');

                if (!cell.querySelector('.mv-loading')) {
                    const s = document.createElement('div');
                    s.className = 'mv-loading';
                    s.innerHTML = '<div class="mv-spinner"></div>';
                    cell.appendChild(s);
                }

                if (isTranscode && currentTime > 0) {
                    const sep = optimalSrc.includes('?') ? '&' : '?';
                    seekBases.set(id, currentTime);
                    video.src = optimalSrc + sep + 'start=' + currentTime;
                } else {
                    seekBases.set(id, 0);
                    video.src = optimalSrc;
                    const onMeta = () => {
                        if (currentTime > 0) video.currentTime = currentTime;
                        video.removeEventListener('loadedmetadata', onMeta);
                    };
                    video.addEventListener('loadedmetadata', onMeta);
                }
                if (wasPlaying || video.autoplay) video.play();
            }
        });

        // Add new cells
        queue.forEach(id => {
            if (grid.querySelector(`.mv-cell[data-scene-id="${id}"]`)) return;

            const cell = document.createElement('div');
            cell.className = 'mv-cell';
            cell.dataset.sceneId = id;

            const video = document.createElement('video');
            video.src = pickStream(id);
            video.autoplay = true;
            video.loop = true;
            video.muted = !unmutedIds.has(id);
            video.playsInline = true;

            video.addEventListener('loadedmetadata', () => {
                connectAudio(id, video);
                detectAndApplyOrientation();
            }, { once: true });

            const loadingDiv = document.createElement('div');
            loadingDiv.className = 'mv-loading';
            loadingDiv.innerHTML = '<div class="mv-spinner"></div>';
            video.addEventListener('canplay', () => {
                loadingDiv.remove();
                detectAndApplyOrientation();
            }, { once: true });

            // Final fallback: videoWidth/videoHeight are guaranteed non-zero during playback
            const checkDims = () => {
                if (video.videoWidth > 0) {
                    video.removeEventListener('timeupdate', checkDims);
                    detectAndApplyOrientation();
                }
            };
            video.addEventListener('timeupdate', checkDims);

            const overlay = document.createElement('div');
            overlay.className = 'mv-cell-overlay';

            const sceneTitleEl = document.createElement('a');
            sceneTitleEl.className = 'mv-cell-title';
            sceneTitleEl.href = `/scenes/${id}`;
            sceneTitleEl.target = '_blank';
            sceneTitleEl.rel = 'noopener';
            sceneTitleEl.textContent = scenes[id]?.title || id;
            sceneTitleEl.addEventListener('click', e => e.stopPropagation());

            // Controls row
            const controls = document.createElement('div');
            controls.className = 'mv-cell-controls';

            const audioBtn = document.createElement('button');
            audioBtn.className = 'mv-cell-btn mv-cell-audio-btn' + (unmutedIds.has(id) ? ' audio-on' : '');
            audioBtn.innerHTML = unmutedIds.has(id) ? ICON_VOLUME_ON : ICON_VOLUME_OFF;
            audioBtn.title = 'Volume';
            audioBtn.addEventListener('click', e => {
                e.stopPropagation();
                getAudioCtx();
                togglePopup(id);
            });

            const removeBtn = document.createElement('button');
            removeBtn.className = 'mv-cell-btn mv-cell-remove';
            removeBtn.innerHTML = ICON_REMOVE;
            removeBtn.title = 'Remove';
            removeBtn.addEventListener('click', e => {
                e.stopPropagation();
                removeScene(id);
            });

            const playPauseBtn = document.createElement('button');
            playPauseBtn.className = 'mv-cell-playpause';
            playPauseBtn.innerHTML = ICON_PAUSE;
            playPauseBtn.title = 'Pause';
            playPauseBtn.addEventListener('click', e => {
                e.stopPropagation();
                if (video.paused) { video.play(); }
                else              { video.pause(); }
            });
            video.addEventListener('pause', () => {
                playPauseBtn.innerHTML = ICON_PLAY;
                playPauseBtn.title = 'Play';
            });
            video.addEventListener('play', () => {
                playPauseBtn.innerHTML = ICON_PAUSE;
                playPauseBtn.title = 'Pause';
            });

            const oBtn = document.createElement('button');
            oBtn.className = 'mv-cell-btn mv-o-btn';
            oBtn.title = 'Increment O counter';
            const oCount = scenes[id]?.oCount ?? 0;
            oBtn.innerHTML = `${ICON_SWEAT}<span>${oCount}</span>`;
            oBtn.addEventListener('click', e => {
                e.stopPropagation();
                incrementO(id);
            });

            controls.append(oBtn, audioBtn, removeBtn);
            overlay.append(sceneTitleEl, playPauseBtn, controls);

            // Volume popup (direct child of cell, not overlay)
            const popup = document.createElement('div');
            popup.className = 'mv-vol-popup';

            const volLabel = document.createElement('span');
            volLabel.className = 'mv-vol-label';
            volLabel.textContent = '100%';

            const slider = document.createElement('input');
            slider.type = 'range';
            slider.className = 'mv-vol-slider';
            slider.min = 0;
            slider.max = 2;
            slider.step = 0.05;
            slider.value = 1;
            slider.title = 'Volume (0–200%)';
            slider.addEventListener('input', e => {
                e.stopPropagation();
                const val = parseFloat(slider.value);
                volLabel.textContent = Math.round(val * 100) + '%';
                setGain(id, val);
            });
            slider.addEventListener('click', e => e.stopPropagation());
            slider.addEventListener('mousedown', e => e.stopPropagation());

            const popupMuteBtn = document.createElement('button');
            popupMuteBtn.className = 'mv-popup-mute-btn mv-cell-btn' + (unmutedIds.has(id) ? ' audio-on' : '');
            popupMuteBtn.innerHTML = unmutedIds.has(id) ? ICON_VOLUME_ON : ICON_VOLUME_OFF;
            popupMuteBtn.title = unmutedIds.has(id) ? 'Mute' : 'Unmute';
            popupMuteBtn.addEventListener('click', e => {
                e.stopPropagation();
                toggleAudio(id);
            });
            popupMuteBtn.addEventListener('mousedown', e => e.stopPropagation());

            popup.append(volLabel, slider, popupMuteBtn);

            // Seekbar
            const seekbar = document.createElement('div');
            seekbar.className = 'mv-seekbar';
            const seekFill = document.createElement('div');
            seekFill.className = 'mv-seekbar-fill';
            seekbar.appendChild(seekFill);

            const updateProgress = () => {
                if (activeSeek && activeSeek.id === id) return;
                const duration = scenes[id]?.duration || (isFinite(video.duration) ? video.duration : null);
                const currentSrc = video.getAttribute('src');
                let current = video.currentTime;
                if (currentSrc && currentSrc.match(/[?&]start=/)) {
                    current += (seekBases.get(id) || 0);
                }
                if (duration) seekFill.style.width = (current / duration * 100) + '%';
            };

            video.addEventListener('timeupdate', () => {
                if (video.seeking) return;
                updateProgress();
            });

            video.addEventListener('seeking', () => {
                if (!cell.querySelector('.mv-loading')) {
                    const s = document.createElement('div');
                    s.className = 'mv-loading';
                    s.innerHTML = '<div class="mv-spinner"></div>';
                    cell.appendChild(s);
                }
            });

            video.addEventListener('seeked', () => {
                cell.querySelector('.mv-loading')?.remove();
                updateProgress();
            });

            video.addEventListener('canplay', () => {
                cell.querySelector('.mv-loading')?.remove();
            });

            seekbar.addEventListener('mousedown', e => {
                e.stopPropagation();
                activeSeek = { seekbar, fill: seekFill, video, id, ratio: null };
                updateSeekFill(e);
                commitSeek(); // immediate jump on click
            });

            cell.append(video, loadingDiv, overlay, popup, seekbar);

            cell.addEventListener('mouseleave', () => {
                if (openPopupId === id) closeAllPopups();
            });

            if (unmutedIds.has(id)) cell.classList.add('audio-active');

            grid.appendChild(cell);
        });
    }

    // ── Cross-tab sync ────────────────────────────────────────────────────────

    window.addEventListener('storage', e => {
        if (e.key !== STORAGE_KEY) return;
        queue = getQueue();
        loadSceneMeta(queue).then(render);
    });

    // ── Init ──────────────────────────────────────────────────────────────────

    async function init() {
        queue = getQueue();

        document.getElementById('mv-playpause-all-btn').addEventListener('click', playPauseAll);
        document.getElementById('mv-mute-all-btn').addEventListener('click', toggleMuteAll);
        document.getElementById('mv-o-all-btn').addEventListener('click', incrementAllO);

        document.addEventListener('mousemove', updateSeekFill);
        document.addEventListener('mouseup', () => { commitSeek(); activeSeek = null; });

        // Close popup when clicking anywhere outside a popup or its trigger button
        document.addEventListener('mousedown', e => {
            if (!e.target.closest('.mv-vol-popup') && !e.target.closest('.mv-cell-audio-btn')) {
                closeAllPopups();
            }
        });

        await loadSceneMeta(queue);
        render();
    }

    document.addEventListener('DOMContentLoaded', init);
})();
