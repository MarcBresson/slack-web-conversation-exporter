// Slack conversation exporter — paste into the DevTools console
// while the conversation you want to export is open in the tab.
// Mirrors extension/content-script.js — keep the two in sync if you change
// the export logic. The extension version toggles on toolbar-icon click
// instead of running immediately.
//
// Usage:
//   1. Open the conversation (DM/channel) in Slack, in the browser.
//   2. Open DevTools console (Cmd+Option+J), paste this whole file, press Enter.
//   3. A small panel appears bottom-right. Pick the date to export back to.
//   4. Click "Export" — a JSON file downloads when it's done.
//   5. Re-run on any other conversation the same way, no edits needed.

(() => {
  const PANEL_ID = 'slack-export-panel';
  document.getElementById(PANEL_ID)?.remove();

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

  async function exportConversation({ token, channel, untilTs, onProgress }) {
    const byTs = new Map();
    let cursor;
    let latest;
    let page = 0;

    for (;;) {
      page += 1;
      const data = await fetchPage(token, channel, { cursor, latest });
      const msgs = data.messages || [];
      for (const m of msgs) byTs.set(m.ts, m);

      const oldestTs = msgs.length ? parseFloat(msgs[msgs.length - 1].ts) : null;
      onProgress({ page, total: byTs.size, oldestTs });

      if (!msgs.length || !data.has_more) break;
      if (oldestTs !== null && oldestTs <= untilTs) break;

      cursor = data.response_metadata && data.response_metadata.next_cursor;
      latest = cursor ? undefined : String(oldestTs);

      await sleep(500);
    }

    return [...byTs.values()]
      .filter((m) => parseFloat(m.ts) >= untilTs)
      .sort((a, b) => parseFloat(a.ts) - parseFloat(b.ts));
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

  // --- UI ---
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
    <div style="margin-bottom:8px; opacity:0.85;">Channel: ${detectedChannel}</div>
    <div style="margin-bottom:8px;">Export back to date:</div>
    <input id="slack-export-date" type="date" style="width:100%; box-sizing:border-box; margin-bottom:10px; padding:4px;">
    <button id="slack-export-btn" style="width:100%; padding:6px; cursor:pointer;">Export</button>
    <div id="slack-export-status" style="margin-top:8px; font-size:12px; opacity:0.85; white-space:pre-wrap;">${detectError}</div>
  `;
  document.body.appendChild(panel);

  panel.querySelector('#slack-export-close').addEventListener('click', () => panel.remove());

  const statusEl = panel.querySelector('#slack-export-status');
  const btn = panel.querySelector('#slack-export-btn');
  const dateInput = panel.querySelector('#slack-export-date');

  btn.addEventListener('click', async () => {
    if (!dateInput.value) {
      statusEl.textContent = 'Pick a date first.';
      return;
    }

    btn.disabled = true;
    dateInput.disabled = true;
    statusEl.textContent = 'Starting…';

    try {
      const token = getToken();
      const channel = getChannelId();
      const untilTs = new Date(`${dateInput.value}T00:00:00`).getTime() / 1000;

      const messages = await exportConversation({
        token,
        channel,
        untilTs,
        onProgress: ({ page, total, oldestTs }) => {
          const oldestStr = oldestTs ? new Date(oldestTs * 1000).toLocaleDateString() : '?';
          statusEl.textContent = `Page ${page} — ${total} messages so far (oldest so far: ${oldestStr})`;
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
    } catch (err) {
      statusEl.textContent = `Error: ${err.message}`;
      console.error(err);
    } finally {
      btn.disabled = false;
      dateInput.disabled = false;
    }
  });
})();
