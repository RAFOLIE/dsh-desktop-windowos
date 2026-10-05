(() => {
  if (location.origin !== 'http://127.0.0.1:3080' || window.parent === window || window.__DSH_DIRECTORY_PICKER__) return;
  const shellOrigins = new Set(['http://tauri.localhost', 'https://tauri.localhost', 'tauri://localhost', 'http://localhost:1420', 'http://127.0.0.1:1420']);
  let pending = null;
  window.addEventListener('message', event => {
    const data = event.data;
    if (event.source !== window.parent || !shellOrigins.has(event.origin) || !pending ||
        data?.type !== 'dsh-directory-result' || data.id !== pending.id) return;
    const request = pending;
    pending = null;
    if (typeof data.error === 'string') request.reject(new Error(data.error));
    else if (data.path === null || typeof data.path === 'string') request.resolve(data.path);
    else request.reject(new Error('Invalid directory response'));
  });
  window.__DSH_DIRECTORY_PICKER__ = { pick() {
    if (pending) return Promise.reject(new Error('A directory chooser is already open'));
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      pending = { id, resolve, reject };
      // Contains no path, token or other private data. The parent validates the
      // exact origin and source window before invoking the single chooser API.
      window.parent.postMessage({ type: 'dsh-directory-pick', id }, '*');
    });
  } };
})();
