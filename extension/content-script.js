// Slack conversation exporter — extension content script.
//
// Export logic here intentionally diverges from ../slack-export.js (the
// DevTools console-paste fallback): this version adds a per-channel cache
// in extension storage so re-exporting only fetches new/older deltas
// instead of re-walking the whole history every time. Don't backport this
// caching behavior into slack-export.js — it's meant to stay a simple,
// cache-free tool.
//
// This version also shows/hides the panel on demand (toggled by
// background.js relaying toolbar icon clicks) instead of building it
// immediately on load.

(() => {
  const ext = globalThis.browser ?? globalThis.chrome;
  const PANEL_ID = 'slack-export-panel';
  const TOGGLE_MESSAGE = 'slack-export:toggle-panel';
  const OPEN_MANAGER_MESSAGE = 'slack-export:open-manager';

  function getToken() {
    const raw = localStorage.getItem('localConfig_v2');
    if (!raw) throw new Error('localConfig_v2 not found — is this a Slack tab?');
    const cfg = JSON.parse(raw);
    const teams = cfg.teams || {};
    const teamId = cfg.lastActiveTeamId && teams[cfg.lastActiveTeamId]
      ? cfg.lastActiveTeamId
      : Object.keys(teams)[0];
    if (!teamId) throw new Error('No team found in localConfig_v2.');
    const token = teams[teamId].token;
    if (!token) throw new Error(`No token found for team ${teamId}.`);
    return token;
  }

  function getChannelId() {
    const match = location.pathname.match(/\/([CDG][A-Z0-9]{7,})(?:\/|$)/);
    if (!match) throw new Error('No channel ID found in the URL — open a conversation first.');
    return match[1];
  }

  function sanitizeFilename(name) {
    return name.replace(/[^a-z0-9-_ ]/gi, '_').trim().slice(0, 80);
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function fetchPage(token, channel, { cursor, latest } = {}) {
    const body = new URLSearchParams({
      token,
      channel,
      limit: '200',
      ignore_replies: 'true',
      inclusive: 'true',
    });
    if (cursor) body.set('cursor', cursor);
    else if (latest) body.set('latest', latest);

    const res = await fetch('/api/conversations.history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      credentials: 'same-origin',
    });

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('Retry-After') || '5');
      await sleep(retryAfter * 1000);
      return fetchPage(token, channel, { cursor, latest });
    }

    const data = await res.json();
    if (!data.ok) throw new Error(`Slack API error: ${data.error || 'unknown'}`);
    return data;
  }

  // Walks backward from `startLatest` (or "now" if omitted) until a page's
  // oldest message is at/before `untilTs`, or history runs out. Used for
  // the full fetch, the forward-fill (bounded by the cache's newest ts),
  // and the backfill (seeded from the cache's oldest ts) — see
  // exportConversation below.
  async function fetchBackwardUntil(token, channel, { startLatest, untilTs, onProgress } = {}) {
    const byTs = new Map();
    let cursor;
    let latest = startLatest;
    let page = 0;
    let stoppedOnBound = false;

    for (;;) {
      page += 1;
      const data = await fetchPage(token, channel, { cursor, latest });
      const msgs = data.messages || [];
      for (const m of msgs) byTs.set(m.ts, m);

      const oldestTs = msgs.length ? parseFloat(msgs[msgs.length - 1].ts) : null;
      onProgress({ page, total: byTs.size, oldestTs });

      if (!msgs.length || !data.has_more) break;
      if (oldestTs !== null && oldestTs <= untilTs) {
        stoppedOnBound = true;
        break;
      }

      cursor = data.response_metadata && data.response_metadata.next_cursor;
      latest = cursor ? undefined : String(oldestTs);

      await sleep(500);
    }

    return { byTs, stoppedOnBound };
  }

  function computeBounds(map) {
    let oldestTs = null;
    let newestTs = null;
    for (const ts of map.keys()) {
      if (oldestTs === null || parseFloat(ts) < parseFloat(oldestTs)) oldestTs = ts;
      if (newestTs === null || parseFloat(ts) > parseFloat(newestTs)) newestTs = ts;
    }
    return { oldestTs, newestTs };
  }

  function filterAndSort(map, untilTs) {
    return [...map.values()]
      .filter((m) => parseFloat(m.ts) >= untilTs)
      .sort((a, b) => parseFloat(a.ts) - parseFloat(b.ts));
  }

  // --- per-channel cache, in extension storage ---
  function cacheKey(channel) {
    return `slack-export-cache:${channel}`;
  }

  async function loadCache(channel) {
    const key = cacheKey(channel);
    const result = await ext.storage.local.get(key);
    const entry = result[key];
    return entry && entry.schemaVersion === 1 ? entry : null;
  }

  async function saveCache(channel, entry) {
    await ext.storage.local.set({
      [cacheKey(channel)]: { ...entry, schemaVersion: 1, updatedAt: Date.now() },
    });
  }

  async function exportConversation({ token, channel, untilTs, forceResync, onProgress }) {
    const existingCache = await loadCache(channel);
    const cache = forceResync ? null : existingCache;
    onProgress({ phase: 'cache-status', cache, existingCache, forceResync, untilTs });

    if (!cache) {
      const { byTs: map } = await fetchBackwardUntil(token, channel, {
        untilTs,
        onProgress: (p) => onProgress({ phase: 'full', ...p }),
      });
      await saveCache(channel, {
        channel,
        title: document.title,
        ...computeBounds(map),
        messageCount: map.size,
        messages: [...map.values()],
      });
      return filterAndSort(map, untilTs);
    }

    const merged = new Map(cache.messages.map((m) => [m.ts, m]));

    const { byTs: freshMap, stoppedOnBound } = await fetchBackwardUntil(token, channel, {
      untilTs: parseFloat(cache.newestTs),
      onProgress: (p) => onProgress({ phase: 'forward-fill', ...p }),
    });
    if (!stoppedOnBound) {
      console.warn(
        `slack-export: forward-fill for ${channel} ran out of history before reaching the cached newest message (ts ${cache.newestTs}) — it may have been deleted on Slack's side. Refetched from the beginning of the new range instead.`
      );
    }
    for (const [ts, m] of freshMap) merged.set(ts, m);

    await saveCache(channel, {
      channel,
      title: document.title,
      ...computeBounds(merged),
      messageCount: merged.size,
      messages: [...merged.values()],
    });

    if (untilTs < parseFloat(cache.oldestTs)) {
      const { byTs: olderMap } = await fetchBackwardUntil(token, channel, {
        startLatest: cache.oldestTs,
        untilTs,
        onProgress: (p) => onProgress({ phase: 'backfill', ...p }),
      });
      for (const [ts, m] of olderMap) merged.set(ts, m);

      await saveCache(channel, {
        channel,
        title: document.title,
        ...computeBounds(merged),
        messageCount: merged.size,
        messages: [...merged.values()],
      });
    }

    return filterAndSort(merged, untilTs);
  }

  function download(filename, dataObj) {
    const blob = new Blob([JSON.stringify(dataObj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function formatCacheCaption(cache) {
    if (!cache) return 'No cache yet for this channel.';
    const oldestDate = new Date(parseFloat(cache.oldestTs) * 1000).toLocaleDateString();
    return `Cached: ${cache.messageCount} messages (through ${oldestDate})`;
  }

  // --- UI ---
  function buildPanel() {
    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.style.cssText = `
      position: fixed; bottom: 20px; right: 20px; z-index: 999999;
      background: #1a1d21; color: #fff; font-family: -apple-system, sans-serif;
      font-size: 13px; padding: 14px 16px; border-radius: 8px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.4); width: 260px; position: fixed;
    `;

    let detectedChannel = 'unknown';
    let detectError = '';
    try {
      detectedChannel = getChannelId();
    } catch (err) {
      detectError = err.message;
    }

    panel.innerHTML = `
      <div style="position:relative;">
        <div style="font-weight:600; margin-bottom:8px;">Slack conversation export</div>
        <div id="slack-export-close" style="position:absolute; top:-4px; right:0; cursor:pointer; opacity:0.6;">✕</div>
      </div>
      <div style="margin-bottom:4px; opacity:0.85;">Channel: ${detectedChannel}</div>
      <div id="slack-export-cache-info" style="margin-bottom:4px; opacity:0.6; font-size:12px;">Checking cache…</div>
      <div style="margin-bottom:8px;"><a id="slack-export-view-cache" href="#" style="color:#8ab4f8; font-size:12px; text-decoration:none;">View all cached conversations →</a></div>
      <div style="margin-bottom:8px;">Export back to date:</div>
      <input id="slack-export-date" type="date" style="width:100%; box-sizing:border-box; margin-bottom:10px; padding:4px;">
      <label style="display:flex; align-items:center; gap:6px; margin-bottom:10px; cursor:pointer;">
        <input id="slack-export-force" type="checkbox">
        Force full re-sync (ignore cache, refetch everything)
      </label>
      <button id="slack-export-btn" style="width:100%; padding:6px; cursor:pointer;">Export</button>
      <div id="slack-export-status" style="margin-top:8px; font-size:12px; opacity:0.85; white-space:pre-wrap;">${detectError}</div>
    `;
    document.body.appendChild(panel);

    panel.querySelector('#slack-export-close').addEventListener('click', () => panel.remove());

    panel.querySelector('#slack-export-view-cache').addEventListener('click', (e) => {
      e.preventDefault();
      ext.runtime.sendMessage({ type: OPEN_MANAGER_MESSAGE });
    });

    const cacheInfoEl = panel.querySelector('#slack-export-cache-info');
    const statusEl = panel.querySelector('#slack-export-status');
    const btn = panel.querySelector('#slack-export-btn');
    const dateInput = panel.querySelector('#slack-export-date');
    const forceResyncInput = panel.querySelector('#slack-export-force');

    if (detectedChannel === 'unknown') {
      cacheInfoEl.textContent = '';
    } else {
      loadCache(detectedChannel)
        .then((cache) => { cacheInfoEl.textContent = formatCacheCaption(cache); })
        .catch((err) => { cacheInfoEl.textContent = `Cache check failed: ${err.message}`; });
    }

    btn.addEventListener('click', async () => {
      if (!dateInput.value) {
        statusEl.textContent = 'Pick a date first.';
        return;
      }

      btn.disabled = true;
      dateInput.disabled = true;
      forceResyncInput.disabled = true;
      statusEl.textContent = 'Starting…';

      try {
        const token = getToken();
        const channel = getChannelId();
        const untilTs = new Date(`${dateInput.value}T00:00:00`).getTime() / 1000;
        const forceResync = forceResyncInput.checked;

        const messages = await exportConversation({
          token,
          channel,
          untilTs,
          forceResync,
          onProgress: (info) => {
            if (info.phase === 'cache-status') {
              if (info.forceResync) {
                statusEl.textContent = info.existingCache
                  ? `Ignoring cached ${info.existingCache.messageCount} messages (forced) — running a full re-sync…`
                  : 'No cache to ignore — running a full sync…';
                return;
              }
              if (!info.cache) {
                statusEl.textContent = 'No cache yet for this channel — running a full sync…';
                return;
              }
              const oldestDate = new Date(parseFloat(info.cache.oldestTs) * 1000).toLocaleDateString();
              let text = `Loaded cache: ${info.cache.messageCount} messages (through ${oldestDate}). Checking for new messages…`;
              if (info.untilTs < parseFloat(info.cache.oldestTs)) {
                text += `\nCache doesn't cover back to ${dateInput.value} — will backfill older history after that.`;
              }
              statusEl.textContent = text;
              return;
            }

            const oldestStr = info.oldestTs ? new Date(info.oldestTs * 1000).toLocaleDateString() : '?';
            const label = info.phase === 'forward-fill'
              ? 'Checking for new messages since last sync'
              : info.phase === 'backfill'
                ? 'Backfilling older history before the cache'
                : 'Full re-sync';
            statusEl.textContent = `${label} — page ${info.page} (${info.total} messages so far, oldest so far: ${oldestStr})`;
          },
        });

        const filename = `slack-export_${sanitizeFilename(document.title)}_${channel}_until-${dateInput.value}.json`;
        download(filename, {
          channel,
          exportedUntil: dateInput.value,
          messageCount: messages.length,
          messages,
        });

        statusEl.textContent = `Done — ${messages.length} messages exported to ${filename}`;
        loadCache(channel).then((cache) => { cacheInfoEl.textContent = formatCacheCaption(cache); });
      } catch (err) {
        statusEl.textContent = `Error: ${err.message}`;
        console.error(err);
      } finally {
        btn.disabled = false;
        dateInput.disabled = false;
        forceResyncInput.disabled = false;
      }
    });
  }

  function toggleExportPanel() {
    const existing = document.getElementById(PANEL_ID);
    if (existing) {
      existing.remove();
      return;
    }
    buildPanel();
  }

  ext.runtime.onMessage.addListener((message) => {
    if (message?.type === TOGGLE_MESSAGE) toggleExportPanel();
  });
})();
