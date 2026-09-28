// Builds a self-contained, standalone HTML export of a Slack conversation
// from the same raw data object the JSON exporters download (the
// { channel, messages, ... } shape used by both the panel export and the
// cache manager's per-conversation download). The generated file embeds
// the raw JSON verbatim plus CSS/JS that renders it to resemble the Slack
// UI — it has no dependency on this extension once downloaded.
//
// Image/file thumbnails are Slack-hosted URLs and only load in the
// exported file if the viewer is also logged into Slack in that browser;
// otherwise they fall back to a placeholder card (see .file-image.broken
// in slackExportCss).
//
// Loaded as a plain script (not a module) via <script src> in both
// manager.html and manifest.json's content_scripts, so buildSlackExportHtml
// is a plain global function. slack-export.js (the DevTools console-paste
// tool) inlines its own copy of this same function — see the note there —
// to keep that file a single self-contained paste.

function buildSlackExportHtml(dataObj) {
  const title = 'Slack export — ' + (dataObj.name || dataObj.channel || 'conversation');
  const jsonPayload = JSON.stringify(dataObj).replace(/</g, '\\u003c');

  return (
    '<!doctype html>\n<html>\n<head>\n<meta charset="utf-8">\n' +
    '<title>' + escapeHtmlForAttr(title) + '</title>\n' +
    '<style>' + slackExportCss() + '</style>\n' +
    '</head>\n<body>\n' +
    '<div id="app"><div id="loading">Rendering…</div></div>\n' +
    '<script type="application/json" id="slack-export-data">' + jsonPayload + '</script>\n' +
    '<script>(' + slackExportRenderer.toString() + ')();</script>\n' +
    '</body>\n</html>\n'
  );
}

