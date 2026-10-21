(function () {
    'use strict';

    const STORAGE_KEY = 'stash-multiview-queue';
    const ROULETTE_COUNT_KEY = 'stash-multiview-roulette-count';
    const ROULETTE_MODE_KEY = 'stash-multiview-roulette-mode'; // 'replace' | 'add'
    const SETTINGS_KEY = 'stash-multiview-settings';

    // Stall recovery tuning. A stalled transcode is re-sourced from the
    // current playhead, but bounded so a permanently-dead stream can't
    // hammer the shared transcoder into a freeze:
    //  - STALL_TIMEOUT_MS: how long a `waiting` may persist before we act.
    //  - RECOVERY_COOLDOWN_MS: minimum gap between two recoveries on one
    //    cell, so rapid waiting/error bursts collapse into one attempt.
    //  - MAX_RECOVERIES: hard cap; once hit we give up (filter cells advance).
    //  - SUSTAINED_PLAY_MS: budget is forgiven ONE recovery at a time only
    //    after this much *uninterrupted* playback (a stall cancels the window).
    //    Kept above STALL_TIMEOUT_MS so a stream must play substantially longer
    //    than it takes to detect a stall before earning budget back — a tight
    //    stall loop therefore walks up to the cap instead of looping forever.
    const STALL_TIMEOUT_MS = 12000;
    const RECOVERY_COOLDOWN_MS = 6000;
    const MAX_RECOVERIES = 3;
    const SUSTAINED_PLAY_MS = 20000;
    const SEEKING_SPINNER_DELAY_MS = 350;
    // When a render adds several cells at once (initial load, roulette roll),
    // ramp their stream starts apart by this much per cell instead of firing
    // all N transcode requests at the same instant — a simultaneous burst
    // saturates a slow link / the shared transcoder and makes every cell stall.
    const STREAM_STAGGER_MS = 200;
    // Hide the hover overlay/controls and the cursor after the pointer sits
    // still this long, like a video player. Any movement restores them.
    const IDLE_HIDE_MS = 2500;

    const PROGRESS_KEY = 'stash-multiview-progress';
    const PROGRESS_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
    const PROGRESS_SAVE_INTERVAL_MS = 5000;
    const PROGRESS_MIN_SAVE = 5;
    // If a saved position is within this many seconds of the end (or past it —
    // e.g. the scene was re-encoded shorter since), don't resume: a ?start=
    // past EOF triggers an immediate error/recovery storm, and resuming into
    // the last few seconds is pointless. Start fresh instead.
    const PROGRESS_END_MARGIN = 10;

    // How close to the bottom of a cell the pointer has to be for that cell to
    // enter its "seek zone" (bar grows, controls lift, time readout appears).
    // Measured in JS because the overlay covers the bar's hit strip; see the
    // .mv-seek-zone rules in the stylesheet for why :hover cannot do this.
    const SEEK_ZONE_PX = 34;

    // A/B loops. Per-scene [A, B] range that a cell replays forever instead of
    // playing the whole scene. Stored per scene id in localStorage, no TTL (a
    // loop is deliberate user work, unlike a resume position), pruned to the
    // most recently touched LOOP_MAX_ENTRIES so the map can't grow forever.
    //  - LOOP_MIN_SECONDS: shortest range we accept, so a stray double-tap
    //    can't create a 100ms loop that just thrashes the decoder.
    //  - LOOP_EPSILON: timeupdate only fires ~4x/sec, so treat "at B" as
    //    slightly before B rather than waiting to overshoot it.
    //  - LOOP_RESOURCE_COOLDOWN_MS: a transcoded cell that can't seek inside
    //    its buffer has to re-request the stream at ?start=A to loop. That
    //    spawns a fresh ffmpeg each time, so bound how often one cell may do
    //    it; a loop shorter than the cooldown just overruns B a little.
    const LOOPS_KEY = 'stash-multiview-loops';
    const LOOP_MIN_SECONDS = 1;
    const LOOP_EPSILON = 0.15;
    const LOOP_RESOURCE_COOLDOWN_MS = 3000;
    const LOOP_MAX_ENTRIES = 500;

    // �"?�"? SVGs �"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?

    const ICON_VOLUME_ON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 512" aria-hidden="true"><path fill="currentColor" d="M533.6 32.5C598.5 85.2 640 165.8 640 256s-41.5 170.7-106.4 223.5c-10.3 8.4-25.4 6.8-33.8-3.5s-6.8-25.4 3.5-33.8C557.5 398.2 592 331.2 592 256s-34.5-142.2-88.7-186.2c-10.3-8.4-11.8-23.5-3.5-33.8s23.5-11.8 33.8-3.5zM473.1 107c43.2 35.2 70.9 88.9 70.9 149s-27.7 113.8-70.9 149c-10.3 8.4-25.4 6.8-33.8-3.5s-6.8-25.4 3.5-33.8C475.3 341.3 496 301.1 496 256s-20.7-85.3-53.2-111.8c-10.3-8.4-11.8-23.5-3.5-33.8s23.5-11.8 33.8-3.5zm-60.5 74.5C434.1 199.1 448 225.9 448 256s-13.9 56.9-35.4 74.5c-10.3 8.4-25.4 6.8-33.8-3.5s-6.8-25.4 3.5-33.8C393.1 284.4 400 271 400 256s-6.9-28.4-17.7-37.3c-10.3-8.4-11.8-23.5-3.5-33.8s23.5-11.8 33.8-3.5zM301.1 34.8C312.6 40 320 51.4 320 64V448c0 12.6-7.4 24-18.9 29.2s-25 3.1-34.4-5.3L131.8 352H64c-35.3 0-64-28.7-64-64V224c0-35.3 28.7-64 64-64h67.8L266.7 40.1c9.4-8.4 22.9-10.7 34.4-5.3z"/></svg>`;

    const ICON_VOLUME_OFF = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 576 512" aria-hidden="true"><path fill="currentColor" d="M301.1 34.8C312.6 40 320 51.4 320 64V448c0 12.6-7.4 24-18.9 29.2s-25 3.1-34.4-5.3L131.8 352H64c-35.3 0-64-28.7-64-64V224c0-35.3 28.7-64 64-64h67.8L266.7 40.1c9.4-8.4 22.9-10.7 34.4-5.3zM425 167l55 55 55-55c9.4-9.4 24.6-9.4 33.9 0s9.4 24.6 0 33.9l-55 55 55 55c9.4 9.4 9.4 24.6 0 33.9s-24.6 9.4-33.9 0l-55-55-55 55c-9.4 9.4-24.6 9.4-33.9 0s-9.4-24.6 0-33.9l55-55-55-55c-9.4-9.4-9.4-24.6 0-33.9s24.6-9.4 33.9 0z"/></svg>`;

    const ICON_REMOVE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512" aria-hidden="true"><path fill="currentColor" d="M342.6 150.6c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L192 210.7 86.6 105.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3L146.7 256 41.4 361.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0L192 301.3 297.4 406.6c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L237.3 256l105.3-105.4z"/></svg>`;

    const ICON_PLAY  = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512" aria-hidden="true"><path fill="currentColor" d="M73 39c-14.8-9.1-33.4-9.4-48.5-.9S0 62.6 0 80V432c0 17.4 9.4 33.4 24.5 41.9S58.2 482 73 473l288-176c14.3-8.7 23-24.2 23-41s-8.7-32.2-23-41L73 39z"/></svg>`;
    const ICON_PAUSE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 512" aria-hidden="true"><path fill="currentColor" d="M48 64C21.5 64 0 85.5 0 112V400c0 26.5 21.5 48 48 48H80c26.5 0 48-21.5 48-48V112c0-26.5-21.5-48-48-48H48zm192 0c-26.5 0-48 21.5-48 48V400c0 26.5 21.5 48 48 48h32c26.5 0 48-21.5 48-48V112c0-26.5-21.5-48-48-48H240z"/></svg>`;
    const ICON_SWEAT = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36" aria-hidden="true"><path fill="currentColor" d="M22.855.758L7.875 7.024l12.537 9.733c2.633 2.224 6.377 2.937 9.77 1.518c4.826-2.018 7.096-7.576 5.072-12.413C33.232 1.024 27.68-1.261 22.855.758zm-9.962 17.924L2.05 10.284L.137 23.529a7.993 7.993 0 0 0 2.958 7.803a8.001 8.001 0 0 0 9.798-12.65zm15.339 7.015l-8.156-4.69l-.033 9.223c-.088 2 .904 3.98 2.75 5.041a5.462 5.462 0 0 0 7.479-2.051c1.499-2.644.589-6.013-2.04-7.523z"/></svg>`;
    const ICON_DICE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M13.763,0 L2.178,0 C0.998,0 0.043,0.966 0.043,2.155 L0.043,13.845 C0.043,15.034 0.998,15.999 2.178,15.999 L13.763,15.999 C14.944,15.999 15.899,15.034 15.899,13.845 L15.899,2.155 C15.898,0.966 14.943,0 13.763,0 Z M4.002,6.153 C2.856,6.153 1.927,5.202 1.927,4.03 C1.927,2.858 2.856,1.907 4.002,1.907 C5.148,1.907 6.078,2.858 6.078,4.03 C6.078,5.202 5.148,6.153 4.002,6.153 Z M12.002,14.153 C10.856,14.153 9.927,13.202 9.927,12.03 C9.927,10.858 10.856,9.907 12.002,9.907 C13.148,9.907 14.078,10.858 14.078,12.03 C14.078,13.202 13.148,14.153 12.002,14.153 Z M8.002,10.153 C6.856,10.153 5.927,9.202 5.927,8.03 C5.927,6.858 6.856,5.907 8.002,5.907 C9.148,5.907 10.078,6.858 10.078,8.03 C10.078,9.202 9.148,10.153 8.002,10.153 Z"/></svg>`;
    const ICON_PREV = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 512" aria-hidden="true"><path fill="currentColor" d="M267.5 440.6c9.5 7.9 22.8 9.7 34.1 4.4s18.4-16.6 18.4-29V96c0-12.4-7.2-23.7-18.4-29s-24.5-3.4-34.1 4.4l-192 160L64 241V96c0-17.7-14.3-32-32-32S0 78.3 0 96V416c0 17.7 14.3 32 32 32s32-14.3 32-32V271l11.5 9.6 192 160z"/></svg>`;
    const ICON_NEXT = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 512" aria-hidden="true"><path fill="currentColor" d="M52.5 440.6c-9.5 7.9-22.8 9.7-34.1 4.4S0 428.4 0 416V96C0 83.6 7.2 72.3 18.4 67s24.5-3.4 34.1 4.4l192 160L256 241V96c0-17.7 14.3-32 32-32s32 14.3 32 32V416c0 17.7-14.3 32-32 32s-32-14.3-32-32V271l-11.5 9.6-192 160z"/></svg>`;
    const ICON_EXPAND = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 10L21 3M21 3H16.5M21 3V7.5M10 14L3 21M3 21H7.5M3 21L3 16.5"/></svg>`;
    const ICON_COMPRESS = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 3L14 10M14 10H18.5M14 10V5.5M3 21L10 14M10 14H5.5M10 14V18.5"/></svg>`;
    const ICON_LOOP = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" aria-hidden="true"><path fill="currentColor" d="M0 224c0 17.7 14.3 32 32 32s32-14.3 32-32c0-53 43-96 96-96H320v32c0 12.9 7.8 24.6 19.8 29.6s25.7 2.2 34.9-6.9l64-64c12.5-12.5 12.5-32.8 0-45.3l-64-64c-9.2-9.2-22.9-11.9-34.9-6.9S320 19.1 320 32V64H160C71.6 64 0 135.6 0 224zm512 64c0-17.7-14.3-32-32-32s-32 14.3-32 32c0 53-43 96-96 96H192V352c0-12.9-7.8-24.6-19.8-29.6s-25.7-2.2-34.9 6.9l-64 64c-12.5 12.5-12.5 32.8 0 45.3l64 64c9.2 9.2 22.9 11.9 34.9 6.9s19.8-16.6 19.8-29.6V448H352c88.4 0 160-71.6 160-160z"/></svg>`;
    // �"?�"? State �"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?

    let queue = [];
    let scenes = {};         // id ��' { id, title, streams }
    const unmutedIds = new Set();
    let openPopupId = null;
    const seekBases = new Map(); // id ��' seconds already consumed before current src load
    const filterBackedCells = new Map(); // resolved sceneId ��' original filter item

    // ── Stream URL + playhead helpers ──────────────────────────────────────
    // A transcoded stream URL carries a container extension; a direct stream
    // (/scene/ID/stream) does not. This decides whether seeking must go through
    // ?start= (transcode, where currentTime seeking is unreliable) or can use
    // video.currentTime directly (direct stream).
    function isTranscodeUrl(src) {
        return !!src && (src.includes('.webm') || src.includes('.mp4'));
    }
    // The stream URL with any ?start=/&start= offset stripped off.
    function stripStart(src) {
        return (src || '').split(/[?&]start=/)[0];
    }
    // Append a start offset to a base URL, choosing ? or & as needed.
    function withStart(baseSrc, t) {
        return baseSrc + (baseSrc.includes('?') ? '&' : '?') + 'start=' + t;
    }
    // Effective scene playhead: currentTime plus the offset already consumed
    // before the current transcode src (?start=), tracked in seekBases.
    function effectivePlayhead(video, id) {
        const src = video.getAttribute('src') || '';
        let t = video.currentTime;
        if (src.match(/[?&]start=/)) t += (seekBases.get(id) || 0);
        return t;
    }
    // Whole-scene length. The element's own duration is only trustworthy when
    // the src covers the whole scene, so Stash's metadata wins where we have it.
    function totalDuration(id, video) {
        return scenes[id]?.duration || (video && isFinite(video.duration) ? video.duration : null);
    }
    // The buffering spinner overlay, idempotent per cell.
    function showSpinner(cell) {
        if (!cell || cell.querySelector('.mv-loading')) return;
        const s = document.createElement('div');
        s.className = 'mv-loading';
        s.innerHTML = '<div class="mv-spinner"></div>';
        cell.appendChild(s);
    }
    function hideSpinner(cell) {
        cell?.querySelector('.mv-loading')?.remove();
    }

    // �"?�"? Web Audio �"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?

    let audioCtx = null;
    const cellGains = new Map(); // id ��' GainNode

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
            gain.gain.value = playerSettings.defaultVolume;
            source.connect(gain);
            gain.connect(ctx.destination);
            cellGains.set(id, gain);
        } catch (e) {
            // Silently ignore �?" audio still works via video.volume fallback
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

    // �"?�"? Queue �"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?

    function getQueue() {
        try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
        catch { return []; }
    }

    function saveQueue(q) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(q));
    }

    // ── Shared queue source of truth: Stash plugin config ────────────
    // The queue is shared with the Stash scene-list plugin, binge web,
    // binge-iOS, and multiview-ios. Config is authoritative; localStorage
    // is a local cache. The player seeds the cache from config on load,
    // polls it, and writes its own changes (remove tile / roulette) back
    // to config via read-modify-write so it never clobbers a concurrent
    // change from another client.
    async function fetchConfigQueue() {
        const r = await fetch('/graphql', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: '{ configuration { plugins } }' })
        });
        const j = await r.json();
        const raw = j?.data?.configuration?.plugins?.multiView?.queue;
        try { const a = JSON.parse(raw || '[]'); return Array.isArray(a) ? a : []; }
        catch { return []; }
    }

    async function writeConfigQueue(q) {
        await fetch('/graphql', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                query: 'mutation($input: Map!) { configurePlugin(plugin_id: "multiView", input: $input) }',
                variables: { input: { queue: JSON.stringify(q) } }
            })
        });
    }

    // Number of in-flight config writes — the poll skips while > 0 so it
    // can't seed the cache from a not-yet-committed config and revert our
    // own just-made change.
    let pendingConfigWrites = 0;

    // Read-modify-write the live config queue (one pass: read fresh, apply
    // mutator, write — so a concurrent add elsewhere is preserved). Also
    // mirrors the result into the local cache.
    async function mutateConfigQueue(mutator) {
        pendingConfigWrites++;
        try {
            let items;
            try { items = await fetchConfigQueue(); }
            catch { return; }
            const next = mutator(items.slice());
            if (next === null) { saveQueue(items); return; }
            try { await writeConfigQueue(next); } catch { return; }
            saveQueue(next);
        } finally { pendingConfigWrites--; }
    }

    // Seed/refresh the local cache from config. Returns true if the cache
    // changed (so the caller can re-resolve + re-render the wall).
    async function seedCacheFromConfig() {
        try {
            const q = await fetchConfigQueue();
            const next = JSON.stringify(q);
            if (next !== localStorage.getItem(STORAGE_KEY)) {
                localStorage.setItem(STORAGE_KEY, next);
                return true;
            }
        } catch { /* offline — keep cache */ }
        return false;
    }

    // Re-resolve the wall from the current cache (shared by the storage
    // event + the config poll). Preserves currently-playing filter slots.
    function resyncFromCache() {
        resolveQueuePreserving(getQueue()).then(resolved => {
            queue = resolved;
            loadSceneMeta(queue).then(render);
        });
    }

    // Mirrors Stash's translateJSON (ui/v2.5/src/models/list-filter/filter.ts):
    // c-params are JSON with `{` ↔ `(` substitution outside strings, and a
    // proper escape flag for `\` so `\\"` doesn't confuse the parser.
    function parseCParam(raw) {
        let result = '';
        let inString = false;
        let escape = false;
        for (let i = 0; i < raw.length; i++) {
            const ch = raw[i];
            if (escape) { escape = false; result += ch; continue; }
            if (inString && ch === '\\') { escape = true; result += ch; continue; }
            if (ch === '"') { inString = !inString; result += ch; continue; }
            if (!inString && ch === '(') { result += '{'; continue; }
            if (!inString && ch === ')') { result += '}'; continue; }
            result += ch;
        }
        return JSON.parse(result);
    }

    // Stash UI stores some enum criteria as their display string in URL/state
    // but sends the GraphQL enum to the API. We mirror those mappings here.
    const RESOLUTION_TO_ENUM = {
        '144p': 'VERY_LOW', '240p': 'LOW', '360p': 'R360P', '480p': 'STANDARD',
        '540p': 'WEB_HD', '720p': 'STANDARD_HD', '1080p': 'FULL_HD', '1440p': 'QUAD_HD',
        '4k': 'FOUR_K', '5k': 'FIVE_K', '6k': 'SIX_K', '7k': 'SEVEN_K',
        '8k': 'EIGHT_K', 'Huge': 'HUGE'
    };
    const ORIENTATION_TO_ENUM = {
        Landscape: 'LANDSCAPE', Portrait: 'PORTRAIT', Square: 'SQUARE'
    };

    function mapResolution(v) {
        if (v == null) return undefined;
        if (RESOLUTION_TO_ENUM[v]) return RESOLUTION_TO_ENUM[v];
        // Case-insensitive fallback (matches Stash's stringToResolution behavior)
        const lower = String(v).toLowerCase();
        for (const k of Object.keys(RESOLUTION_TO_ENUM)) {
            if (k.toLowerCase() === lower) return RESOLUTION_TO_ENUM[k];
        }
        return undefined;
    }

    function mapOrientation(v) {
        if (v == null) return undefined;
        if (ORIENTATION_TO_ENUM[v]) return ORIENTATION_TO_ENUM[v];
        const upper = String(v).toUpperCase();
        if (upper === 'LANDSCAPE' || upper === 'PORTRAIT' || upper === 'SQUARE') return upper;
        return undefined;
    }

    function applySceneFilterCriterion(sf, type, modifier, value) {
        const isNullMod = modifier === 'IS_NULL' || modifier === 'NOT_NULL';

        // Plain multi (items/excluded) — MultiCriterionInput
        if (['performers', 'movies', 'galleries'].includes(type)) {
            sf[type] = {
                value:    (value?.items    || []).map(i => i.id),
                excludes: (value?.excluded || []).map(i => i.id),
                modifier
            };
            return;
        }
        // Hierarchical multi (depth) — HierarchicalMultiCriterionInput
        if (['tags', 'studios', 'groups', 'performer_tags'].includes(type)) {
            sf[type] = {
                value:    (value?.items    || []).map(i => i.id),
                excludes: (value?.excluded || []).map(i => i.id),
                modifier,
                depth:    value?.depth ?? 0
            };
            return;
        }
        // String criteria — StringCriterionInput (value: String!)
        if (['path', 'title', 'code', 'details', 'director', 'url', 'captions',
             'video_codec', 'audio_codec', 'oshash', 'checksum', 'phash'].includes(type)) {
            sf[type] = { value: isNullMod ? '' : (value ?? ''), modifier };
            return;
        }
        // Numeric — IntCriterionInput (value: Int!)
        if (['id', 'rating100', 'o_counter', 'play_count', 'play_duration', 'duration',
             'framerate', 'bitrate', 'interactive_speed', 'resume_time', 'file_count',
             'performer_age', 'performer_count', 'tag_count', 'stash_id_count'].includes(type)) {
            sf[type] = isNullMod
                ? { value: 0, modifier }
                : { value: value?.value ?? 0, value2: value?.value2, modifier };
            return;
        }
        // Date/Timestamp — value: String!
        if (['date', 'created_at', 'updated_at', 'last_played_at'].includes(type)) {
            sf[type] = isNullMod
                ? { value: '', modifier }
                : { value: value?.value ?? '', value2: value?.value2, modifier };
            return;
        }
        // Plain booleans — no modifier wrapper in SceneFilterType
        if (['organized', 'performer_favorite', 'interactive'].includes(type)) {
            sf[type] = value === 'true' || value === true;
            return;
        }
        // Stash treats these as plain strings (not criterion objects) in
        // SceneFilterType — the modifier is discarded.
        if (type === 'has_markers' || type === 'is_missing') {
            sf[type] = String(value ?? '');
            return;
        }
        // Resolution: friendly "1080p" → enum FULL_HD
        if (type === 'resolution') {
            const enumVal = mapResolution(value);
            if (enumVal) sf.resolution = { value: enumVal, modifier };
            return;
        }
        // Orientation: ["Landscape","Square"] → ["LANDSCAPE","SQUARE"];
        // OrientationCriterionInput only carries `value`, no modifier.
        if (type === 'orientation') {
            const arr = Array.isArray(value) ? value : (value != null ? [value] : []);
            const mapped = arr.map(mapOrientation).filter(Boolean);
            if (mapped.length) sf.orientation = { value: mapped };
            return;
        }
        // PhashDistanceCriterionInput { value: String!, modifier, distance? }
        if (type === 'phash_distance') {
            sf.phash_distance = isNullMod
                ? { value: '', modifier }
                : { value: value?.value ?? '', modifier, distance: value?.distance };
            return;
        }
        // DuplicationCriterionInput — flat object, no modifier
        if (type === 'duplicated' && value && typeof value === 'object') {
            sf.duplicated = {
                duplicated: value.duplicated,
                distance:   value.distance,
                phash:      value.phash,
                url:        value.url,
                stash_id:   value.stash_id,
                title:      value.title
            };
            return;
        }
        // StashIDCriterionInput — value uses camelCase stashID in c-param;
        // GraphQL expects stash_id. For IS_NULL/NOT_NULL with no endpoint,
        // Stash omits the value entirely.
        if (type === 'stash_id_endpoint') {
            sf.stash_id_endpoint = (isNullMod && !value?.endpoint)
                ? { modifier }
                : { endpoint: value?.endpoint || undefined,
                    stash_id: value?.stashID || value?.stash_id || undefined,
                    modifier };
            return;
        }
        if (type === 'stash_ids_endpoint') {
            sf.stash_ids_endpoint = (isNullMod && !value?.endpoint)
                ? { modifier }
                : { endpoint: value?.endpoint || undefined,
                    stash_ids: value?.stashIDs || value?.stash_ids || undefined,
                    modifier };
            return;
        }
        // FolderCriterion has type "folder" in the c-param but writes into
        // files_filter.parent_folder on SceneFilterType (see Stash's
        // criteria/folder.ts:applyToCriterionInput). Value shape is the
        // hierarchical {items, excluded, depth}.
        if (type === 'folder') {
            sf.files_filter = sf.files_filter || {};
            sf.files_filter.parent_folder = {
                value:    (value?.items    || []).map(i => i.id),
                excludes: (value?.excluded || []).map(i => i.id),
                modifier,
                depth:    value?.depth ?? 0
            };
            return;
        }
        // CustomFieldsCriterion has its own toQueryParams: value is an
        // array of CustomFieldCriterionInput {field, modifier, value} and
        // there's no top-level modifier. Pass through verbatim.
        if (type === 'custom_fields') {
            sf.custom_fields = Array.isArray(value) ? value : [];
            return;
        }
        // Unknown criterion — silently ignored. AND/OR/NOT are not produced
        // by Stash's filter UI so they should never appear here.
    }

    function buildSceneFilter(f) {
        const sf = {};
        // Mirror Stash's entity-scope filter hooks (src/core/{performers,
        // tags,studios,groups}.ts). depth: -1 matches the default
        // `showAllDetails`/`showChildContent` toggle being on, which
        // includes scenes from descendants. INCLUDES_ALL for performers
        // and tags, INCLUDES for studios and groups — same as upstream.
        if (f.performerId) sf.performers = { value: [f.performerId], excludes: [], modifier: 'INCLUDES_ALL' };
        if (f.tagId)       sf.tags       = { value: [f.tagId],       excludes: [], modifier: 'INCLUDES_ALL', depth: -1 };
        if (f.studioId)    sf.studios    = { value: [f.studioId],    excludes: [], modifier: 'INCLUDES',     depth: -1 };
        if (f.groupId)     sf.groups     = { value: [f.groupId],     excludes: [], modifier: 'INCLUDES',     depth: -1 };
        for (const raw of (f.c || [])) {
            try {
                const { type, modifier, value } = parseCParam(raw);
                applySceneFilterCriterion(sf, type, modifier, value);
            } catch {}
        }
        return Object.keys(sf).length ? sf : undefined;
    }

    // excludeId: fetch 3 candidates so we can skip the current scene when advancing
    async function resolveFilterSlot(item, excludeId = null) {
        try {
            const f = item.filter || {};
            const findFilter = { per_page: excludeId ? 3 : 1, sort: 'random' };
            if (f.q) findFilter.q = f.q;
            const res = await fetch('/graphql', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    query: `query($filter: FindFilterType, $scene_filter: SceneFilterType) { findScenes(filter: $filter, scene_filter: $scene_filter) { scenes { id } } }`,
                    variables: { filter: findFilter, scene_filter: buildSceneFilter(f) }
                })
            });
            const data = await res.json();
            const list = data?.data?.findScenes?.scenes || [];
            const pick = excludeId ? (list.find(s => String(s.id) !== excludeId) || list[0]) : list[0];
            return pick ? String(pick.id) : null;
        } catch { return null; }
    }

    async function resolveQueue(rawQueue) {
        filterBackedCells.clear();
        const resolved = await Promise.all(
            rawQueue.map(async item => {
                if (typeof item === 'string') return item;
                const id = await resolveFilterSlot(item);
                if (id) filterBackedCells.set(id, item);
                return id;
            })
        );
        return resolved.filter(Boolean);
    }

    // Like resolveQueue but reuses currently-playing IDs for existing filter slots
    // so adding a scene from Stash doesn't interrupt videos already playing.
    async function resolveQueuePreserving(rawQueue) {
        const available = new Map();
        for (const [id, item] of filterBackedCells) {
            const key = JSON.stringify(item.filter || {});
            if (!available.has(key)) available.set(key, []);
            available.get(key).push(id);
        }
        const newFilterBackedCells = new Map();
        const resolved = await Promise.all(
            rawQueue.map(async item => {
                if (typeof item === 'string') return item;
                const key = JSON.stringify(item.filter || {});
                const pool = available.get(key);
                if (pool && pool.length > 0) {
                    const id = pool.shift();
                    newFilterBackedCells.set(id, item);
                    return id;
                }
                const id = await resolveFilterSlot(item);
                if (id) newFilterBackedCells.set(id, item);
                return id;
            })
        );
        filterBackedCells.clear();
        for (const [k, v] of newFilterBackedCells) filterBackedCells.set(k, v);
        return resolved.filter(Boolean);
    }

    function removeScene(id) {
        id = String(id);
        const idx = queue.indexOf(id);
        if (idx === -1) return;
        queue.splice(idx, 1);
        const raw = getQueue();
        if (idx < raw.length) raw.splice(idx, 1);
        saveQueue(raw);
        // Persist the removal to config (RMW) so other clients see it.
        // A scene-id string removes by value (robust against a changed
        // queue); a filter-backed cell drops the slot at the same index.
        mutateConfigQueue(items => {
            const k = items.indexOf(id);
            if (k >= 0) { items.splice(k, 1); return items; }
            if (idx < items.length && typeof items[idx] === 'object') {
                items.splice(idx, 1); return items;
            }
            return null;
        });
        unmutedIds.delete(String(id));
        filterBackedCells.delete(String(id));
        disconnectAudio(id);
        seekBases.delete(id);
        clearResumeTime(id);
        render();
    }

    async function advanceFilterCell(id) {
        const filterItem = filterBackedCells.get(id);
        if (!filterItem) return;
        const newId = await resolveFilterSlot(filterItem, id);
        if (!newId || newId === id) {
            const cell = document.querySelector(`.mv-cell[data-scene-id="${id}"]`);
            const video = cell?.querySelector('video');
            if (video) seekToStart(id, video);
            return;
        }
        filterBackedCells.delete(id);
        filterBackedCells.set(newId, filterItem);
        if (unmutedIds.has(id)) { unmutedIds.delete(id); unmutedIds.add(newId); }
        const qIdx = queue.indexOf(id);
        if (qIdx !== -1) queue[qIdx] = newId;
        await loadSceneMeta([newId]);
        render();
    }

    function seekToStart(id, video) {
        const src = video.getAttribute('src');
        const wasPlaying = !video.paused;
        if (isTranscodeUrl(src)) {
            seekBases.set(id, 0);
            video.src = stripStart(src);
        } else {
            video.currentTime = 0;
        }
        if (wasPlaying || video.autoplay) video.play();
    }

    // ── Seek modifiers ─────────────────────────────────────────────────────
    // Two modifier roles, both user-selectable in Settings. They are roles
    // rather than bindings because the keybind format holds a single bare key
    // (see normalizeKey) and has nowhere to put a modifier.
    //
    //  - fine: shrink the seek step, and scale down seekbar drag travel.
    //  - allCells: apply the seek to every cell instead of the hovered one.
    //
    // Ctrl is offered but not the default for either: Ctrl+wheel is the
    // browser's zoom gesture, and while our non-passive wheel listener could
    // preventDefault it, hijacking a system gesture is not a good default.
    const SEEK_MODIFIERS = [
        { value: 'none',  label: 'None' },
        { value: 'shift', label: 'Shift' },
        { value: 'alt',   label: 'Alt' },
        { value: 'ctrl',  label: 'Ctrl' },
    ];
    // How much a fine drag scales pointer travel. 1/5 turns a 4x4 cell from
    // roughly 5.6 seconds per pixel into roughly 1.
    const FINE_DRAG_GAIN = 0.2;
    const SEEK_STEP_MAX = 120;

    function modifierHeld(e, role) {
        if (!e || !role || role === 'none') return false;
        if (role === 'shift') return !!e.shiftKey;
        if (role === 'alt') return !!e.altKey;
        if (role === 'ctrl') return !!(e.ctrlKey || e.metaKey);
        return false;
    }
    const isFineSeek = e => modifierHeld(e, playerSettings.fineModifier);
    const isAllCellsSeek = e => modifierHeld(e, playerSettings.allCellsModifier);
    const seekStepFor = e => (isFineSeek(e) ? playerSettings.seekStepFine : playerSettings.seekStep);

    // Scroll-wheel skip. Each scroll event accumulates a delta; the actual
    // seek fires after a short idle so rapid scrolling on transcoded streams
    // doesn't trigger one reload per tick. `extraDelay` staggers a grid-wide
    // seek so 16 cells don't all re-request their transcode on the same tick.
    const wheelPending = new Map(); // id -> { delta, timeout }

    function scheduleWheelSeek(id, video, delta, extraDelay = 0) {
        let pending = wheelPending.get(id);
        if (pending) {
            clearTimeout(pending.timeout);
            pending.delta += delta;
        } else {
            pending = { delta };
            wheelPending.set(id, pending);
        }
        pending.timeout = setTimeout(() => {
            const d = pending.delta;
            wheelPending.delete(id);
            applyWheelSeek(id, video, d);
        }, 150 + extraDelay);
    }

    // Point a transcoded cell at a new src without changing whether it is
    // playing. Cells are created with autoplay and never lose it, so a fresh
    // src restarts playback on its own and `|| video.autoplay` resumes it
    // besides. That breaks the reason to seek while paused at all: pause, walk
    // the playhead onto the frame you want, mark it. So drop autoplay while a
    // cell is deliberately paused and re-arm it the moment it plays again.
    //
    // Scoped to user-driven seeks. Stall recovery keeps its own resume rule.
    function resourceKeepingPlayState(video, src) {
        const wasPlaying = !video.paused;
        if (!wasPlaying && video.autoplay) {
            video.autoplay = false;
            video.addEventListener('play', () => { video.autoplay = true; }, { once: true });
        }
        video.src = src;
        if (wasPlaying) video.play().catch(() => {});
    }

    // Move every cell by the same amount. Each transcoded cell has to re-request
    // its stream, so a grid-wide seek is up to 16 fresh encodes: the per-cell
    // debounce already collapses a burst of input into one seek each, and the
    // stagger keeps those from all landing on the same tick.
    const SEEK_ALL_STAGGER_MS = 60;

    function seekAllCells(delta) {
        document.querySelectorAll('.mv-cell').forEach((cell, i) => {
            const id = cell.dataset.sceneId;
            const video = cell.querySelector('video');
            if (id && video) scheduleWheelSeek(id, video, delta, i * SEEK_ALL_STAGGER_MS);
        });
    }

    function applyWheelSeek(id, video, delta) {
        const duration = totalDuration(id, video);
        if (!duration) return;

        const currentSrc = video.getAttribute('src');
        let target = Math.max(0, Math.min(duration - 0.5, effectivePlayhead(video, id) + delta));
        // A looping cell plays a range, so keep a skip inside that range rather
        // than landing outside it and being snapped back by the loop enforcer.
        const loop = getLoop(id);
        if (loop && loop.b > loop.a) target = Math.max(loop.a, Math.min(loop.b - LOOP_EPSILON, target));

        if (isTranscodeUrl(currentSrc)) {
            seekBases.set(id, target);
            showSpinner(document.querySelector(`.mv-cell[data-scene-id="${id}"]`));
            resourceKeepingPlayState(video, withStart(stripStart(currentSrc), target));
        } else {
            video.currentTime = target;
        }

        // Reflect in the seekbar immediately so the user sees feedback
        // before the (possibly slow) transcode reload completes.
        const fill = document.querySelector(`.mv-cell[data-scene-id="${id}"] .mv-seekbar-fill`);
        if (fill) fill.style.transform = 'scaleX(' + (target / duration) + ')';
    }

    // �"?�"? Stream selection �"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?

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

    // �"?�"? Settings �"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?

    const QUALITY_OPTIONS = [
        { value: 'direct',   label: 'Direct Stream' },
        { value: 'webm1080', label: '1080p (WebM)' },
        { value: 'webm720',  label: '720p (WebM)'  },
        { value: 'webm480',  label: '480p (WebM)'  },
        { value: 'webm360',  label: '360p (WebM)'  },
        { value: 'mp41080',  label: '1080p (MP4)'  },
        { value: 'mp4720',   label: '720p (MP4)'   },
        { value: 'mp4480',   label: '480p (MP4)'   },
        { value: 'mp4360',   label: '360p (MP4)'   },
    ];

    const GRID_ROWS = [
        { key: 1,  label: '1 video'   },
        { key: 2,  label: '2 videos'  },
        { key: 4,  label: '4 videos'  },
        { key: 6,  label: '6 videos'  },
        { key: 9,  label: '9 videos'  },
        { key: 12, label: '12 videos' },
        { key: 16, label: '16 videos' },
    ];

    const DEFAULT_QUALITY = { 1: 'webm1080', 2: 'webm720', 4: 'webm720', 6: 'webm480', 9: 'webm480', 12: 'webm360', 16: 'webm360' };

    // Rebindable keyboard shortcuts. `run` is invoked when the bound key fires;
    // it references module functions that are hoisted/defined by run() time.
    // Stored keys are normalized (single letters lower-cased, ' ' -> 'Space').
    // Rebindable shortcuts. A binding string is either a normalized keyboard key
    // (single letters lower-cased, ' ' -> 'Space') or a mouse button ('Mouse<n>'
    // where n is event.button: 1 middle, 2 right, 3 back, 4 forward). `run` gets
    // the originating event so cell-scoped actions can find the target.
    // The "All" actions live as top-bar buttons; shortcuts instead target the
    // single cell under the cursor so a mouse button can act on one panel.
    const KEYBIND_ACTIONS = [
        { id: 'playPauseHover', label: 'Play / Pause (hovered)',  run: e => playPauseHoveredCell(e) },
        { id: 'muteHover',      label: 'Mute / Unmute (hovered)', run: e => muteHoveredCell(e) },
        { id: 'oHover',         label: 'O counter (hovered)',     run: e => oHoveredCell(e) },
        { id: 'loopSetA',       label: 'Loop: set A (hovered)',   run: e => setLoopMarkOnHovered(e, 'a') },
        { id: 'loopSetB',       label: 'Loop: set B (hovered)',   run: e => setLoopMarkOnHovered(e, 'b') },
        { id: 'loopClear',      label: 'Loop: clear (hovered)',   run: e => clearLoopOnHovered(e) },
        { id: 'seekBack',       label: 'Seek back (hovered)',     run: e => nudgeHovered(e, -1) },
        { id: 'seekForward',    label: 'Seek forward (hovered)',  run: e => nudgeHovered(e, 1) },
        { id: 'focus',          label: 'Toggle Focus Mode',       run: () => toggleFocusMode() },
        { id: 'fullscreen',     label: 'Toggle Full Screen',      run: () => toggleFullscreen() },
        { id: 'roulette',       label: 'Open Roulette',           run: () => openMenuPanel() },
    ];
    const DEFAULT_KEYBINDS = { playPauseHover: '', muteHover: 'Mouse1', oHover: '', loopSetA: 'a', loopSetB: 'b', loopClear: 'l', seekBack: 'ArrowLeft', seekForward: 'ArrowRight', focus: 'f', fullscreen: '', roulette: '' };
    // Targets where a non-left button keeps its native meaning, so a mouse
    // shortcut must NOT fire over them: links (middle-click opens a new tab) and
    // the settings/menu/volume panels (which contain their own controls). NOTE:
    // plain buttons are deliberately NOT excluded — the big play button covers a
    // cell's center, and middle/right-clicking it should still fire the shortcut
    // (left-clicks are ignored by the dispatcher via e.button === 0).
    const MOUSE_BIND_EXCLUDE = 'a, .mv-vol-popup, #mv-settings-modal, #mv-menu-panel';
    const MOUSE_LABELS = { Mouse0: 'Left Click', Mouse1: 'Middle Click', Mouse2: 'Right Click', Mouse3: 'Mouse Back', Mouse4: 'Mouse Forward' };

    // The cell a shortcut should act on: the click target's cell for mouse
    // bindings, else whatever cell the pointer is hovering (keyboard bindings).
    function hoveredCell(e) {
        return (e && e.target && e.target.closest && e.target.closest('.mv-cell'))
            || document.querySelector('.mv-cell:hover');
    }
    function muteHoveredCell(e) {
        const cell = hoveredCell(e);
        if (cell) toggleAudio(cell.dataset.sceneId);
    }
    function oHoveredCell(e) {
        const cell = hoveredCell(e);
        if (cell) incrementO(cell.dataset.sceneId);
    }
    function playPauseHoveredCell(e) {
        const cell = hoveredCell(e);
        const v = cell && cell.querySelector('video');
        if (!v) return;
        if (v.paused) v.play().catch(() => {}); else v.pause();
    }
    function setLoopMarkOnHovered(e, which) {
        const cell = hoveredCell(e);
        const id = cell && cell.dataset.sceneId;
        const video = cell && cell.querySelector('video');
        // Filter/roulette cells swap scenes under the loop, so they don't take one.
        if (!id || !video || filterBackedCells.has(id)) return;
        const loop = setLoopPoint(id, which, effectivePlayhead(video, id), sceneDuration(id, video));
        if (loop) applyLoopState(id, video);
    }
    // Step the playhead by the current seek step. Works while paused, which is
    // the point: pause, walk the playhead onto the frame you want, mark it.
    function nudgeHovered(e, dir) {
        const delta = dir * seekStepFor(e);
        if (isAllCellsSeek(e)) { seekAllCells(delta); return; }
        const cell = hoveredCell(e);
        const id = cell && cell.dataset.sceneId;
        const video = cell && cell.querySelector('video');
        if (!id || !video) return;
        scheduleWheelSeek(id, video, delta);
    }
    function clearLoopOnHovered(e) {
        const cell = hoveredCell(e);
        const id = cell && cell.dataset.sceneId;
        const video = cell && cell.querySelector('video');
        if (!id || !getLoop(id)) return;
        clearLoop(id);
        if (video) applyLoopState(id, video);
    }

    function normalizeKey(k) {
        if (!k) return '';
        if (k === ' ' || k === 'Spacebar') return 'Space';
        return k.length === 1 ? k.toLowerCase() : k;
    }
    const KEY_LABELS = { ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down' };
    function keyLabel(k) {
        if (!k) return 'Unbound';
        if (MOUSE_LABELS[k]) return MOUSE_LABELS[k];
        if (KEY_LABELS[k]) return KEY_LABELS[k];
        if (k.startsWith('Mouse')) return 'Mouse ' + k.slice(5);
        return k.length === 1 ? k.toUpperCase() : k;
    }
    // Actions that read the seek modifiers, so a chord using one is meant for
    // us rather than for the browser.
    const SEEK_ACTION_IDS = ['seekBack', 'seekForward'];
    function isSeekChord(e, binding) {
        if (!binding || !(isFineSeek(e) || isAllCellsSeek(e))) return false;
        return SEEK_ACTION_IDS.some(id => playerSettings.keybinds[id] === binding);
    }
    // Fire the action bound to `binding`, if any. Returns true if one ran.
    function runBinding(binding, e) {
        if (!binding) return false;
        for (const action of KEYBIND_ACTIONS) {
            if (playerSettings.keybinds[action.id] === binding) {
                e.preventDefault();
                action.run(e);
                return true;
            }
        }
        return false;
    }
    let keybindCaptureActive = false;

    // Saved bindings win over the defaults. A default introduced by a NEWER
    // version must not steal a key the user already bound to something else, so
    // a colliding default is dropped rather than leaving two actions on one key
    // (runBinding would silently fire whichever comes first in KEYBIND_ACTIONS).
    function mergeKeybinds(saved = {}) {
        const merged = { ...DEFAULT_KEYBINDS, ...saved };
        const taken = new Set(Object.values(saved).filter(Boolean));
        for (const id of Object.keys(merged)) {
            if (id in saved) continue;
            if (merged[id] && taken.has(merged[id])) merged[id] = '';
        }
        return merged;
    }

    function loadPlayerSettings(saved = {}) {
        return {
            directPlay: saved.directPlay ?? false,
            quality: { ...DEFAULT_QUALITY, ...(saved.quality || {}) },
            focusMode: saved.focusMode ?? false,
            wheelSeek: saved.wheelSeek ?? false,
            invertWheelSeek: saved.invertWheelSeek ?? false,
            // Initial gain applied to every cell (0–2 → 0–200%). sashi: 100% is
            // too loud by default, so this is user-tunable. Cells still start
            // muted; this is the level the gain jumps to when first unmuted.
            defaultVolume: Math.max(0, Math.min(2, saved.defaultVolume ?? 1.0)),
            // Seek steps shared by the wheel and the nudge shortcuts.
            seekStep: clampStep(saved.seekStep, 5),
            seekStepFine: clampStep(saved.seekStepFine, 1),
            fineModifier: pickModifier(saved.fineModifier, 'shift'),
            // Alt rather than Ctrl by default; Ctrl+wheel is browser zoom.
            allCellsModifier: pickModifier(saved.allCellsModifier, 'alt'),
            keybinds: mergeKeybinds(saved.keybinds || {})
        };
    }

    function clampStep(v, fallback) {
        const n = Number(v);
        return isFinite(n) && n > 0 ? Math.min(SEEK_STEP_MAX, n) : fallback;
    }
    function pickModifier(v, fallback) {
        return SEEK_MODIFIERS.some(m => m.value === v) ? v : fallback;
    }

    let playerSettings = loadPlayerSettings();

    function savePlayerSettings() {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(playerSettings));
    }

    function applyFocusMode(enabled) {
        document.body.classList.toggle('mv-focus', enabled);
        document.getElementById('mv-focus-btn')?.classList.toggle('active', enabled);
        if (enabled) {
            applyJustifiedLayout();
        } else {
            clearJustifiedLayout();
            detectAndApplyOrientation();
        }
    }

    function toggleFocusMode() {
        playerSettings.focusMode = !playerSettings.focusMode;
        savePlayerSettings();
        applyFocusMode(playerSettings.focusMode);
    }

    function applyFullscreenIcon() {
        const fs = !!document.fullscreenElement;
        const btn = document.getElementById('mv-fullscreen-btn');
        if (!btn) return;
        btn.innerHTML = fs ? ICON_COMPRESS : ICON_EXPAND;
        btn.title = fs ? 'Exit Full Screen' : 'Full Screen';
        btn.classList.toggle('active', fs);
    }

    function toggleFullscreen() {
        if (document.fullscreenElement) {
            document.exitFullscreen?.();
        } else {
            document.documentElement.requestFullscreen?.().catch(() => {});
        }
    }

    function openSettingsModal() {
        if (document.getElementById('mv-settings-modal')) return;

        const overlay = document.createElement('div');
        overlay.id = 'mv-settings-modal';

        const card = document.createElement('div');
        card.className = 'mv-settings-card';

        // Header
        const header = document.createElement('div');
        header.className = 'mv-settings-header';
        const titleEl = document.createElement('span');
        titleEl.className = 'mv-settings-title';
        titleEl.textContent = 'Player Settings';
        const closeBtn = document.createElement('button');
        closeBtn.className = 'mv-settings-close';
        closeBtn.innerHTML = ICON_REMOVE;
        closeBtn.title = 'Close';
        closeBtn.addEventListener('click', closeSettingsModal);
        header.append(titleEl, closeBtn);

        // Direct play row
        const dpRow = document.createElement('div');
        dpRow.className = 'mv-settings-dp-row';
        const dpText = document.createElement('div');
        dpText.className = 'mv-settings-dp-text';
        const dpLabel = document.createElement('span');
        dpLabel.className = 'mv-settings-dp-label';
        dpLabel.textContent = 'Direct Play';
        const dpDesc = document.createElement('span');
        dpDesc.className = 'mv-settings-dp-desc';
        dpDesc.textContent = 'Stream the original file without transcoding. Recommended for NAS or low-powered servers.';
        dpText.append(dpLabel, dpDesc);
        const dpToggle = document.createElement('input');
        dpToggle.type = 'checkbox';
        dpToggle.className = 'mv-toggle';
        dpToggle.checked = playerSettings.directPlay;
        dpRow.append(dpText, dpToggle);

        // Scroll-wheel seek row
        const swRow = document.createElement('div');
        swRow.className = 'mv-settings-dp-row';
        const swText = document.createElement('div');
        swText.className = 'mv-settings-dp-text';
        const swLabel = document.createElement('span');
        swLabel.className = 'mv-settings-dp-label';
        swLabel.textContent = 'Scroll-Wheel Seek';
        const swDesc = document.createElement('span');
        swDesc.className = 'mv-settings-dp-desc';
        swDesc.textContent = 'Scroll the mouse wheel over a video to skip ±5 seconds.';
        swText.append(swLabel, swDesc);
        const swToggle = document.createElement('input');
        swToggle.type = 'checkbox';
        swToggle.className = 'mv-toggle';
        swToggle.checked = playerSettings.wheelSeek;
        swToggle.addEventListener('change', () => {
            playerSettings.wheelSeek = swToggle.checked;
            savePlayerSettings();
            invToggle.disabled = !swToggle.checked;
            invRow.classList.toggle('mv-settings-disabled', !swToggle.checked);
        });
        swRow.append(swText, swToggle);

        // Invert scroll-seek direction row (only meaningful when seek is on)
        const invRow = document.createElement('div');
        invRow.className = 'mv-settings-dp-row';
        const invText = document.createElement('div');
        invText.className = 'mv-settings-dp-text';
        const invLabel = document.createElement('span');
        invLabel.className = 'mv-settings-dp-label';
        invLabel.textContent = 'Invert Scroll-Seek Direction';
        const invDesc = document.createElement('span');
        invDesc.className = 'mv-settings-dp-desc';
        invDesc.textContent = 'Off: scroll up = forward. On: scroll down = forward.';
        invText.append(invLabel, invDesc);
        const invToggle = document.createElement('input');
        invToggle.type = 'checkbox';
        invToggle.className = 'mv-toggle';
        invToggle.checked = playerSettings.invertWheelSeek;
        invToggle.disabled = !playerSettings.wheelSeek;
        invToggle.addEventListener('change', () => {
            playerSettings.invertWheelSeek = invToggle.checked;
            savePlayerSettings();
        });
        invRow.append(invText, invToggle);
        if (!playerSettings.wheelSeek) invRow.classList.add('mv-settings-disabled');

        // Default volume row
        const volRow = document.createElement('div');
        volRow.className = 'mv-settings-dp-row';
        const volText = document.createElement('div');
        volText.className = 'mv-settings-dp-text';
        const volLbl = document.createElement('span');
        volLbl.className = 'mv-settings-dp-label';
        volLbl.textContent = 'Default Volume';
        const volDesc = document.createElement('span');
        volDesc.className = 'mv-settings-dp-desc';
        volDesc.textContent = 'Starting volume for each video when unmuted.';
        volText.append(volLbl, volDesc);
        const volWrap = document.createElement('div');
        volWrap.className = 'mv-settings-vol-wrap';
        const volVal = document.createElement('span');
        volVal.className = 'mv-settings-vol-val';
        volVal.textContent = Math.round(playerSettings.defaultVolume * 100) + '%';
        const volSlider = document.createElement('input');
        volSlider.type = 'range';
        volSlider.className = 'mv-settings-vol-slider';
        volSlider.min = 0;
        volSlider.max = 2;
        volSlider.step = 0.05;
        volSlider.value = playerSettings.defaultVolume;
        volSlider.title = 'Default volume (0–200%)';
        volSlider.addEventListener('input', () => {
            const v = parseFloat(volSlider.value);
            playerSettings.defaultVolume = v;
            volVal.textContent = Math.round(v * 100) + '%';
            savePlayerSettings();
        });
        volWrap.append(volVal, volSlider);
        volRow.append(volText, volWrap);

        // Saved A/B loops row. Loops are deliberate work with no expiry, so
        // there has to be one obvious place to wipe them all.
        const loopRow = document.createElement('div');
        loopRow.className = 'mv-settings-dp-row';
        const loopText = document.createElement('div');
        loopText.className = 'mv-settings-dp-text';
        const loopLbl = document.createElement('span');
        loopLbl.className = 'mv-settings-dp-label';
        loopLbl.textContent = 'Saved A/B Loops';
        const loopDesc = document.createElement('span');
        loopDesc.className = 'mv-settings-dp-desc';
        const describeLoops = () => {
            const n = loopCount();
            loopDesc.textContent = n
                ? `${n} scene${n > 1 ? 's' : ''} loop a set range. Mark them per cell with the loop button or the A/B shortcuts.`
                : 'No loops set. Mark a range on a cell with the loop button or the A/B shortcuts.';
        };
        describeLoops();
        loopText.append(loopLbl, loopDesc);
        const loopClearBtn = document.createElement('button');
        loopClearBtn.className = 'mv-keybind-btn';
        loopClearBtn.textContent = 'Clear All';
        loopClearBtn.disabled = loopCount() === 0;
        loopClearBtn.addEventListener('click', () => {
            clearAllLoops();
            document.querySelectorAll('.mv-cell').forEach(cell => {
                const video = cell.querySelector('video');
                if (video) applyLoopState(cell.dataset.sceneId, video);
            });
            describeLoops();
            loopClearBtn.disabled = true;
        });
        loopRow.append(loopText, loopClearBtn);

        // Collapsible section, chevron and all. Returns the <details> to append
        // and the body rows go into `.rows`.
        const makeSection = title => {
            const section = document.createElement('details');
            section.className = 'mv-settings-section';
            const summary = document.createElement('summary');
            summary.className = 'mv-settings-section-heading mv-section-summary';
            summary.textContent = title;
            const rows = document.createElement('div');
            rows.className = 'mv-section-rows';
            section.append(summary, rows);
            return { section, rows };
        };

        // Seeking section. The two modifier roles live here rather than in
        // Shortcuts because a binding holds one bare key and cannot carry a
        // modifier; the actions they modify are rebindable as usual.
        const { section: seekSection, rows: seekRows } = makeSection('Seeking');

        const addStepRow = (label, key, title) => {
            const row = document.createElement('div');
            row.className = 'mv-settings-qual-row';
            const lbl = document.createElement('label');
            lbl.textContent = label;
            lbl.title = title;
            const input = document.createElement('input');
            input.type = 'number';
            input.className = 'mv-seek-step-input';
            input.min = 0.25;
            input.max = SEEK_STEP_MAX;
            input.step = 0.25;
            input.value = playerSettings[key];
            input.title = title;
            input.addEventListener('change', () => {
                playerSettings[key] = clampStep(input.value, playerSettings[key]);
                input.value = playerSettings[key];
                savePlayerSettings();
            });
            row.append(lbl, input);
            seekRows.appendChild(row);
        };
        addStepRow('Seek step (seconds)', 'seekStep',
            'How far the wheel and the seek shortcuts move the playhead.');
        addStepRow('Fine step (seconds)', 'seekStepFine',
            'Step used while the fine modifier is held.');

        // Both roles read the same modifier keys, so they must not collide.
        const modSelects = {};
        const addModRow = (label, key, title) => {
            const row = document.createElement('div');
            row.className = 'mv-settings-qual-row';
            const lbl = document.createElement('label');
            lbl.textContent = label;
            lbl.title = title;
            const sel = document.createElement('select');
            sel.className = 'mv-quality-select';
            sel.title = title;
            SEEK_MODIFIERS.forEach(m => {
                const o = document.createElement('option');
                o.value = m.value;
                o.textContent = m.label + (m.value === 'ctrl' ? ' (fights browser zoom)' : '');
                if (m.value === playerSettings[key]) o.selected = true;
                sel.appendChild(o);
            });
            sel.addEventListener('change', () => {
                playerSettings[key] = sel.value;
                savePlayerSettings();
                syncModSelects();
            });
            modSelects[key] = sel;
            row.append(lbl, sel);
            seekRows.appendChild(row);
        };
        // Grey out the modifier the other role already owns, so the two can
        // never be set to the same key and race each other.
        function syncModSelects() {
            Object.entries(modSelects).forEach(([key, sel]) => {
                const otherKey = key === 'fineModifier' ? 'allCellsModifier' : 'fineModifier';
                const taken = playerSettings[otherKey];
                Array.from(sel.options).forEach(o => {
                    o.disabled = o.value !== 'none' && o.value === taken;
                });
            });
        }
        addModRow('Fine seek modifier', 'fineModifier',
            'Hold to use the fine step, and to scale down seekbar drag travel.');
        addModRow('All cells modifier', 'allCellsModifier',
            'Hold to move every cell by the same amount instead of just the hovered one.');
        syncModSelects();

        // Quality section
        const { section: qualSection, rows: qualRows } = makeSection('Quality per Grid Size');

        const selects = {};
        GRID_ROWS.forEach(({ key, label }) => {
            const row = document.createElement('div');
            row.className = 'mv-settings-qual-row';
            const lbl = document.createElement('label');
            lbl.textContent = label;
            const sel = document.createElement('select');
            sel.className = 'mv-quality-select';
            sel.disabled = playerSettings.directPlay;
            QUALITY_OPTIONS.forEach(opt => {
                const o = document.createElement('option');
                o.value = opt.value;
                o.textContent = opt.label;
                if (opt.value === playerSettings.quality[key]) o.selected = true;
                sel.appendChild(o);
            });
            sel.addEventListener('change', () => {
                playerSettings.quality[key] = sel.value;
                savePlayerSettings();
                applyQualityToAllCells();
            });
            selects[key] = sel;
            row.append(lbl, sel);
            qualRows.appendChild(row);
        });

        dpToggle.addEventListener('change', () => {
            playerSettings.directPlay = dpToggle.checked;
            savePlayerSettings();
            Object.values(selects).forEach(sel => { sel.disabled = dpToggle.checked; });
            applyQualityToAllCells();
        });

        // Shortcuts section — collapsed by default (native <details>) to keep
        // the panel tidy; bind a keyboard key or mouse button per action.
        const { section: kbSection, rows: kbRows } = makeSection('Shortcuts');

        function renderKeybindRows() {
            kbRows.innerHTML = '';
            KEYBIND_ACTIONS.forEach(action => {
                const row = document.createElement('div');
                row.className = 'mv-settings-qual-row';
                const lbl = document.createElement('label');
                lbl.textContent = action.label;
                const btn = document.createElement('button');
                btn.className = 'mv-keybind-btn';
                btn.textContent = keyLabel(playerSettings.keybinds[action.id]);
                btn.title = 'Click to rebind. Backspace clears, Esc cancels.';
                btn.addEventListener('click', () => beginRebind(action, btn));
                row.append(lbl, btn);
                kbRows.appendChild(row);
            });
        }

        function beginRebind(action, btn) {
            if (keybindCaptureActive) return;
            keybindCaptureActive = true;
            btn.classList.add('capturing');
            btn.textContent = 'Press a key or mouse button…';

            // Assign `binding` to this action (or '' to clear), stealing it from
            // any other action that held it, then tear down capture and re-render.
            const finish = binding => {
                document.removeEventListener('keydown', onKey, true);
                document.removeEventListener('mousedown', onMouse, true);
                document.removeEventListener('contextmenu', swallow, true);
                keybindCaptureActive = false;
                btn.classList.remove('capturing');
                if (binding !== null) {
                    if (binding) {
                        KEYBIND_ACTIONS.forEach(a => {
                            if (a.id !== action.id && playerSettings.keybinds[a.id] === binding) {
                                playerSettings.keybinds[a.id] = '';
                            }
                        });
                    }
                    playerSettings.keybinds[action.id] = binding;
                    savePlayerSettings();
                }
                renderKeybindRows();
            };
            const swallow = ev => { ev.preventDefault(); ev.stopPropagation(); };
            const onKey = ev => {
                swallow(ev);
                if (ev.key === 'Escape') return finish(null);              // cancel
                if (ev.key === 'Backspace' || ev.key === 'Delete') return finish('');
                finish(normalizeKey(ev.key));
            };
            const onMouse = ev => {
                swallow(ev);
                // Left click cancels (lets you click away); any other button binds.
                if (ev.button === 0) return finish(null);
                finish('Mouse' + ev.button);
            };
            // Capture phase so we beat the global shortcut handlers to the input.
            document.addEventListener('keydown', onKey, true);
            document.addEventListener('mousedown', onMouse, true);
            document.addEventListener('contextmenu', swallow, true);
        }

        renderKeybindRows();

        // Accordion: opening one section closes the others, so the panel never
        // grows past a screen. Closing the others fires their own toggle, which
        // returns immediately because they are shut.
        const sections = [seekSection, qualSection, kbSection];
        sections.forEach(section => {
            section.addEventListener('toggle', () => {
                if (!section.open) return;
                sections.forEach(other => { if (other !== section) other.open = false; });
            });
        });

        card.append(header, dpRow, swRow, invRow, volRow, loopRow, seekSection, qualSection, kbSection);
        overlay.appendChild(card);
        overlay.addEventListener('click', e => { if (e.target === overlay) closeSettingsModal(); });
        document.body.appendChild(overlay);
    }

    function closeSettingsModal() {
        document.getElementById('mv-settings-modal')?.remove();
    }

    // �"?�"? Stream selection �"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?

    function pickStream(id) {
        const s = scenes[id]?.streams;
        if (!s) return `/scene/${id}/stream`;
        const direct = s.direct || `/scene/${id}/stream`;

        if (playerSettings.directPlay) return direct;

        const count = queue.length;
        const gridKey = count <= 1 ? 1 : count <= 2 ? 2 : count <= 4 ? 4 : count <= 6 ? 6 : count <= 9 ? 9 : count <= 12 ? 12 : 16;
        const preferred = playerSettings.quality[gridKey] || 'webm720';

        if (preferred === 'direct') return direct;

        const res = preferred.replace(/^(webm|mp4)/, '');
        return s[preferred] || s['webm' + res] || s['mp4' + res] || direct;
    }

    // �"?�"? GraphQL �"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?

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
        await Promise.all(ids.filter(id => typeof id === 'string' && !scenes[id]).map(fetchSceneMeta));
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

    // ── Play tracking ───────────────────────────────────────────────────────
    // Records plays to Stash so multiview-watched scenes appear in history and
    // contribute to play_count / play_duration like the native player does.

    const playTrackers = new Map(); // video element → tracker
    let activityFlushTimer = null;
    const ACTIVITY_FLUSH_MS = 10000;

    function sceneAddPlay(id) {
        fetch('/graphql', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                query: `mutation AddPlay($id: ID!, $times: [Timestamp!]) { sceneAddPlay(id: $id, times: $times) { count } }`,
                variables: { id: String(id), times: [new Date().toISOString()] }
            })
        }).catch(() => {});
    }

    function sceneSaveActivity(id, playDuration) {
        fetch('/graphql', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            // resume_time omitted: looping/auto-advancing multiview cells have
            // no meaningful resume position.
            body: JSON.stringify({
                query: `mutation SaveActivity($id: ID!, $playDuration: Float) { sceneSaveActivity(id: $id, playDuration: $playDuration) }`,
                variables: { id: String(id), playDuration }
            })
        }).catch(() => {});
    }

    function accumulatePlay(tracker) {
        if (tracker.sessionStart != null) {
            const now = performance.now();
            tracker.accumulated += (now - tracker.sessionStart) / 1000;
            tracker.sessionStart = now;
        }
    }

    function flushTracker(tracker) {
        accumulatePlay(tracker);
        if (tracker.accumulated >= 1) {
            sceneSaveActivity(tracker.sceneId, tracker.accumulated);
            tracker.accumulated = 0;
        }
    }

    function flushAllTrackers() {
        for (const tracker of playTrackers.values()) flushTracker(tracker);
    }

    function setupPlayTracking(id, video) {
        const tracker = { sceneId: id, accumulated: 0, sessionStart: null, addPlaySent: false };
        playTrackers.set(video, tracker);

        video.addEventListener('play', () => {
            if (tracker.sessionStart == null) tracker.sessionStart = performance.now();
            if (!tracker.addPlaySent) {
                tracker.addPlaySent = true;
                sceneAddPlay(id);
            }
        });
        video.addEventListener('pause', () => accumulatePlay(tracker));
        video.addEventListener('ended', () => accumulatePlay(tracker));

        if (!activityFlushTimer) {
            activityFlushTimer = setInterval(flushAllTrackers, ACTIVITY_FLUSH_MS);
        }
    }

    function teardownPlayTracking(video) {
        const tracker = playTrackers.get(video);
        if (!tracker) return;
        flushTracker(tracker);
        playTrackers.delete(video);
        if (playTrackers.size === 0 && activityFlushTimer) {
            clearInterval(activityFlushTimer);
            activityFlushTimer = null;
        }
    }

    // ── Resume position ────────────────────────────────────────────────────
    // Per-scene playback position persisted to localStorage so a reload
    // resumes where you left off. In-memory map + a single interval that
    // snapshots all cells every PROGRESS_SAVE_INTERVAL_MS; localStorage is
    // written at most once per tick (plus an immediate flush on pagehide /
    // visibility-hidden). Filter/roulette cells are excluded by design —
    // their position has no meaning across reloads. TTL-pruned at 7 days.
    let progressMap = null;
    let progressMapDirty = false;
    let progressSaveTimer = null;

    function ensureProgressMap() {
        if (progressMap !== null) return progressMap;
        try {
            progressMap = JSON.parse(localStorage.getItem(PROGRESS_KEY) || '{}');
            const now = Date.now();
            for (const k of Object.keys(progressMap)) {
                if (!progressMap[k] || now - (progressMap[k].u || 0) > PROGRESS_MAX_AGE_MS) {
                    delete progressMap[k];
                    progressMapDirty = true;
                }
            }
            if (progressMapDirty) flushProgressMap();
        } catch {
            progressMap = {};
        }
        return progressMap;
    }

    function flushProgressMap() {
        if (!progressMapDirty || progressMap === null) return;
        try {
            localStorage.setItem(PROGRESS_KEY, JSON.stringify(progressMap));
            progressMapDirty = false;
        } catch {}
    }

    function getResumeTime(id) {
        return ensureProgressMap()[String(id)]?.t || 0;
    }

    function setResumeTime(id, t) {
        if (!(t >= PROGRESS_MIN_SAVE)) return;
        const map = ensureProgressMap();
        map[String(id)] = { t, u: Date.now() };
        progressMapDirty = true;
    }

    function clearResumeTime(id) {
        const map = ensureProgressMap();
        const key = String(id);
        // `delete` returns true even for an absent key, so check presence to
        // avoid marking the map dirty (and re-writing localStorage) for no-ops.
        if (key in map) { delete map[key]; progressMapDirty = true; }
    }

    // Snapshot every non-filter cell's effective playhead into the map.
    function snapshotAllProgress() {
        document.querySelectorAll('.mv-cell').forEach(cell => {
            const id = cell.dataset.sceneId;
            if (!id || filterBackedCells.has(id)) return;
            // A looping cell has no meaningful "where I left off": its position
            // is somewhere inside the loop, and resuming there on reload would
            // just fight the loop. It reopens at A instead.
            if (getLoop(id)) return;
            const video = cell.querySelector('video');
            if (!video) return;
            setResumeTime(id, effectivePlayhead(video, id));
        });
    }

    function startProgressSaveLoop() {
        if (progressSaveTimer) return;
        progressSaveTimer = setInterval(() => {
            snapshotAllProgress();
            flushProgressMap();
        }, PROGRESS_SAVE_INTERVAL_MS);
    }

    window.addEventListener('pagehide', () => { flushAllTrackers(); snapshotAllProgress(); flushProgressMap(); });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') { flushAllTrackers(); snapshotAllProgress(); flushProgressMap(); }
    });

    // ── A/B loops ──────────────────────────────────────────────────────────
    // A loop is a per-scene [a, b] range the cell replays forever instead of
    // playing the whole scene: mark A, mark B, and that cell stays on that
    // clip while every other cell plays its own. Persisted per scene id in
    // localStorage (this browser only) so a reload brings the loops back.
    // A stored loop ALWAYS has both marks: setting one mark derives the other
    // (A alone means "A to the end", B alone means "start to B"), which keeps
    // every consumer free of half-set special cases.
    // Filter/roulette cells are excluded by design, same as resume position:
    // their scene changes under them, so a scene-keyed loop is meaningless and
    // would fight the auto-advance.
    let loopMap = null;
    const loopReloadAt = new Map(); // id -> when this cell last paid for a ?start= reload

    function ensureLoopMap() {
        if (loopMap !== null) return loopMap;
        loopMap = {};
        try {
            const parsed = JSON.parse(localStorage.getItem(LOOPS_KEY) || '{}');
            for (const [key, v] of Object.entries(parsed)) {
                const a = Number(v?.a), b = Number(v?.b);
                if (!isFinite(a) || !isFinite(b) || a < 0) continue;
                if (b - a < LOOP_MIN_SECONDS) continue;
                loopMap[key] = { a, b, half: !!v?.half, u: Number(v?.u) || 0 };
            }
        } catch { loopMap = {}; }
        return loopMap;
    }

    function saveLoopMap() {
        const map = ensureLoopMap();
        const keys = Object.keys(map);
        // Loops have no TTL (deleting deliberate user work on a timer would be
        // rude), so cap the map instead: drop the least recently touched.
        if (keys.length > LOOP_MAX_ENTRIES) {
            keys.sort((x, y) => (map[y].u || 0) - (map[x].u || 0))
                .slice(LOOP_MAX_ENTRIES)
                .forEach(k => delete map[k]);
        }
        try { localStorage.setItem(LOOPS_KEY, JSON.stringify(map)); } catch {}
    }

    function getLoop(id) {
        if (id == null) return null;
        return ensureLoopMap()[String(id)] || null;
    }

    function loopCount() {
        return Object.keys(ensureLoopMap()).length;
    }

    // Scene-length seconds. Prefer the value from Stash: a transcode started at
    // ?start= reports only the REMAINING length, so video.duration can't stand
    // in for the scene there.
    function sceneDuration(id, video) {
        const known = scenes[id]?.duration;
        if (known) return known;
        if (!video) return null;
        if (/[?&]start=/.test(video.getAttribute('src') || '')) return null;
        return isFinite(video.duration) && video.duration > 0 ? video.duration : null;
    }

    // `half` means B was derived rather than chosen (the user has only marked A
    // so far). It drives the cell button's three-press A -> B -> off cycle.
    function storeLoop(id, a, b, half = false) {
        if (!(b - a >= LOOP_MIN_SECONDS)) return null;
        const map = ensureLoopMap();
        map[String(id)] = { a, b, half, u: Date.now() };
        saveLoopMap();
        syncLoopUI(id);
        return map[String(id)];
    }

    // Set one mark at `t`. The mark you asked for always lands where you asked;
    // the other one only moves if it would leave an unusable range (so marking
    // A past the current B re-opens B to the end of the scene rather than
    // silently swapping the two behind your back).
    function setLoopPoint(id, which, t, duration) {
        id = String(id);
        const existing = getLoop(id);
        let a, b, half;
        if (which === 'a') {
            a = Math.max(0, t);
            const keep = existing && existing.b - a >= LOOP_MIN_SECONDS;
            b = keep ? existing.b : (duration || a + 30);
            half = keep ? !!existing.half : true;
        } else {
            b = Math.max(0, t);
            const keep = existing && b - existing.a >= LOOP_MIN_SECONDS;
            a = keep ? existing.a : 0;
            half = false;
        }
        if (duration) b = Math.min(b, duration);
        return storeLoop(id, a, b, half);
    }

    function clearLoop(id) {
        const map = ensureLoopMap();
        const key = String(id);
        if (!(key in map)) return;
        delete map[key];
        loopReloadAt.delete(key);
        saveLoopMap();
        syncLoopUI(key);
    }

    function clearAllLoops() {
        loopMap = {};
        loopReloadAt.clear();
        try { localStorage.removeItem(LOOPS_KEY); } catch {}
        document.querySelectorAll('.mv-cell').forEach(cell => cell._mvSyncLoop?.());
    }

    // Repaint one cell's loop chrome (seekbar region, badge, button state).
    function syncLoopUI(id) {
        document.querySelector(`.mv-cell[data-scene-id="${id}"]`)?._mvSyncLoop?.();
    }

    // m:ss, or h:mm:ss past an hour.
    function fmtTime(s) {
        if (!isFinite(s) || s < 0) s = 0;
        const total = Math.floor(s);
        const h = Math.floor(total / 3600);
        const m = Math.floor((total % 3600) / 60);
        const sec = total % 60;
        const mm = h ? String(m).padStart(2, '0') : String(m);
        return (h ? h + ':' : '') + mm + ':' + String(sec).padStart(2, '0');
    }

    // Send a cell back to its loop start. Returns how it was done:
    //  'seek'   - moved the playhead (direct stream, or a transcode that could
    //             still seek inside what it had already buffered);
    //  'reload' - paid for a fresh ?start= transcode;
    //  'wait'   - a reload was due but is still in cooldown; the cell overruns
    //             B for now and we try again on the next tick.
    // `allowSeek` is how the caller escalates: a "successful" buffer seek that
    // silently did nothing is indistinguishable from one that worked until the
    // next tick, so the caller stops trusting it after a couple of no-ops.
    function jumpToLoopStart(id, video, a, allowSeek = true) {
        const src = video.getAttribute('src') || '';
        const resumeAutoplay = () => {
            if (video.paused && video.autoplay) video.play().catch(() => {});
        };

        if (!isTranscodeUrl(src)) {
            try { video.currentTime = a; } catch {}
            resumeAutoplay();
            return 'seek';
        }

        // Transcoded: try the buffer first. Local time is scene time minus
        // whatever offset this src was started at.
        const local = a - (/[?&]start=/.test(src) ? (seekBases.get(id) || 0) : 0);
        if (allowSeek && local >= 0 && video.seekable.length) {
            const from = video.seekable.start(0);
            const to = video.seekable.end(video.seekable.length - 1);
            if (local >= from && local <= to) {
                try {
                    video.currentTime = local;
                    resumeAutoplay();
                    return 'seek';
                } catch {}
            }
        }

        const now = Date.now();
        if (now - (loopReloadAt.get(String(id)) || 0) < LOOP_RESOURCE_COOLDOWN_MS) return 'wait';
        loopReloadAt.set(String(id), now);
        const wasPlaying = !video.paused;
        seekBases.set(id, a);
        showSpinner(document.querySelector(`.mv-cell[data-scene-id="${id}"]`));
        const base = stripStart(src);
        video.src = a > 0 ? withStart(base, a) : base;
        if (wasPlaying || video.autoplay) video.play().catch(() => {});
        return 'reload';
    }

    // A transcode started at ?start= only contains [start, end], so native loop
    // would replay just that tail forever. Let this partial pass finish, then
    // re-seat the full scene and hand looping back to the browser. Guarded so
    // the resume path and a loop being cleared can't both queue the handoff and
    // restart the stream twice on one `ended`.
    function seatFullSceneAfterPartialPass(id, video, baseSrc) {
        if (video._mvReseatPending) return;
        video._mvReseatPending = true;
        video.addEventListener('ended', () => {
            video._mvReseatPending = false;
            if (getLoop(id)) return; // a loop was set in the meantime; it drives restarts
            seekBases.set(id, 0);
            video.src = baseSrc;
            video.loop = true;
            video.play().catch(() => {});
        }, { once: true });
    }

    // Bring one cell's playback in line with its loop state right now, after a
    // mark was set, moved or cleared.
    function applyLoopState(id, video) {
        if (!video) return;
        const loop = filterBackedCells.has(String(id)) ? null : getLoop(id);
        const src = video.getAttribute('src') || '';
        const partial = /[?&]start=/.test(src);
        if (!loop) {
            video.loop = !partial;
            if (partial) seatFullSceneAfterPartialPass(id, video, stripStart(src));
            return;
        }
        // Native loop restarts at 0, not at A, so a looping cell drives itself.
        video.loop = false;
        const t = effectivePlayhead(video, id);
        if (t < loop.a || t >= loop.b - LOOP_EPSILON) jumpToLoopStart(id, video, loop.a);
    }

    // The cell's loop button walks the three states of a hardware A/B button:
    // first press marks A, second marks B, third clears.
    function cycleLoopButton(id, video) {
        const loop = getLoop(id);
        if (loop && !loop.half) {
            clearLoop(id);
        } else {
            const which = loop && loop.half ? 'b' : 'a';
            setLoopPoint(id, which, effectivePlayhead(video, id), sceneDuration(id, video));
        }
        applyLoopState(id, video);
    }

    // Dragging a mark on the seekbar previews live and commits on release, so a
    // drag across the bar isn't a storm of localStorage writes and reloads.
    let activeLoopDrag = null; // { id, video, cell, which, seekbar, dur, a, b, half }

    function updateLoopDrag(e) {
        if (!activeLoopDrag) return;
        const { seekbar, dur, which } = activeLoopDrag;
        const rect = seekbar.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const t = ratio * dur;
        let { a, b } = activeLoopDrag;
        if (which === 'a') a = Math.max(0, Math.min(t, b - LOOP_MIN_SECONDS));
        else               b = Math.min(dur, Math.max(t, a + LOOP_MIN_SECONDS));
        if (b - a < LOOP_MIN_SECONDS) return;
        activeLoopDrag.a = a;
        activeLoopDrag.b = b;
        // Moving B by hand makes it a real mark, not a derived one.
        if (which === 'b') activeLoopDrag.half = false;
        activeLoopDrag.cell._mvSyncLoop?.({ a, b, half: activeLoopDrag.half });
    }

    function commitLoopDrag() {
        if (!activeLoopDrag) return;
        const { id, video, a, b, half } = activeLoopDrag;
        activeLoopDrag = null;
        storeLoop(id, a, b, half);
        applyLoopState(id, video);
    }

    // �"?�"? Layout �"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?

    function autoLayout(count, isPortrait = false) {
        if (count <= 1) return '1x1';
        if (count <= 2) return '2x1';
        if (isPortrait && count === 3) return '3x1';
        if (count <= 4) return '2x2';
        if (count <= 6) return '3x2';
        if (count <= 9) return '3x3';
        if (count <= 12) return '3x4';
        return '4x4';
    }

    function detectAndApplyOrientation() {
        if (playerSettings.focusMode) {
            applyJustifiedLayout();
            return;
        }
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

    function computeJustifiedLayout(aspectRatios, containerWidth, containerHeight, gap) {
        const n = aspectRatios.length;
        if (n === 0) return [];

        const snapped = aspectRatios.map(a => a >= 1 ? 16 / 9 : 9 / 16);
        const totalAspectSum = snapped.reduce((s, a) => s + a, 0);

        const numRows = Math.max(1, Math.round(Math.sqrt(totalAspectSum * containerHeight / containerWidth)));
        const targetPerRow = totalAspectSum / numRows;

        const rows = [];
        let cur = { start: 0, end: 0, aspectSum: 0 };
        for (let i = 0; i < n; i++) {
            const withItem = cur.aspectSum + snapped[i];
            if (rows.length < numRows - 1 && cur.end > cur.start &&
                withItem - targetPerRow > targetPerRow - cur.aspectSum) {
                rows.push(cur);
                cur = { start: i, end: i, aspectSum: 0 };
            }
            cur.aspectSum += snapped[i];
            cur.end = i + 1;
        }
        rows.push(cur);

        rows.forEach(row => {
            row.naturalH = (containerWidth - gap * (row.end - row.start - 1)) / row.aspectSum;
        });
        const totalNaturalH = rows.reduce((s, row) => s + row.naturalH, 0) + gap * (rows.length - 1);
        const scale = containerHeight / totalNaturalH;

        const positions = [];
        let top = 0;
        for (let r = 0; r < rows.length; r++) {
            const row = rows[r];
            const rowH = Math.round(row.naturalH * scale);
            if (r > 0) top += gap;
            let left = 0;
            for (let i = row.start; i < row.end; i++) {
                const w = i === row.end - 1
                    ? containerWidth - Math.round(left)
                    : Math.round(snapped[i] * row.naturalH);
                positions.push({ left: Math.round(left), top, width: w, height: rowH });
                left += w + gap;
            }
            top += rowH;
        }
        return positions;
    }

    // Mixed-orientation focus layout. Portrait cells stand a full band tall;
    // landscape cells pair up and stack two-high to fill the same band, so a
    // portrait reads as exactly double the height of the landscapes beside it.
    // Like computeJustifiedLayout, each band fills width via its natural height
    // and fills container height via a uniform vertical scale (object-fit:cover
    // hides the box distortion), so the result stays edge-to-edge — no ragged
    // bottom. Returns one position per original cell index.
    function computeBandedLayout(aspectRatios, containerWidth, containerHeight, gap) {
        const n = aspectRatios.length;
        if (n === 0) return [];
        const LAND = 16 / 9, PORT = 9 / 16;

        // Walk cells in order, grouping them into "slots". A slot occupies one
        // full band height and is one of:
        //   portrait        → aspect PORT,    one cell at full band height
        //   landscape pair  → aspect LAND/2,  two cells stacked (top + bottom)
        //   landscape lone  → aspect LAND,    one cell at full band height
        //     (an unpaired trailing landscape — promoted to full height so it
        //      never leaves an empty bottom half)
        const slots = [];
        let pendingPair = null; // landscape slot still waiting for its bottom cell
        for (let i = 0; i < n; i++) {
            if (aspectRatios[i] < 1) {
                slots.push({ aspect: PORT, items: [{ idx: i, pos: 'full' }] });
            } else if (pendingPair) {
                pendingPair.items.push({ idx: i, pos: 'bottom' });
                pendingPair = null;
            } else {
                const slot = { aspect: LAND / 2, items: [{ idx: i, pos: 'top' }] };
                slots.push(slot);
                pendingPair = slot;
            }
        }
        if (pendingPair) { // lone trailing landscape → full-height single
            pendingPair.aspect = LAND;
            pendingPair.items[0].pos = 'full';
        }

        // Pack slots into bands exactly as computeJustifiedLayout packs cells
        // into rows, using each slot's aspect.
        const snapped = slots.map(s => s.aspect);
        const totalAspectSum = snapped.reduce((s, a) => s + a, 0);
        const numBands = Math.max(1, Math.round(Math.sqrt(totalAspectSum * containerHeight / containerWidth)));
        const targetPerBand = totalAspectSum / numBands;

        const bands = [];
        let cur = { start: 0, end: 0, aspectSum: 0 };
        for (let i = 0; i < slots.length; i++) {
            const withItem = cur.aspectSum + snapped[i];
            if (bands.length < numBands - 1 && cur.end > cur.start &&
                withItem - targetPerBand > targetPerBand - cur.aspectSum) {
                bands.push(cur);
                cur = { start: i, end: i, aspectSum: 0 };
            }
            cur.aspectSum += snapped[i];
            cur.end = i + 1;
        }
        bands.push(cur);

        bands.forEach(band => {
            band.naturalH = (containerWidth - gap * (band.end - band.start - 1)) / band.aspectSum;
        });
        const totalNaturalH = bands.reduce((s, band) => s + band.naturalH, 0) + gap * (bands.length - 1);
        const scale = containerHeight / totalNaturalH;

        const positions = new Array(n);
        let top = 0;
        for (let r = 0; r < bands.length; r++) {
            const band = bands[r];
            const bandH = Math.round(band.naturalH * scale);
            if (r > 0) top += gap;
            let left = 0;
            for (let si = band.start; si < band.end; si++) {
                const slot = slots[si];
                const w = si === band.end - 1
                    ? containerWidth - Math.round(left)
                    : Math.round(slot.aspect * band.naturalH);
                const x = Math.round(left);
                const halfH = Math.round((bandH - gap) / 2);
                for (const item of slot.items) {
                    if (item.pos === 'top') {
                        positions[item.idx] = { left: x, top, width: w, height: halfH };
                    } else if (item.pos === 'bottom') {
                        positions[item.idx] = { left: x, top: top + bandH - halfH, width: w, height: halfH };
                    } else { // full
                        positions[item.idx] = { left: x, top, width: w, height: bandH };
                    }
                }
                left += w + gap;
            }
            top += bandH;
        }
        return positions;
    }

    function applyJustifiedLayout() {
        if (!playerSettings.focusMode) return;
        const grid = document.getElementById('mv-grid');
        if (!grid) return;
        const cells = [...grid.querySelectorAll('.mv-cell')];
        if (cells.length === 0) return;
        const containerWidth  = grid.clientWidth;
        const containerHeight = grid.clientHeight;
        if (containerWidth === 0 || containerHeight === 0) return;
        const GAP = 3;
        const aspectRatios = cells.map(cell => {
            const video = cell.querySelector('video');
            return (video && video.videoWidth > 0 && video.videoHeight > 0)
                ? video.videoWidth / video.videoHeight
                : 16 / 9;
        });
        // Mixed grids (portrait + landscape together) use the banded layout so
        // portraits stand double the height of the landscapes; uniform grids
        // (all one orientation) keep the plain justified rows.
        const hasPortrait  = aspectRatios.some(a => a < 1);
        const hasLandscape = aspectRatios.some(a => a >= 1);
        const positions = (hasPortrait && hasLandscape)
            ? computeBandedLayout(aspectRatios, containerWidth, containerHeight, GAP)
            : computeJustifiedLayout(aspectRatios, containerWidth, containerHeight, GAP);
        cells.forEach((cell, i) => {
            const p = positions[i];
            if (!p) return;
            cell.style.left   = p.left   + 'px';
            cell.style.top    = p.top    + 'px';
            cell.style.width  = p.width  + 'px';
            cell.style.height = p.height + 'px';
        });
    }

    function clearJustifiedLayout() {
        document.querySelectorAll('.mv-cell').forEach(cell => {
            cell.style.left = cell.style.top = cell.style.width = cell.style.height = '';
        });
    }

    // �"?�"? Play / Pause All �"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?

    function playPauseAll() {
        const videos = [...document.querySelectorAll('.mv-cell video')];
        const anyPlaying = videos.some(v => !v.paused);
        videos.forEach(v => anyPlaying ? v.pause() : v.play());
        // Each video's own 'play'/'pause' listener calls refreshPlayPauseAllBtn,
        // but call it here too so the icon updates even if the grid is empty.
        refreshPlayPauseAllBtn();
    }

    // Keeps the "Play/Pause All" icon in sync with actual per-video state,
    // which drifts from it any time a video starts/stops outside this
    // button (scene pause button, new scene added to the queue, etc.)
    function refreshPlayPauseAllBtn() {
        const videos = [...document.querySelectorAll('.mv-cell video')];
        updatePlayPauseAllBtn(videos.some(v => !v.paused));
    }

    function updatePlayPauseAllBtn(playing) {
        const btn = document.getElementById('mv-playpause-all-btn');
        if (!btn) return;
        btn.innerHTML = playing
            ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 512" aria-hidden="true"><path fill="currentColor" d="M48 64C21.5 64 0 85.5 0 112V400c0 26.5 21.5 48 48 48H80c26.5 0 48-21.5 48-48V112c0-26.5-21.5-48-48-48H48zm192 0c-26.5 0-48 21.5-48 48V400c0 26.5 21.5 48 48 48h32c26.5 0 48-21.5 48-48V112c0-26.5-21.5-48-48-48H240z"/></svg>`
            : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512" aria-hidden="true"><path fill="currentColor" d="M73 39c-14.8-9.1-33.4-9.4-48.5-.9S0 62.6 0 80V432c0 17.4 9.4 33.4 24.5 41.9S58.2 482 73 473l288-176c14.3-8.7 23-24.2 23-41s-8.7-32.2-23-41L73 39z"/></svg>`;
        btn.title = playing ? 'Pause All' : 'Play All';
    }

    // �"?�"? Audio mute/unmute �"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?

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
            queue.forEach(id => typeof id === 'string' && unmutedIds.add(id));
        }
        document.querySelectorAll('.mv-cell').forEach(applyAudioCell);
        updateMuteAllBtn();
    }

    // �"?�"? Seek �"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?

    let activeSeek = null; // { seekbar, fill, video, id, ratio }

    // ── Seek zone ──────────────────────────────────────────────────────────
    // One cell at a time is "in the zone": pointer near its bottom edge, or the
    // cell currently being dragged. Reading a rect per mousemove would force a
    // sync layout on every move, so the work is coalesced to one frame.

    let seekZoneCell = null;
    let zonePending = null;
    let zoneRaf = 0;

    function queueSeekZone(e) {
        zonePending = { target: e.target, x: e.clientX, y: e.clientY };
        if (zoneRaf) return;
        zoneRaf = requestAnimationFrame(() => {
            zoneRaf = 0;
            const p = zonePending;
            zonePending = null;
            if (p) updateSeekZone(p);
        });
    }

    function setSeekZoneCell(cell) {
        if (cell === seekZoneCell) return;
        if (seekZoneCell) seekZoneCell.classList.remove('mv-seek-zone');
        seekZoneCell = cell;
        if (seekZoneCell) seekZoneCell.classList.add('mv-seek-zone');
    }

    function updateSeekZone(p) {
        // render() can replace the cell we were holding; drop the detached node.
        if (seekZoneCell && !seekZoneCell.isConnected) seekZoneCell = null;
        // A drag owns the zone until it ends, even if the pointer wanders off
        // the cell (the bar is still what the user is manipulating).
        const dragging = activeSeek || activeLoopDrag;
        const cell = dragging
            ? (activeSeek ? activeSeek.seekbar.closest('.mv-cell') : activeLoopDrag.cell)
            : (p.target && p.target.closest ? p.target.closest('.mv-cell') : null);
        if (!cell) { setSeekZoneCell(null); return; }

        const rect = cell.getBoundingClientRect();
        if (!dragging && p.y < rect.bottom - SEEK_ZONE_PX) { setSeekZoneCell(null); return; }
        setSeekZoneCell(cell);
        // A seek drag paints its own target, which diverges from the pointer
        // once the fine modifier scales the travel down.
        if (!activeSeek && rect.width) paintSeekTime(cell, rect, (p.x - rect.left) / rect.width);
    }

    // The readout reports the time the cell would seek to. The bar spans the
    // cell, so the cell rect and the bar rect are interchangeable here.
    function paintSeekTime(cell, rect, rawRatio) {
        const readout = cell.querySelector('.mv-seek-time');
        if (!readout) return;
        const id = cell.dataset.sceneId;
        const video = cell.querySelector('video');
        const duration = totalDuration(id, video);
        if (!duration) { readout.textContent = ''; return; }
        const ratio = Math.max(0, Math.min(1, rawRatio));
        readout.textContent = fmtTime(ratio * duration) + ' / ' + fmtTime(duration);
        // Cells clip their overflow, so hold the centred bubble far enough in
        // from either edge that it stays whole at 0% and 100%.
        const margin = rect.width ? (readout.offsetWidth / 2 + 4) / rect.width : 0;
        readout.style.left = (100 * Math.max(margin, Math.min(1 - margin, ratio))) + '%';
    }

    function updateSeekFill(e) {
        if (!activeSeek) return;
        const rect = activeSeek.seekbar.getBoundingClientRect();
        if (!rect.width) return;

        // Travel from the grab point, scaled. At gain 1 this is identical to
        // reading the pointer position absolutely, so ordinary drags are
        // unchanged; only the fine modifier makes the two differ.
        const fine = isFineSeek(e);
        if (fine !== activeSeek.fine) {
            // Re-anchor on press or release so the fill can't jump mid-drag.
            activeSeek.fine = fine;
            activeSeek.originX = e.clientX;
            activeSeek.originRatio = activeSeek.ratio;
        }
        const travel = (e.clientX - activeSeek.originX) * (fine ? FINE_DRAG_GAIN : 1);
        if (travel) activeSeek.moved = true;
        const ratio = Math.max(0, Math.min(1, activeSeek.originRatio + travel / rect.width));
        activeSeek.ratio = ratio;
        const zoneCell = activeSeek.seekbar.closest('.mv-cell');
        if (zoneCell) paintSeekTime(zoneCell, rect, ratio);
        activeSeek.fill.style.transform = 'scaleX(' + ratio + ')';
    }

    function commitSeek() {
        if (!activeSeek || activeSeek.ratio == null) return;
        // A fine grab that never moved is a click to start refining, not a
        // seek request. Committing it would restart the transcode for nothing.
        if (activeSeek.fine && !activeSeek.moved) return;
        const { video, id, ratio } = activeSeek;
        // A single click fires both mousedown and mouseup, each calling
        // commitSeek with the same ratio. Without this guard the transcoder
        // gets two back-to-back src reassignments at the same offset.
        if (activeSeek.lastCommittedRatio === ratio) return;
        activeSeek.lastCommittedRatio = ratio;
        const duration = totalDuration(id, video);
        if (!duration) return;

        const targetTime = ratio * duration;
        const currentSrc = video.getAttribute('src');

        if (isTranscodeUrl(currentSrc)) {
            seekBases.set(id, targetTime);
            showSpinner(document.querySelector(`.mv-cell[data-scene-id="${id}"]`));
            resourceKeepingPlayState(video, withStart(stripStart(currentSrc), targetTime));
        } else {
            video.currentTime = targetTime;
        }
    }

    // �"?�"? Volume popup �"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?

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

    // �"?�"? Render �"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?

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

        // Snapshot existing cells so add/cleanup use O(1) Map/Set lookups
        // instead of N querySelector + N queue.includes (O(N^2)). Newly
        // created cells sit at lower indices than the iterator, so the
        // refCell forward-search never needs to see them.
        const existing = new Map();
        for (const cell of grid.children) {
            const cid = cell.dataset.sceneId;
            if (cid && !existing.has(cid)) existing.set(cid, cell); // canonical = first cell per id
        }
        const queueSet = new Set(queue);

        // Add new cells at their correct queue position (before removal to avoid layout flash)
        let newCellOrdinal = 0; // counts only cells created this pass, for stream stagger
        queue.forEach((id, idx) => {
            if (typeof id !== 'string') return;
            if (existing.has(id)) return;

            const staggerSlot = newCellOrdinal++;
            const cell = document.createElement('div');
            const isFilterBacked = filterBackedCells.has(id);
            cell.className = 'mv-cell' + (isFilterBacked ? ' mv-cell--filter' : '');
            cell.dataset.sceneId = id;


            const video = document.createElement('video');
            const baseSrc = pickStream(id);
            // A looped scene opens at A instead of wherever it was left off:
            // inside a loop, "where I left off" has no meaning.
            const cellLoop = isFilterBacked ? null : getLoop(id);
            let resumeTime = cellLoop ? cellLoop.a : (isFilterBacked ? 0 : getResumeTime(id));
            const dur = scenes[id]?.duration;
            if (!cellLoop && resumeTime > 0 && dur && resumeTime > dur - PROGRESS_END_MARGIN) {
                // Stale/at-or-past-end offset (scene re-encoded shorter, or saved
                // right at the end). Start fresh rather than ?start= past EOF.
                resumeTime = 0;
                clearResumeTime(id);
            }
            const isTranscodeSrc = isTranscodeUrl(baseSrc);
            // A transcode resumed via ?start= only contains [resumeTime, end], so
            // native loop would replay just that tail forever. Start it unlooped
            // and re-seat to the full scene when the first partial pass ends.
            const resumedTranscode = resumeTime > 0 && isTranscodeSrc && !isFilterBacked && !cellLoop;
            // Assigning src kicks off the load/transcode. Deferred + staggered
            // (invoked from the staggered start below) so a full grid doesn't
            // fire every transcode request at the same instant.
            const applyInitialSrc = () => {
                if (resumeTime > 0 && isTranscodeSrc) {
                    // Transcode resume is reliable via ?start=; currentTime seeking
                    // on a live transcode is not.
                    seekBases.set(id, resumeTime);
                    video.src = withStart(baseSrc, resumeTime);
                } else {
                    video.src = baseSrc;
                    if (resumeTime > 0) {
                        video.addEventListener('loadedmetadata', () => {
                            try { video.currentTime = resumeTime; } catch {}
                        }, { once: true });
                    }
                }
            };
            video.autoplay = true;
            // A cell with an A/B loop drives its own restarts (native loop goes
            // back to 0, not to A), so native looping stays off while one is set.
            video.loop = !isFilterBacked && !resumedTranscode && !cellLoop;
            if (resumedTranscode) seatFullSceneAfterPartialPass(id, video, baseSrc);
            video.muted = !unmutedIds.has(id);
            video.playsInline = true;
            video.disablePictureInPicture = true;

            if (isFilterBacked) {
                video.addEventListener('ended', () => advanceFilterCell(id));
            }

            // ── Stall recovery (loop-proof) ──────────────────────────────
            // Re-source a stalled/errored stream from the effective playhead,
            // bounded so a flaky/dead stream can't hammer the shared transcoder
            // or strobe the grid:
            //  - cooldown between attempts (a pending attempt is deferred, not
            //    dropped, so a dead stream that emits no further events still
            //    gets retried);
            //  - MAX_RECOVERIES budget that is FORGIVEN one at a time only after
            //    an *uninterrupted* healthy window — a stall before the window
            //    completes forfeits the forgiveness, so a tight stall loop walks
            //    the budget up to the cap instead of resetting it every cycle;
            //  - once the budget is exhausted we give up (gaveUp): filter cells
            //    advance to another scene, fixed cells stop, and no further
            //    event re-enters recovery.
            let stallWatchdog = null;
            let recoveryCount = 0;
            let lastRecoveryAt = 0;
            let sustainedPlayTimer = null;
            let cellTornDown = false;
            let gaveUp = false;
            const clearStallWatchdog = () => {
                if (stallWatchdog) { clearTimeout(stallWatchdog); stallWatchdog = null; }
            };
            const recoverVideo = () => {
                if (cellTornDown || gaveUp) return;
                clearStallWatchdog();
                const now = performance.now();
                const sinceLast = now - lastRecoveryAt;
                if (lastRecoveryAt > 0 && sinceLast < RECOVERY_COOLDOWN_MS) {
                    // Still cooling down. Don't drop this attempt — a dead
                    // stream often emits no further `waiting`/`error`, so we
                    // must re-arm the retry ourselves once the cooldown elapses.
                    stallWatchdog = setTimeout(recoverVideo, RECOVERY_COOLDOWN_MS - sinceLast);
                    return;
                }
                if (recoveryCount >= MAX_RECOVERIES) {
                    // Out of budget. Stop hammering the transcoder and don't
                    // re-enter on subsequent events. Filter cells advance to a
                    // different scene (a fresh cell with a fresh budget); fixed
                    // cells just stop on the last frame.
                    gaveUp = true;
                    if (isFilterBacked) advanceFilterCell(id);
                    return;
                }
                recoveryCount++;
                lastRecoveryAt = now;
                const currentSrc = video.getAttribute('src') || '';
                let t = effectivePlayhead(video, id);
                const dur = totalDuration(id, video);
                if (dur && t > dur - 0.5) t = Math.max(0, dur - 0.5); // never re-source past EOF
                if (isTranscodeUrl(currentSrc)) {
                    seekBases.set(id, t);
                    video.src = withStart(stripStart(currentSrc), t);
                } else {
                    video.load();
                    video.addEventListener('loadedmetadata', () => {
                        try { video.currentTime = t; } catch {}
                    }, { once: true });
                }
                video.play().catch(() => {});
            };
            video.addEventListener('waiting', () => {
                if (gaveUp) return;
                clearStallWatchdog();
                // A stall forfeits the in-progress healthy window so a tight
                // stall loop can never earn budget back (see `playing`).
                clearTimeout(sustainedPlayTimer);
                stallWatchdog = setTimeout(recoverVideo, STALL_TIMEOUT_MS);
            });
            video.addEventListener('playing', () => {
                clearStallWatchdog();
                // Forgive ONE past recovery per uninterrupted healthy window, so
                // a stream that recovers and then plays well isn't stuck near the
                // cap — but `waiting` cancels this timer, so a stream that keeps
                // stalling before the window completes never refills its budget.
                clearTimeout(sustainedPlayTimer);
                sustainedPlayTimer = setTimeout(() => {
                    recoveryCount = Math.max(0, recoveryCount - 1);
                }, SUSTAINED_PLAY_MS);
            });
            video.addEventListener('error', recoverVideo);
            video._mvCleanup = () => {
                cellTornDown = true;
                clearStallWatchdog();
                clearTimeout(sustainedPlayTimer);
                clearTimeout(seekingSpinnerTimer); // declared below in the same cell scope; only ever called on a later render's teardown
                // Cancel any queued wheel-seek so it can't fire applyWheelSeek on
                // this now-detached video and resurrect a seekBases entry.
                const pw = wheelPending.get(id);
                if (pw) { clearTimeout(pw.timeout); wheelPending.delete(id); }
                try { video.pause(); video.removeAttribute('src'); video.load(); } catch {}
            };

            video.addEventListener('loadedmetadata', () => {
                connectAudio(id, video);
                detectAndApplyOrientation();
            }, { once: true });

            setupPlayTracking(id, video);

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
            if (isFilterBacked) {
                const hasConstraints = Object.keys(filterBackedCells.get(id)?.filter || {}).length > 0;
                const label = document.createElement('span');
                label.className = 'mv-filter-label';
                label.textContent = hasConstraints ? 'Filter: ' : 'Random: ';
                sceneTitleEl.appendChild(label);
                sceneTitleEl.appendChild(document.createTextNode(scenes[id]?.title || id));
            } else {
                sceneTitleEl.textContent = scenes[id]?.title || id;
            }
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
                refreshPlayPauseAllBtn();
            });
            video.addEventListener('play', () => {
                playPauseBtn.innerHTML = ICON_PAUSE;
                playPauseBtn.title = 'Pause';
                refreshPlayPauseAllBtn();
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

            // A/B loop: badge (bottom-left of the overlay) plus a button that
            // cycles A -> B -> off. Filter cells get neither, their scene changes.
            const loopBadge = document.createElement('span');
            loopBadge.className = 'mv-loop-badge';
            loopBadge.innerHTML = ICON_LOOP + '<span class="mv-loop-badge-text"></span>';
            const loopBadgeText = loopBadge.querySelector('.mv-loop-badge-text');

            const loopBtn = document.createElement('button');
            loopBtn.className = 'mv-cell-btn mv-cell-loop-btn';
            loopBtn.innerHTML = ICON_LOOP;
            loopBtn.addEventListener('click', e => {
                e.stopPropagation();
                cycleLoopButton(id, video);
            });

            const prevBtn = document.createElement('button');
            prevBtn.className = 'mv-cell-skip-btn mv-cell-prev';
            prevBtn.innerHTML = ICON_PREV;
            prevBtn.title = 'Restart video';
            prevBtn.addEventListener('click', e => {
                e.stopPropagation();
                seekToStart(id, video);
            });

            const nextBtn = document.createElement('button');
            nextBtn.className = 'mv-cell-skip-btn mv-cell-next';
            nextBtn.innerHTML = ICON_NEXT;
            nextBtn.title = isFilterBacked ? 'Next video' : 'Restart video';
            nextBtn.addEventListener('click', e => {
                e.stopPropagation();
                if (isFilterBacked) advanceFilterCell(id);
                else seekToStart(id, video);
            });

            const centerControls = document.createElement('div');
            centerControls.className = 'mv-cell-center-controls';
            centerControls.append(prevBtn, playPauseBtn, nextBtn);

            if (isFilterBacked) controls.append(oBtn, audioBtn, removeBtn);
            else                controls.append(loopBadge, oBtn, loopBtn, audioBtn, removeBtn);
            overlay.append(sceneTitleEl, centerControls, controls);

            // Volume popup (direct child of cell, not overlay)
            const popup = document.createElement('div');
            popup.className = 'mv-vol-popup';

            const volLabel = document.createElement('span');
            volLabel.className = 'mv-vol-label';
            volLabel.textContent = Math.round(playerSettings.defaultVolume * 100) + '%';

            const slider = document.createElement('input');
            slider.type = 'range';
            slider.className = 'mv-vol-slider';
            slider.min = 0;
            slider.max = 2;
            slider.step = 0.05;
            slider.value = playerSettings.defaultVolume;
            slider.title = 'Volume (0-200%)';
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

            // Time under the pointer, filled in by the seek-zone painter.
            const seekTime = document.createElement('span');
            seekTime.className = 'mv-seek-time';
            seekbar.appendChild(seekTime);

            // Loop range drawn over the track, with a draggable mark at each end.
            const loopRegion = document.createElement('div');
            loopRegion.className = 'mv-loop-region';
            const loopFill = document.createElement('div');
            loopFill.className = 'mv-loop-progress';
            loopRegion.appendChild(loopFill);
            const handleA = document.createElement('span');
            handleA.className = 'mv-loop-handle is-a';
            const handleB = document.createElement('span');
            handleB.className = 'mv-loop-handle is-b';
            loopRegion.append(handleA, handleB);
            seekbar.appendChild(loopRegion);

            // How far through the loop we are, as a fraction of the band.
            const paintLoopProgress = (l) => {
                if (!l) return;
                const span = l.b - l.a;
                const frac = span > 0 ? (effectivePlayhead(video, id) - l.a) / span : 0;
                loopFill.style.transform = 'scaleX(' + Math.max(0, Math.min(1, frac)) + ')';
            };

            // Repaint the loop chrome. `preview` overrides the stored loop while
            // a mark is being dragged.
            const syncLoop = (preview) => {
                const l = preview || (isFilterBacked ? null : getLoop(id));
                cell.classList.toggle('mv-looping', !!l);
                const duration = sceneDuration(id, video);
                if (l && duration) {
                    loopRegion.style.display = 'block';
                    loopRegion.style.left = (100 * Math.max(0, Math.min(1, l.a / duration))) + '%';
                    loopRegion.style.width = (100 * Math.max(0, Math.min(1, (l.b - l.a) / duration))) + '%';
                    paintLoopProgress(l);
                } else {
                    loopRegion.style.display = 'none';
                }
                if (l) {
                    loopBadgeText.textContent = fmtTime(l.a) + ' - ' + (l.half && !duration ? 'end' : fmtTime(l.b));
                    loopBtn.classList.add('is-active');
                    loopBtn.title = l.half
                        ? `Loop starts at ${fmtTime(l.a)}. Click to set the end here.`
                        : `Looping ${fmtTime(l.a)} - ${fmtTime(l.b)}. Click to clear.`;
                } else {
                    loopBadgeText.textContent = '';
                    loopBtn.classList.remove('is-active');
                    loopBtn.title = 'Loop: set the start here';
                }
            };
            cell._mvSyncLoop = syncLoop;

            // Two no-op buffer seeks in a row means this stream won't seek
            // backwards at all, so stop trying and pay for a ?start= reload.
            let loopSeekAttempts = 0;
            const enforceLoop = () => {
                const l = isFilterBacked ? null : getLoop(id);
                if (!l) return;
                if (effectivePlayhead(video, id) < l.b - LOOP_EPSILON) {
                    loopSeekAttempts = 0;
                    return;
                }
                const how = jumpToLoopStart(id, video, l.a, loopSeekAttempts < 2);
                if (how === 'seek') loopSeekAttempts++;
                else if (how === 'reload') loopSeekAttempts = 0;
            };

            const startLoopDrag = (which, ev) => {
                if (ev.button !== 0) return;
                const l = getLoop(id);
                const duration = sceneDuration(id, video);
                if (!l || !duration) return;
                // Keep the seekbar's own click-to-seek out of this.
                ev.stopPropagation();
                ev.preventDefault();
                activeLoopDrag = { id, video, cell, which, seekbar, dur: duration, a: l.a, b: l.b, half: !!l.half };
            };
            handleA.addEventListener('mousedown', e => startLoopDrag('a', e));
            handleB.addEventListener('mousedown', e => startLoopDrag('b', e));

            // B at the end of the scene (or of a partial ?start= stream) ends
            // instead of crossing B, so restart from A here too.
            video.addEventListener('ended', () => {
                const l = isFilterBacked ? null : getLoop(id);
                if (l) jumpToLoopStart(id, video, l.a);
            });

            const updateProgress = () => {
                if (activeSeek && activeSeek.id === id) return;
                const duration = totalDuration(id, video);
                if (duration) seekFill.style.transform = 'scaleX(' + (effectivePlayhead(video, id) / duration) + ')';
                if (!activeLoopDrag || activeLoopDrag.id !== id) paintLoopProgress(isFilterBacked ? null : getLoop(id));
            };

            video.addEventListener('timeupdate', () => {
                if (video.seeking) return;
                enforceLoop();
                updateProgress();
            });

            // Duration is what turns marks into positions on the bar, so repaint
            // once the stream reports it (Stash usually knows it up front).
            video.addEventListener('loadedmetadata', () => syncLoop());
            syncLoop();

            // Debounced spinner: the browser fires rapid seeking/seeked
            // cycles during a buffer underrun. Showing/hiding the spinner on
            // each one produced the rapid-flashing crash look. Only show it if
            // the seek state persists past a short delay.
            let seekingSpinnerTimer = null;
            video.addEventListener('seeking', () => {
                clearTimeout(seekingSpinnerTimer);
                seekingSpinnerTimer = setTimeout(() => showSpinner(cell), SEEKING_SPINNER_DELAY_MS);
            });

            video.addEventListener('seeked', () => {
                clearTimeout(seekingSpinnerTimer);
                hideSpinner(cell);
                updateProgress();
            });

            video.addEventListener('canplay', () => {
                hideSpinner(cell);
            });

            seekbar.addEventListener('mousedown', e => {
                e.stopPropagation();
                const rect = seekbar.getBoundingClientRect();
                const fine = isFineSeek(e);
                const duration = totalDuration(id, video);
                // A plain grab is absolute: the bar means what it has always
                // meant, and the click jumps there. A fine grab anchors at the
                // current playhead instead, so you can inch a loop point in
                // without first losing your place.
                const originRatio = fine && duration
                    ? Math.max(0, Math.min(1, effectivePlayhead(video, id) / duration))
                    : (rect.width ? Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) : 0);
                activeSeek = {
                    seekbar, fill: seekFill, video, id,
                    ratio: originRatio, originRatio, originX: e.clientX, fine, moved: false,
                };
                seekFill.style.transform = 'scaleX(' + originRatio + ')';
                paintSeekTime(cell, rect, originRatio);
                if (!fine) commitSeek(); // immediate jump on click
            });

            cell.addEventListener('wheel', e => {
                if (!playerSettings.wheelSeek) return;
                // Don't hijack scrolling inside the volume popup (its slider
                // is wheel-adjustable in the browser by default).
                if (e.target.closest('.mv-vol-popup')) return;
                e.preventDefault();
                // Default: scroll up = forward. Invert flips it to scroll down =
                // forward (some users expect the page-scroll-down direction).
                const scrollUp = e.deltaY < 0;
                const forward = playerSettings.invertWheelSeek ? !scrollUp : scrollUp;
                const delta = (forward ? 1 : -1) * seekStepFor(e);
                if (isAllCellsSeek(e)) seekAllCells(delta);
                else scheduleWheelSeek(id, video, delta);
            }, { passive: false });

            cell.append(video, loadingDiv, overlay, popup, seekbar);

            cell.addEventListener('mouseleave', () => {
                if (openPopupId === id) closeAllPopups();
            });

            if (unmutedIds.has(id)) cell.classList.add('audio-active');

            // Insert at correct queue position instead of appending to end
            let refCell = null;
            for (let i = idx + 1; i < queue.length; i++) {
                const nextId = queue[i];
                if (typeof nextId !== 'string') continue;
                const next = existing.get(nextId);
                if (next) { refCell = next; break; }
            }
            grid.insertBefore(cell, refCell);
            // Register the new cell so a duplicate of this id later in the same
            // queue (two filter slots resolving to the same scene, etc.) is
            // skipped instead of spawning a second cell with the same id.
            existing.set(id, cell);

            // Start the stream, staggered. The cell is in the DOM and fully
            // wired by now; if it's torn down during its delay (queue changed),
            // _mvCleanup sets cellTornDown and we skip starting a dead stream.
            const startDelay = staggerSlot * STREAM_STAGGER_MS;
            if (startDelay > 0) {
                setTimeout(() => { if (!cellTornDown) applyInitialSrc(); }, startDelay);
            } else {
                applyInitialSrc();
            }
        });

        // Remove cells no longer in queue. Walk the real DOM (not the id-keyed
        // `existing` map) so any stray duplicate-id cell is also torn down and
        // can't leak its <video>/watchdog. Keep only the canonical cell per id.
        for (const cell of Array.from(grid.children)) {
            const cid = cell.dataset.sceneId;
            if (cid && queueSet.has(cid) && existing.get(cid) === cell) continue;
            const v = cell.querySelector('video');
            if (v) {
                teardownPlayTracking(v);
                v._mvCleanup?.();
            }
            cell.remove();
        }

        refreshPlayPauseAllBtn();
    }

    function applyQualityToAllCells() {
        document.querySelectorAll('.mv-cell').forEach(cell => {
            const id = cell.dataset.sceneId;
            const video = cell.querySelector('video');
            if (!video) return;

            const optimalSrc = pickStream(id);
            const currentSrc = video.getAttribute('src') || '';
            const baseSrc = stripStart(currentSrc);

            if (!baseSrc || baseSrc === optimalSrc) return;

            const currentTime = effectivePlayhead(video, id);
            const wasPlaying = !video.paused;
            const isTranscode = isTranscodeUrl(optimalSrc);

            showSpinner(cell);

            if (isTranscode && currentTime > 0) {
                seekBases.set(id, currentTime);
                video.src = withStart(optimalSrc, currentTime);
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
        });
    }

    // �"?�"? Cross-tab sync �"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?

    // Same-origin cross-tab: the local cache changed in another tab.
    window.addEventListener('storage', e => {
        if (e.key !== STORAGE_KEY) return;
        resyncFromCache();
    });

    // Cross-CLIENT: the queue can change from the Stash scene-list plugin,
    // binge web, or binge-iOS. Poll config while visible (and on becoming
    // visible) and re-resolve only when it actually changed — so the wall
    // tracks the live queue without churning playback. Skips while our own
    // write is in flight so it can't revert it.
    setInterval(async () => {
        if (document.visibilityState !== 'visible' || pendingConfigWrites > 0) return;
        if (await seedCacheFromConfig()) resyncFromCache();
    }, 5000);
    document.addEventListener('visibilitychange', async () => {
        if (document.visibilityState !== 'visible' || pendingConfigWrites > 0) return;
        if (await seedCacheFromConfig()) resyncFromCache();
    });

    // �"?�"? Roulette �"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?

    // mode 'replace' (default): the roll overwrites the whole grid with `count`
    // random scenes. mode 'add': append up to `count` random scenes to the
    // current grid (filter cards and all), capped at 16 and skipping scenes
    // already on screen — lets you mix a random roll alongside curated slots.
    async function loadRoulette(count, mode = 'replace') {
        try {
            const adding = mode === 'add';
            const want = adding ? Math.min(count, 16 - queue.length) : count;
            if (want <= 0) return;
            // In add mode fetch a buffer so we can drop scenes already on the grid.
            const perPage = adding ? want + queue.length : want;
            const res = await fetch('/graphql', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    query: `query { findScenes(filter: { per_page: ${perPage}, sort: "random" }) { scenes { id } } }`
                })
            });
            const data = await res.json();
            let ids = (data?.data?.findScenes?.scenes || []).map(s => String(s.id));
            const rouletteFilter = { type: 'filter', filter: {} };

            if (adding) {
                const have = new Set(queue);
                ids = ids.filter(id => !have.has(id)).slice(0, want);
                if (!ids.length) return;
                ids.forEach(id => filterBackedCells.set(id, rouletteFilter));
                queue = [...queue, ...ids];
                // Append matching empty-filter slots to config (RMW) so a
                // reload reproduces them and other clients see the change.
                await mutateConfigQueue(items => {
                    const room = 16 - items.length;
                    for (let i = 0; i < Math.min(ids.length, room); i++) {
                        items.push({ type: 'filter', filter: {} });
                    }
                    return items;
                });
            } else {
                ids = ids.slice(0, want);
                if (!ids.length) return;
                // Replace is a deliberate full reset of the queue to fresh
                // random filter slots.
                await mutateConfigQueue(() => ids.map(() => ({ type: 'filter', filter: {} })));
                filterBackedCells.clear();
                ids.forEach(id => filterBackedCells.set(id, rouletteFilter));
                queue = ids;
            }
            await loadSceneMeta(ids);
            render();
        } catch {}
    }

    // �"?�"? Menu panel �"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?

    function openMenuPanel() {
        if (document.getElementById('mv-menu-panel')) { closeMenuPanel(); return; }

        const savedCount = parseInt(localStorage.getItem(ROULETTE_COUNT_KEY) || '4');

        const panel = document.createElement('div');
        panel.id = 'mv-menu-panel';

        const rouletteSection = document.createElement('div');
        rouletteSection.className = 'mv-menu-section';

        const heading = document.createElement('span');
        heading.className = 'mv-menu-heading';
        heading.textContent = 'Roulette';

        const sliderRow = document.createElement('div');
        sliderRow.className = 'mv-menu-slider-row';

        const countDisplay = document.createElement('span');
        countDisplay.className = 'mv-menu-count';
        countDisplay.textContent = savedCount;

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.className = 'mv-menu-slider';
        slider.min = 1;
        slider.max = 16;
        slider.value = savedCount;
        slider.addEventListener('input', () => { countDisplay.textContent = slider.value; });

        sliderRow.append(countDisplay, slider);

        // Replace / Add mode toggle.
        let rollMode = localStorage.getItem(ROULETTE_MODE_KEY) === 'add' ? 'add' : 'replace';
        const modeRow = document.createElement('div');
        modeRow.className = 'mv-menu-mode';
        const hint = document.createElement('div');
        hint.className = 'mv-menu-hint';
        const modeBtns = {};

        const rollBtn = document.createElement('button');
        rollBtn.className = 'mv-menu-roll-btn';
        rollBtn.textContent = 'Roll';
        rollBtn.addEventListener('click', () => {
            const count = parseInt(slider.value);
            localStorage.setItem(ROULETTE_COUNT_KEY, count);
            closeMenuPanel();
            loadRoulette(count, rollMode);
        });

        const applyMode = m => {
            rollMode = m;
            localStorage.setItem(ROULETTE_MODE_KEY, m);
            modeBtns.replace.classList.toggle('active', m === 'replace');
            modeBtns.add.classList.toggle('active', m === 'add');
            if (m === 'add') {
                // Cap the slider at the number of free slots — you can only add
                // as many as there's room for (16 total).
                const spare = Math.max(0, 16 - queue.length);
                slider.max = Math.max(1, spare);
                slider.disabled = rollBtn.disabled = spare <= 0;
                if (parseInt(slider.value) > spare) slider.value = String(Math.max(1, spare));
                hint.textContent = spare <= 0
                    ? 'Grid is full (16). Remove a scene to add more.'
                    : `Adds random scenes — ${spare} slot${spare === 1 ? '' : 's'} free.`;
            } else {
                slider.max = 16;
                slider.disabled = rollBtn.disabled = false;
                hint.textContent = 'Replaces every slot, including filter cards.';
            }
            countDisplay.textContent = slider.value;
        };
        [['replace', 'Replace'], ['add', 'Add']].forEach(([m, label]) => {
            const b = document.createElement('button');
            b.className = 'mv-menu-mode-btn';
            b.textContent = label;
            b.addEventListener('click', () => applyMode(m));
            modeBtns[m] = b;
            modeRow.appendChild(b);
        });
        applyMode(rollMode);

        rouletteSection.append(heading, sliderRow, modeRow, hint, rollBtn);
        panel.appendChild(rouletteSection);
        document.body.appendChild(panel);

        setTimeout(() => {
            document.addEventListener('mousedown', onMenuOutsideClick);
        }, 0);
    }

    function closeMenuPanel() {
        document.getElementById('mv-menu-panel')?.remove();
        document.removeEventListener('mousedown', onMenuOutsideClick);
    }

    function onMenuOutsideClick(e) {
        if (!e.target.closest('#mv-menu-panel') && !e.target.closest('#mv-roulette-btn')) {
            closeMenuPanel();
        }
    }

    // �"?�"? Idle auto-hide �"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?

    let idleHideTimer = null;
    function markPointerActive() {
        document.body.classList.remove('mv-idle');
        clearTimeout(idleHideTimer);
        idleHideTimer = setTimeout(() => document.body.classList.add('mv-idle'), IDLE_HIDE_MS);
    }

    // �"?�"? Init �"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?

    async function init() {
        const savedSettings = (() => {
            try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); }
            catch { return {}; }
        })();
        playerSettings = loadPlayerSettings(savedSettings);
        applyFocusMode(playerSettings.focusMode);

        // Seed the local cache from the authoritative config before
        // resolving the wall, so the player opens on the live queue.
        await seedCacheFromConfig();
        queue = await resolveQueue(getQueue());

        document.getElementById('mv-playpause-all-btn').addEventListener('click', playPauseAll);
        document.getElementById('mv-mute-all-btn').addEventListener('click', toggleMuteAll);
        document.getElementById('mv-o-all-btn').addEventListener('click', incrementAllO);
        document.getElementById('mv-focus-btn').addEventListener('click', toggleFocusMode);
        document.getElementById('mv-fullscreen-btn').addEventListener('click', toggleFullscreen);
        document.getElementById('mv-settings-btn').addEventListener('click', openSettingsModal);
        document.getElementById('mv-roulette-btn').addEventListener('click', openMenuPanel);
        document.addEventListener('fullscreenchange', applyFullscreenIcon);
        applyFullscreenIcon();
        document.addEventListener('keydown', e => {
            // Let modified chords (Ctrl/Cmd/Alt) and typing in fields pass through,
            // and stand down while a rebind capture is grabbing the next key.
            if (keybindCaptureActive) return;
            const tag = e.target.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;
            const binding = normalizeKey(e.key);
            // The one exception: a modifier the user has given a seek role,
            // pressed with a key bound to a seek action, is ours. runBinding
            // calls preventDefault, which is also what stops Alt+Left from
            // navigating back. Every other chord still belongs to the browser.
            if ((e.ctrlKey || e.metaKey || e.altKey) && !isSeekChord(e, binding)) return;
            runBinding(binding, e);
        });

        // Mouse-button shortcuts. Never hijack the left button; skip links and
        // controls so they keep their native click. preventDefault on mousedown
        // suppresses the middle-button autoscroll puck (it arms on press).
        // Capture phase so a cell/seekbar stopPropagation can't swallow it.
        document.addEventListener('mousedown', e => {
            if (keybindCaptureActive || e.button === 0) return;
            if (e.ctrlKey || e.metaKey || e.altKey) return;
            if (e.target.closest(MOUSE_BIND_EXCLUDE)) return;
            runBinding('Mouse' + e.button, e);
        }, true);
        // If the right button is bound, swallow the context menu it would open.
        document.addEventListener('contextmenu', e => {
            if (keybindCaptureActive || e.target.closest(MOUSE_BIND_EXCLUDE)) return;
            const rightBound = KEYBIND_ACTIONS.some(a => playerSettings.keybinds[a.id] === 'Mouse2');
            if (rightBound) e.preventDefault();
        });
        window.addEventListener('resize', () => {
            if (playerSettings.focusMode) applyJustifiedLayout();
        });

        document.addEventListener('mousemove', e => { updateSeekFill(e); updateLoopDrag(e); queueSeekZone(e); });
        document.addEventListener('mouseup', e => {
            commitSeek();
            activeSeek = null;
            commitLoopDrag();
            // The drag was holding the zone open; hand it back to the pointer.
            queueSeekZone(e);
        });

        // Idle auto-hide: any pointer/keyboard activity keeps the chrome up and
        // re-arms the hide timer; stillness hides it after IDLE_HIDE_MS.
        ['mousemove', 'mousedown', 'wheel', 'keydown'].forEach(ev =>
            document.addEventListener(ev, markPointerActive, { passive: true }));
        markPointerActive();

        // Close popup when clicking anywhere outside a popup or its trigger button
        document.addEventListener('mousedown', e => {
            if (!e.target.closest('.mv-vol-popup') && !e.target.closest('.mv-cell-audio-btn')) {
                closeAllPopups();
            }
        });

        await loadSceneMeta(queue);
        render();
        startProgressSaveLoop();
    }

    document.addEventListener('DOMContentLoaded', init);
})();
