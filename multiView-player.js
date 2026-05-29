(function () {
    'use strict';

    const STORAGE_KEY = 'stash-multiview-queue';
    const ROULETTE_COUNT_KEY = 'stash-multiview-roulette-count';
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

    const PROGRESS_KEY = 'stash-multiview-progress';
    const PROGRESS_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
    const PROGRESS_SAVE_INTERVAL_MS = 5000;
    const PROGRESS_MIN_SAVE = 5;
    // If a saved position is within this many seconds of the end (or past it —
    // e.g. the scene was re-encoded shorter since), don't resume: a ?start=
    // past EOF triggers an immediate error/recovery storm, and resuming into
    // the last few seconds is pointless. Start fresh instead.
    const PROGRESS_END_MARGIN = 10;

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
            gain.gain.value = 1.0;
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
        const idx = queue.indexOf(String(id));
        if (idx === -1) return;
        queue.splice(idx, 1);
        const raw = getQueue();
        if (idx < raw.length) raw.splice(idx, 1);
        saveQueue(raw);
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

    // Scroll-wheel skip. Each scroll event accumulates a delta; the actual
    // seek fires after a short idle so rapid scrolling on transcoded streams
    // doesn't trigger one reload per tick.
    const WHEEL_STEP_SECONDS = 5;
    const wheelPending = new Map(); // id -> { delta, timeout }

    function scheduleWheelSeek(id, video, delta) {
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
        }, 150);
    }

    function applyWheelSeek(id, video, delta) {
        const duration = scenes[id]?.duration || (isFinite(video.duration) ? video.duration : null);
        if (!duration) return;

        const currentSrc = video.getAttribute('src');
        const target = Math.max(0, Math.min(duration - 0.5, effectivePlayhead(video, id) + delta));

        if (isTranscodeUrl(currentSrc)) {
            seekBases.set(id, target);
            const wasPlaying = !video.paused;
            showSpinner(document.querySelector(`.mv-cell[data-scene-id="${id}"]`));
            video.src = withStart(stripStart(currentSrc), target);
            if (wasPlaying || video.autoplay) video.play().catch(() => {});
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

    function loadPlayerSettings(saved = {}) {
        return {
            directPlay: saved.directPlay ?? false,
            quality: { ...DEFAULT_QUALITY, ...(saved.quality || {}) },
            focusMode: saved.focusMode ?? false,
            wheelSeek: saved.wheelSeek ?? false
        };
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
        });
        swRow.append(swText, swToggle);

        // Quality section
        const qualSection = document.createElement('div');
        qualSection.className = 'mv-settings-qual-section';
        const qualHeading = document.createElement('span');
        qualHeading.className = 'mv-settings-section-heading';
        qualHeading.textContent = 'Quality per Grid Size';
        qualSection.appendChild(qualHeading);

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
            qualSection.appendChild(row);
        });

        dpToggle.addEventListener('change', () => {
            playerSettings.directPlay = dpToggle.checked;
            savePlayerSettings();
            Object.values(selects).forEach(sel => { sel.disabled = dpToggle.checked; });
            applyQualityToAllCells();
        });

        card.append(header, dpRow, swRow, qualSection);
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
        const positions = computeJustifiedLayout(aspectRatios, containerWidth, containerHeight, GAP);
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

    function updateSeekFill(e) {
        if (!activeSeek) return;
        const rect = activeSeek.seekbar.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        activeSeek.ratio = ratio;
        activeSeek.fill.style.transform = 'scaleX(' + ratio + ')';
    }

    function commitSeek() {
        if (!activeSeek || activeSeek.ratio == null) return;
        const { video, id, ratio } = activeSeek;
        // A single click fires both mousedown and mouseup, each calling
        // commitSeek with the same ratio. Without this guard the transcoder
        // gets two back-to-back src reassignments at the same offset.
        if (activeSeek.lastCommittedRatio === ratio) return;
        activeSeek.lastCommittedRatio = ratio;
        const duration = scenes[id]?.duration || (isFinite(video.duration) ? video.duration : null);
        if (!duration) return;

        const targetTime = ratio * duration;
        const currentSrc = video.getAttribute('src');

        if (isTranscodeUrl(currentSrc)) {
            seekBases.set(id, targetTime);
            const wasPlaying = !video.paused;
            showSpinner(document.querySelector(`.mv-cell[data-scene-id="${id}"]`));
            video.src = withStart(stripStart(currentSrc), targetTime);
            if (wasPlaying || video.autoplay) video.play().catch(() => {});
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
        queue.forEach((id, idx) => {
            if (typeof id !== 'string') return;
            if (existing.has(id)) return;

            const cell = document.createElement('div');
            const isFilterBacked = filterBackedCells.has(id);
            cell.className = 'mv-cell' + (isFilterBacked ? ' mv-cell--filter' : '');
            cell.dataset.sceneId = id;


            const video = document.createElement('video');
            const baseSrc = pickStream(id);
            let resumeTime = isFilterBacked ? 0 : getResumeTime(id);
            const dur = scenes[id]?.duration;
            if (resumeTime > 0 && dur && resumeTime > dur - PROGRESS_END_MARGIN) {
                // Stale/at-or-past-end offset (scene re-encoded shorter, or saved
                // right at the end). Start fresh rather than ?start= past EOF.
                resumeTime = 0;
                clearResumeTime(id);
            }
            const isTranscodeSrc = isTranscodeUrl(baseSrc);
            // A transcode resumed via ?start= only contains [resumeTime, end], so
            // native loop would replay just that tail forever. Start it unlooped
            // and re-seat to the full scene when the first partial pass ends.
            const resumedTranscode = resumeTime > 0 && isTranscodeSrc && !isFilterBacked;
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
            video.autoplay = true;
            video.loop = !isFilterBacked && !resumedTranscode;
            if (resumedTranscode) {
                // First (partial) pass done — reload from the start so subsequent
                // loops play the whole scene, then hand back to native loop.
                video.addEventListener('ended', () => {
                    seekBases.set(id, 0);
                    video.src = baseSrc;
                    video.loop = true;
                    video.play().catch(() => {});
                }, { once: true });
            }
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
                const dur = scenes[id]?.duration || (isFinite(video.duration) ? video.duration : null);
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

            controls.append(oBtn, audioBtn, removeBtn);
            overlay.append(sceneTitleEl, centerControls, controls);

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
            slider.title = 'Volume (0�?"200%)';
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
                if (duration) seekFill.style.transform = 'scaleX(' + (effectivePlayhead(video, id) / duration) + ')';
            };

            video.addEventListener('timeupdate', () => {
                if (video.seeking) return;
                updateProgress();
            });

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
                activeSeek = { seekbar, fill: seekFill, video, id, ratio: null };
                updateSeekFill(e);
                commitSeek(); // immediate jump on click
            });

            cell.addEventListener('wheel', e => {
                if (!playerSettings.wheelSeek) return;
                // Don't hijack scrolling inside the volume popup (its slider
                // is wheel-adjustable in the browser by default).
                if (e.target.closest('.mv-vol-popup')) return;
                e.preventDefault();
                const delta = e.deltaY < 0 ? WHEEL_STEP_SECONDS : -WHEEL_STEP_SECONDS;
                scheduleWheelSeek(id, video, delta);
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

    window.addEventListener('storage', e => {
        if (e.key !== STORAGE_KEY) return;
        resolveQueuePreserving(getQueue()).then(resolved => {
            queue = resolved;
            loadSceneMeta(queue).then(render);
        });
    });

    // �"?�"? Roulette �"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?

    async function loadRoulette(count) {
        try {
            const res = await fetch('/graphql', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    query: `query { findScenes(filter: { per_page: ${count}, sort: "random" }) { scenes { id } } }`
                })
            });
            const data = await res.json();
            const ids = (data?.data?.findScenes?.scenes || []).map(s => String(s.id));
            if (!ids.length) return;
            // Save as filter slots so reopening the player loads fresh random scenes
            const rouletteSlots = Array.from({ length: ids.length }, () => ({ type: 'filter', filter: {} }));
            saveQueue(rouletteSlots);
            // In-memory: use already-fetched IDs, registered as filter-backed for auto-advance
            filterBackedCells.clear();
            const rouletteFilter = { type: 'filter', filter: {} };
            ids.forEach(id => filterBackedCells.set(id, rouletteFilter));
            queue = ids;
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

        const rollBtn = document.createElement('button');
        rollBtn.className = 'mv-menu-roll-btn';
        rollBtn.textContent = 'Roll';
        rollBtn.addEventListener('click', () => {
            const count = parseInt(slider.value);
            localStorage.setItem(ROULETTE_COUNT_KEY, count);
            closeMenuPanel();
            loadRoulette(count);
        });

        rouletteSection.append(heading, sliderRow, rollBtn);
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

    // �"?�"? Init �"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?�"?

    async function init() {
        const savedSettings = (() => {
            try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); }
            catch { return {}; }
        })();
        playerSettings = loadPlayerSettings(savedSettings);
        applyFocusMode(playerSettings.focusMode);

        queue = await resolveQueue(getQueue());

        document.getElementById('mv-playpause-all-btn').addEventListener('click', playPauseAll);
        document.getElementById('mv-mute-all-btn').addEventListener('click', toggleMuteAll);
        document.getElementById('mv-o-all-btn').addEventListener('click', incrementAllO);
        document.getElementById('mv-focus-btn').addEventListener('click', toggleFocusMode);
        document.getElementById('mv-settings-btn').addEventListener('click', openSettingsModal);
        document.getElementById('mv-roulette-btn').addEventListener('click', openMenuPanel);
        document.addEventListener('keydown', e => {
            if (e.key === 'f' || e.key === 'F') toggleFocusMode();
            else if (e.key === 'm' || e.key === 'M') toggleMuteAll();
            else if (e.key === 'p' || e.key === 'P') playPauseAll();
        });
        window.addEventListener('resize', () => {
            if (playerSettings.focusMode) applyJustifiedLayout();
        });

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
        startProgressSaveLoop();
    }

    document.addEventListener('DOMContentLoaded', init);
})();