function escapeHtmlForAttr(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Plain string, not a template literal with interpolation, so it's safe to
// splice verbatim into the generated <style> tag.
function slackExportCss() {
  return [
    ':root { color-scheme: dark; }',
    '* { box-sizing: border-box; }',
    'body { margin: 0; background: #1a1d21; color: #d1d2d3; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; font-size: 15px; }',
    '#app { max-width: 900px; margin: 0 auto; padding-bottom: 60px; }',
    '#loading { padding: 40px; text-align: center; color: #8a8d91; }',
    '.export-header { position: sticky; top: 0; background: #1a1d21; border-bottom: 1px solid #35373b; padding: 16px 20px; z-index: 5; }',
    '.export-title { font-size: 18px; font-weight: 800; color: #fff; }',
    '.export-meta { font-size: 13px; color: #ababad; margin-top: 2px; }',
    '.export-note { font-size: 12px; color: #8a8d91; margin-top: 6px; font-style: italic; }',
    '.date-divider { display: flex; align-items: center; gap: 12px; margin: 18px 20px 10px; color: #ababad; font-size: 12px; font-weight: 700; }',
    '.date-divider::before, .date-divider::after { content: ""; flex: 1; height: 1px; background: #35373b; }',
    '.system-message { margin: 4px 20px; font-size: 13px; color: #8a8d91; font-style: italic; }',
    '.message-row { display: flex; gap: 10px; padding: 8px 20px 2px; }',
    '.message-row:hover { background: #222529; }',
    '.avatar { width: 36px; height: 36px; border-radius: 6px; flex: 0 0 36px; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 700; color: #fff; overflow: hidden; }',
    '.avatar img { width: 100%; height: 100%; object-fit: cover; }',
    '.message-content { flex: 1; min-width: 0; }',
    '.message-head { display: flex; align-items: baseline; gap: 8px; }',
    '.sender { font-weight: 900; color: #fff; font-size: 15px; }',
    '.timestamp { font-size: 12px; color: #8a8d91; }',
    '.edited-tag { font-size: 11px; color: #8a8d91; }',
    '.message-line { padding: 1px 0; }',
    '.message-line:hover { background: #222529; margin: 0 -20px; padding: 1px 20px; }',
    '.message-text { white-space: normal; line-height: 1.46; word-wrap: break-word; }',
    '.grouped-ts { display: inline-block; width: 42px; color: #8a8d91; font-size: 11px; }',
    '.message-text code { background: #222529; padding: 1px 4px; border-radius: 3px; font-family: SFMono-Regular, Consolas, monospace; font-size: 0.85em; }',
    '.message-text pre.code-block { background: #222529; border: 1px solid #35373b; border-radius: 4px; padding: 8px 10px; overflow-x: auto; font-family: SFMono-Regular, Consolas, monospace; font-size: 0.85em; white-space: pre-wrap; }',
    '.mention { background: rgba(29, 155, 209, 0.15); color: #1d9bd1; border-radius: 3px; padding: 0 2px; font-weight: 600; }',
    '.message-text a { color: #1d9bd1; text-decoration: none; }',
    '.message-text a:hover { text-decoration: underline; }',
    '.files, .reactions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }',
    '.file-image img { max-width: 360px; max-height: 360px; border-radius: 6px; border: 1px solid #35373b; display: block; }',
    '.file-image.broken { display: flex; align-items: center; justify-content: center; width: 280px; height: 120px; border: 1px dashed #35373b; border-radius: 6px; color: #8a8d91; font-size: 12px; text-align: center; padding: 10px; }',
    '.file-image.broken img { display: none; }',
    '.file-card { display: flex; align-items: center; gap: 8px; border: 1px solid #35373b; border-radius: 6px; padding: 8px 10px; text-decoration: none; color: inherit; max-width: 280px; }',
    '.file-card:hover { background: #222529; }',
    '.file-icon { font-size: 20px; }',
    '.file-meta { display: flex; flex-direction: column; min-width: 0; }',
    '.file-name { font-size: 13px; color: #d1d2d3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
    '.file-sub { font-size: 11px; color: #8a8d91; }',
    '.file-card.deleted { color: #8a8d91; font-style: italic; }',
    '.call-card { display: flex; align-items: center; gap: 10px; border: 1px solid #35373b; border-radius: 6px; padding: 10px 12px; margin-top: 6px; max-width: 320px; }',
    '.call-icon { font-size: 20px; }',
    '.call-title { font-weight: 700; font-size: 13px; color: #fff; }',
    '.call-sub { font-size: 12px; color: #8a8d91; }',
    '.huddle-block { margin: 6px 20px; }',
    '.huddle-card { display: flex; align-items: center; gap: 10px; border: 1px solid #35373b; border-radius: 6px; padding: 8px 12px; max-width: 300px; background: #222529; }',
    '.huddle-block .thread-replies { margin-left: 0; }',
    '.reaction { display: inline-flex; align-items: center; gap: 4px; background: #222529; border: 1px solid #35373b; border-radius: 12px; padding: 2px 8px; font-size: 12.5px; cursor: default; }',
    '.reaction-count { color: #8a8d91; }',
    '.thread-footer { margin-top: 6px; display: inline-flex; align-items: center; gap: 6px; color: #1d9bd1; font-size: 13px; cursor: default; }',
    '.thread-footer.clickable { cursor: pointer; }',
    '.thread-footer.clickable:hover { text-decoration: underline; }',
    '.thread-toggle { display: inline-block; width: 8px; font-size: 10px; }',
    '.thread-replies { margin: 6px 0 4px 46px; padding-left: 12px; border-left: 2px solid #35373b; }',
    '.thread-reply { display: flex; gap: 8px; padding: 6px 0; }',
    '.thread-reply .avatar { width: 28px; height: 28px; flex: 0 0 28px; font-size: 11px; }',
    '.thread-reply .sender { font-size: 13px; }',
  ].join('\n');
}

// Runs inside the exported HTML file itself (embedded via .toString()), not
// in the extension. Must be self-contained — no closures over anything in
// html-export.js — and avoid template literals with backtick-sensitive
// nesting concerns since it's spliced into an outer <script> tag as text.
function slackExportRenderer() {
  var EMOJI_MAP = {
    thumbsup: '👍', '+1': '👍', '-1': '👎', thumbsdown: '👎',
    heart: '❤️', heavy_heart: '❤️', joy: '😂', laughing: '😆',
    smile: '🙂', slightly_smiling_face: '🙂', grinning: '😀',
    tada: '🎉', fire: '🔥', eyes: '👀', clap: '👏',
    raised_hands: '🙌', white_check_mark: '✅', heavy_check_mark: '✔️',
    x: '❌', thinking_face: '🤔', pray: '🙏', rocket: '🚀',
    100: '💯', wave: '👋', point_up: '👆', ok_hand: '👌',
    muscle: '💪', sob: '😭', cry: '😢', angry: '😠',
    confused: '😕', wink: '😉', blush: '😊', sunglasses: '😎',
    heart_eyes: '😍', pray1: '🙏',
  };
  var SYSTEM_SUBTYPES = [
    'channel_join', 'channel_leave', 'channel_topic', 'channel_purpose', 'channel_name',
    'channel_archive', 'channel_unarchive', 'pinned_item', 'unpinned_item', 'bot_add', 'bot_remove',
  ];

  // Populated from the embedded data in render() and read by the helpers
  // below — resolved usernames/avatars (from users.info) and fetched thread
  // replies (from conversations.replies), both keyed by ID/thread ts.
  var USERS = {};
  var THREADS = {};

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtTime(ts) {
    var d = new Date(parseFloat(ts) * 1000);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function fmtDateHeader(ts) {
    var d = new Date(parseFloat(ts) * 1000);
    return d.toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  }

  function fmtBytes(n) {
    if (!n) return '';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function userColor(key) {
    var str = String(key || 'x');
    var hash = 0;
    for (var i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
    return 'hsl(' + (hash % 360) + ', 45%, 42%)';
  }

  function initials(name) {
    var clean = String(name || '?').replace(/[^A-Za-z0-9]/g, '');
    return clean ? clean.slice(0, 2).toUpperCase() : '?';
  }

  function senderName(msg) {
    if (msg.username) return msg.username;
    if (msg.bot_profile && msg.bot_profile.name) return msg.bot_profile.name;
    if (msg.user && USERS[msg.user]) {
      var u = USERS[msg.user];
      return u.display_name || u.real_name || u.name || msg.user;
    }
    if (msg.user) return msg.user;
    if (msg.bot_id) return msg.bot_id;
    return 'Unknown';
  }

  function avatarHtml(msg) {
    var key = msg.user || msg.username || msg.bot_id || 'x';
    var userInfo = msg.user && USERS[msg.user];
    var iconUrl = (msg.icons && msg.icons.image_48) ||
      (msg.bot_profile && msg.bot_profile.icons && msg.bot_profile.icons.image_48) ||
      (userInfo && userInfo.image_48);
    var bg = userColor(key);
    var label = escapeHtml(initials(senderName(msg)));
    if (iconUrl) {
      return '<div class="avatar" style="background:' + bg + '"><img src="' + escapeHtml(iconUrl) +
        '" alt="" onerror="this.parentNode.textContent=\'' + label.replace(/'/g, "\\'") + '\'"></div>';
    }
    return '<div class="avatar" style="background:' + bg + '">' + label + '</div>';
  }

  function parseMrkdwn(text) {
    if (!text) return '';
    var out = escapeHtml(text);
    out = out.replace(/&lt;(@[UW][A-Z0-9]+)(\|([^&]*?))?&gt;/g, function (_, idWithAt, __, label) {
      var rawId = idWithAt.slice(1);
      var name = label;
      if (!name) {
        var u = USERS[rawId];
        var resolved = u && (u.display_name || u.real_name || u.name);
        name = resolved ? escapeHtml(resolved) : rawId;
      }
      return '<span class="mention">@' + name + '</span>';
    });
    out = out.replace(/&lt;#([C][A-Z0-9]+)\|([^&]*?)&gt;/g, function (_, id, name) {
      return '<span class="mention">#' + name + '</span>';
    });
    out = out.replace(/&lt;!(here|channel|everyone)&gt;/g, function (_, kw) {
      return '<span class="mention">@' + kw + '</span>';
    });
    out = out.replace(/&lt;(https?:\/\/[^|&]+)\|([^&]*?)&gt;/g, function (_, url, label) {
      return '<a href="' + url + '" target="_blank" rel="noopener">' + label + '</a>';
    });
    out = out.replace(/&lt;(https?:\/\/[^&]+?)&gt;/g, function (_, url) {
      return '<a href="' + url + '" target="_blank" rel="noopener">' + url + '</a>';
    });
    out = out.replace(/```([\s\S]+?)```/g, function (_, code) {
      return '<pre class="code-block">' + code + '</pre>';
    });
    out = out.replace(/`([^`]+?)`/g, '<code>$1</code>');
    out = out.replace(/\*([^*\n]+?)\*/g, '<b>$1</b>');
    out = out.replace(/_([^_\n]+?)_/g, '<i>$1</i>');
    out = out.replace(/~([^~\n]+?)~/g, '<s>$1</s>');
    out = out.replace(/:([a-z0-9_+-]+):/g, function (_, name) {
      var emoji = EMOJI_MAP[name];
      return emoji ? emoji : ':' + name + ':';
    });
    out = out.replace(/\n/g, '<br>');
    return out;
  }

  function fileIcon(file) {
    var ft = (file.filetype || '').toLowerCase();
    var name = (file.name || '').toLowerCase();
    if (ft === 'pdf' || name.slice(-4) === '.pdf') return '📕';
    if (ft === 'doc' || ft === 'docx') return '📄';
    if (ft === 'xls' || ft === 'xlsx' || ft === 'csv') return '📊';
    if (ft === 'ppt' || ft === 'pptx') return '📽️';
    if (['zip', 'rar', '7z', 'tar', 'gz'].indexOf(ft) !== -1) return '🗜️';
    if (['mp3', 'wav', 'm4a', 'ogg'].indexOf(ft) !== -1) return '🎵';
    if (['mp4', 'mov', 'avi', 'webm'].indexOf(ft) !== -1) return '🎬';
    if (ft === 'txt' || ft === 'md') return '📝';
    return '📎';
  }

  function renderFiles(msg) {
    if (!msg.files || !msg.files.length) return '';
    var out = '<div class="files">';
    msg.files.forEach(function (file) {
      if (file.mode === 'tombstone') {
        out += '<div class="file-card deleted">🗑️ File deleted</div>';
        return;
      }
      var isImage = (file.mimetype || '').indexOf('image/') === 0;
      var thumb = file.thumb_360 || file.thumb_480 || file.thumb_720 || file.thumb_160;
      var link = file.permalink || file.url_private || '#';
      if (isImage && thumb) {
        out += '<a class="file-image" href="' + escapeHtml(link) + '" target="_blank" rel="noopener">' +
          '<img src="' + escapeHtml(thumb) + '" alt="' + escapeHtml(file.name || 'image') +
          '" loading="lazy" onerror="this.parentNode.classList.add(\'broken\');this.parentNode.appendChild(document.createTextNode(\'\\uD83D\\uDDBC\\uFE0F Image (sign in to Slack in this browser to view)\'))">' +
          '</a>';
      } else {
        out += '<a class="file-card" href="' + escapeHtml(link) + '" target="_blank" rel="noopener">' +
          '<span class="file-icon">' + fileIcon(file) + '</span>' +
          '<span class="file-meta"><span class="file-name">' + escapeHtml(file.name || file.title || 'file') + '</span>' +
          '<span class="file-sub">' + escapeHtml((file.filetype || file.pretty_type || '').toUpperCase()) +
          (file.size ? ' · ' + fmtBytes(file.size) : '') + '</span></span>' +
          '</a>';
      }
    });
    out += '</div>';
    return out;
  }

  function renderCall(msg) {
    var call = msg.call && msg.call.v1;
    if (!call) return '';
    var status = call.active ? 'Active call' : (call.date_end ? 'Call ended' : 'Call');
    var duration = '';
    if (call.date_start && call.date_end) {
      duration = Math.round((call.date_end - call.date_start) / 60) + ' min';
    }
    return '<div class="call-card"><span class="call-icon">📞</span><div><div class="call-title">' +
      escapeHtml(call.name || 'Slack call') + '</div><div class="call-sub">' + escapeHtml(status) +
      (duration ? ' · ' + duration : '') + '</div></div></div>';
  }

  // Huddles arrive as a standalone message (subtype 'huddle_thread') sent by
  // USLACKBOT with the huddle's info in `room`, not attributed to a real
  // sender — rendered as its own centered card instead of a message row.
  function renderHuddle(msg) {
    var room = msg.room || {};
    var minutes = (room.date_start && room.date_end)
      ? Math.round((room.date_end - room.date_start) / 60)
      : null;
    var status = room.was_missed ? 'Missed huddle' : (room.date_end ? 'Huddle' : 'Huddle in progress');
    var durationStr = minutes === null ? '' : (minutes < 1 ? '<1 min' : minutes + ' min');
    return '<div class="huddle-card"><span class="call-icon">🎧</span><div><div class="call-title">' +
      escapeHtml(status) + '</div><div class="call-sub">' + fmtTime(msg.ts) +
      (durationStr ? ' · ' + durationStr : '') + '</div></div></div>';
  }

  function renderReactions(msg) {
    if (!msg.reactions || !msg.reactions.length) return '';
    var out = '<div class="reactions">';
    msg.reactions.forEach(function (r) {
      var emoji = EMOJI_MAP[r.name] || (':' + r.name + ':');
      out += '<span class="reaction" title="' + escapeHtml(r.count + ' reaction' + (r.count === 1 ? '' : 's') + ' · :' + r.name + ':') +
        '">' + emoji + ' <span class="reaction-count">' + r.count + '</span></span>';
    });
    out += '</div>';
    return out;
  }

  function renderThreadReply(msg) {
    return '<div class="thread-reply">' + avatarHtml(msg) +
      '<div class="message-content"><div class="message-head"><span class="sender">' + escapeHtml(senderName(msg)) +
      '</span><span class="timestamp">' + fmtTime(msg.ts) + '</span></div>' +
      '<div class="message-line">' +
      (msg.text ? '<div class="message-text">' + parseMrkdwn(msg.text) + '</div>' : '') +
      renderFiles(msg) + renderReactions(msg) +
      '</div></div></div>';
  }

  function renderThreadFooter(msg) {
    if (!msg.reply_count) return '';
    var replyWord = msg.reply_count === 1 ? 'reply' : 'replies';
    var latest = msg.latest_reply ? ' · last reply ' + fmtTime(msg.latest_reply) : '';
    var label = msg.reply_count + ' ' + replyWord + latest;
    var replies = THREADS[msg.thread_ts || msg.ts];

    if (!replies || !replies.length) {
      return '<div class="thread-footer" title="Thread replies are not included in this export">🧵 ' + label + '</div>';
    }

    var id = 'thread-' + String(msg.ts).replace(/\./g, '_');
    var toggleJs = 'var r=document.getElementById(\'' + id + '\');' +
      'var open=r.style.display!==\'none\';' +
      'r.style.display=open?\'none\':\'block\';' +
      'this.querySelector(\'.thread-toggle\').textContent=open?\'▸\':\'▾\';';
    return '<div class="thread-footer clickable" onclick="' + toggleJs + '">' +
      '<span class="thread-toggle">▸</span>🧵 ' + label + '</div>' +
      '<div class="thread-replies" id="' + id + '" style="display:none;">' +
      replies.map(renderThreadReply).join('') + '</div>';
  }

  function render() {
    var dataEl = document.getElementById('slack-export-data');
    var data = JSON.parse(dataEl.textContent);
    var messages = (data.messages || []).slice().sort(function (a, b) { return parseFloat(a.ts) - parseFloat(b.ts); });
    USERS = data.users || {};
    THREADS = data.threads || {};

    var titleText = data.name ? data.name : ('#' + (data.channel || ''));
    var headerHtml = '<div class="export-header"><div class="export-title">' + escapeHtml(titleText) +
      '</div><div class="export-meta">' + messages.length + ' messages' +
      (data.exportedSince ? ' · since account creation ' + escapeHtml(data.exportedSince) : '') +
      (data.exportedUntil ? ' · exported back to ' + escapeHtml(data.exportedUntil) : '') +
      (data.cachedFrom ? ' · cached ' + escapeHtml(data.cachedFrom) + ' – ' + escapeHtml(data.cachedThrough) : '') +
      '</div><div class="export-note">Click a thread\'s reply count to expand its replies, where fetched — older exports may only show a count.</div></div>';

    var html = [headerHtml, '<div class="message-list">'];
    var lastDateStr = null;
    var lastUser = null;
    var lastTs = null;
    var openRow = false;

    messages.forEach(function (msg) {
      var ts = parseFloat(msg.ts);
      var dateStr = new Date(ts * 1000).toDateString();

      if (dateStr !== lastDateStr) {
        if (openRow) { html.push('</div></div>'); openRow = false; }
        html.push('<div class="date-divider"><span>' + fmtDateHeader(msg.ts) + '</span></div>');
        lastDateStr = dateStr;
        lastUser = null;
      }

      if (msg.subtype && SYSTEM_SUBTYPES.indexOf(msg.subtype) !== -1) {
        if (openRow) { html.push('</div></div>'); openRow = false; }
        html.push('<div class="system-message">' + (msg.text ? parseMrkdwn(msg.text) : escapeHtml(msg.subtype)) + '</div>');
        lastUser = null;
        return;
      }

      if (msg.subtype === 'huddle_thread') {
        if (openRow) { html.push('</div></div>'); openRow = false; }
        html.push('<div class="huddle-block">' + renderHuddle(msg) + renderThreadFooter(msg) + '</div>');
        lastUser = null;
        return;
      }

      var groupKey = msg.user || msg.bot_id || msg.username || null;
      var sameGroup = openRow && lastUser && groupKey && lastUser === groupKey && lastTs !== null && (ts - lastTs) < 300;

      if (!sameGroup) {
        if (openRow) html.push('</div></div>');
        html.push(
          '<div class="message-row">' + avatarHtml(msg) +
          '<div class="message-content"><div class="message-head"><span class="sender">' + escapeHtml(senderName(msg)) +
          '</span><span class="timestamp">' + fmtTime(msg.ts) + '</span>' +
          (msg.edited ? '<span class="edited-tag">(edited)</span>' : '') + '</div>'
        );
        openRow = true;
      }

      var body = '';
      if (msg.text) body += '<div class="message-text">' + parseMrkdwn(msg.text) + '</div>';
      body += renderFiles(msg);
      body += renderCall(msg);
      body += renderReactions(msg);
      body += renderThreadFooter(msg);

      html.push('<div class="message-line">' + (sameGroup ? '<span class="grouped-ts">' + fmtTime(msg.ts) + '</span>' : '') + body + '</div>');

      lastUser = groupKey;
      lastTs = ts;
    });

    if (openRow) html.push('</div></div>');
    html.push('</div>');

    document.getElementById('app').innerHTML = html.join('');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render);
  } else {
    render();
  }
}
