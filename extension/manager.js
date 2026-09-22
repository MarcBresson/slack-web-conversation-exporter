// Cache manager page — lists every conversation cached by the content
// script's "memory" feature, with per-conversation download/clear actions.
// Runs as a plain extension page (opened by background.js), so it has no
// access to the Slack tab's document/localStorage — only ext.storage.local.

const ext = globalThis.browser ?? globalThis.chrome;
const CACHE_PREFIX = 'slack-export-cache:';

function sanitizeFilename(name) {
  return name.replace(/[^a-z0-9-_ ]/gi, '_').trim().slice(0, 80);
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(ts) {
  return ts ? new Date(parseFloat(ts) * 1000).toLocaleDateString() : '?';
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

async function loadEntries() {
  const all = await ext.storage.local.get(null);
  return Object.entries(all)
    .filter(([key]) => key.startsWith(CACHE_PREFIX))
    .map(([key, entry]) => ({ key, entry }))
    .sort((a, b) => (b.entry.updatedAt || 0) - (a.entry.updatedAt || 0));
}

function updateEmptyState() {
  document.getElementById('empty-state').hidden = document.getElementById('list').children.length > 0;
}

function renderRow(key, entry) {
  const row = document.createElement('div');
  row.className = 'row';

  const title = entry.title || entry.channel;
  const sizeBytes = new Blob([JSON.stringify(entry)]).size;

  row.innerHTML = `
    <div class="row-title"></div>
    <div class="row-meta">${entry.channel} · ${entry.messageCount} messages · ${formatDate(entry.oldestTs)} – ${formatDate(entry.newestTs)} · ${formatBytes(sizeBytes)}</div>
    <div class="row-actions">
      <button data-action="download">Download JSON</button>
      <button data-action="clear" class="danger">Clear cache</button>
    </div>
  `;
  // Set via textContent, not innerHTML, since the title comes from the
  // Slack tab's document.title and shouldn't be interpreted as markup.
  row.querySelector('.row-title').textContent = title;

  row.querySelector('[data-action="download"]').addEventListener('click', () => {
    const messages = [...entry.messages].sort((a, b) => parseFloat(a.ts) - parseFloat(b.ts));
    const filename = `slack-export-cache_${sanitizeFilename(title)}_${entry.channel}.json`;
    download(filename, {
      channel: entry.channel,
      cachedFrom: formatDate(entry.oldestTs),
      cachedThrough: formatDate(entry.newestTs),
      messageCount: entry.messageCount,
      messages,
    });
  });

  row.querySelector('[data-action="clear"]').addEventListener('click', async () => {
    const ok = confirm(
      `Clear the cached ${entry.messageCount} messages for "${title}"? This can't be undone — the next export for this conversation will re-fetch its full history.`
    );
    if (!ok) return;
    await ext.storage.local.remove(key);
    row.remove();
    updateEmptyState();
  });

  return row;
}

async function render() {
  const entries = await loadEntries();
  const list = document.getElementById('list');
  list.innerHTML = '';
  for (const { key, entry } of entries) list.appendChild(renderRow(key, entry));
  updateEmptyState();
}

render();
