import { invoke } from '@tauri-apps/api/core';

/** Only the mounted DSH frame can request the fixed, user-mediated chooser. */
export function installDirectoryPickerBridge(getFrame: () => HTMLIFrameElement | null) {
  let busy = false;
  let disposed = false;
  const receive = async (event: MessageEvent) => {
    const frame = getFrame();
    const data = event.data;
    if (event.origin !== 'http://127.0.0.1:3080' || !frame?.contentWindow ||
        event.source !== frame.contentWindow || data?.type !== 'dsh-directory-pick' ||
        typeof data.id !== 'string' || !/^[0-9a-f-]{36}$/.test(data.id)) return;
    const source = frame.contentWindow;
    const reply = (result: object) => {
      if (!disposed && getFrame() === frame) source.postMessage(
        { type: 'dsh-directory-result', id: data.id, ...result }, event.origin);
    };
    if (busy) { reply({ error: 'A directory chooser is already open' }); return; }
    busy = true;
    try {
      const path = await invoke<string | null>('pick_workspace_directory');
      reply({ path });
    } catch {
      reply({ error: 'Unable to open the directory chooser' });
    } finally { busy = false; }
  };
  window.addEventListener('message', receive);
  return () => { disposed = true; window.removeEventListener('message', receive); };
}
