// Relays toolbar icon clicks to the content script on the active tab
// (which toggles the export panel), and opens the cache manager page when
// asked to. Runs as a real service worker in Chrome and as a
// non-persistent event page in Firefox (see manifest.json).

const ext = globalThis.browser ?? globalThis.chrome;
const TOGGLE_MESSAGE = 'slack-export:toggle-panel';
const OPEN_MANAGER_MESSAGE = 'slack-export:open-manager';

// Registered synchronously at top level so Chrome reattaches it reliably
// after the service worker goes idle and respawns.
ext.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  try {
    await ext.tabs.sendMessage(tab.id, { type: TOGGLE_MESSAGE });
  } catch (err) {
    console.error('slack-export: could not reach content script — reload the Slack tab and try again.', err);
  }
});

ext.runtime.onMessage.addListener((message) => {
  if (message?.type === OPEN_MANAGER_MESSAGE) {
    ext.tabs.create({ url: ext.runtime.getURL('manager.html') });
  }
});
