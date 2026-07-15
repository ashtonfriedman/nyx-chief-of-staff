function wakeBridge() {
  try {
    chrome.runtime.sendMessage({ type: "wakeBridge" }).catch(() => {});
  } catch (_error) {
    // The background service worker may be restarting; the next tick will retry.
  }
}

wakeBridge();
setInterval(wakeBridge, 5000);
