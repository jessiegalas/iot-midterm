// Thin Web Serial wrapper for the ESP32 link. Needs Chrome or Edge on a desktop and a secure context
// (https:// or http://localhost). Protocol parsing lives in device.js.

export const serialSupported = () => typeof navigator !== 'undefined' && 'serial' in navigator;

// Opens the serial-port picker, then the chosen port.
//   onLine(text)  called for every complete line the board prints
//   onClose(err)  called once when the link ends: err is null after close(), an Error if the board vanished
// Resolves to { send(command), close() }. Rejects if the picker is dismissed (name === 'NotFoundError').
export async function openDevice({ onLine, onClose, baudRate = 115200 }) {
  if (!serialSupported()) throw Object.assign(new Error('Web Serial is not available in this browser.'), { code: 'UNSUPPORTED' });
  const port = await navigator.serial.requestPort();
  await port.open({ baudRate });
  // Opening the port can pulse the ESP32 auto-reset lines (DTR/RTS). Release both so the board runs normally.
  try { await port.setSignals({ dataTerminalReady: false, requestToSend: false }); } catch { /* not every adapter supports it */ }

  const encoder = new TextEncoder();
  const writer = port.writable.getWriter();
  const reader = port.readable.getReader();
  let closing = false;
  let ended = false;

  // A board that is unplugged mid-game ends the read loop; stop reading so the port can be released.
  port.addEventListener('disconnect', () => { reader.cancel().catch(() => {}); });

  const pump = (async () => {
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return null;
        buffer += decoder.decode(value, { stream: true });
        for (let nl = buffer.indexOf('\n'); nl >= 0; nl = buffer.indexOf('\n')) {
          const line = buffer.slice(0, nl).replace(/\r$/, '');
          buffer = buffer.slice(nl + 1);
          try { onLine(line); } catch (err) { console.error('Device line handler failed', err); }
        }
        if (buffer.length > 4096) buffer = ''; // runaway output with no newline
      }
    } catch (err) {
      return err;
    } finally {
      reader.releaseLock();
    }
  })();

  const finished = (async () => {
    const err = await pump;
    try { writer.releaseLock(); } catch { /* a write was still pending */ }
    try { await port.close(); } catch { /* already gone */ }
    ended = true;
    onClose?.(closing ? null : err || new Error('The device stopped responding.'));
  })();

  return {
    // A leading newline flushes any partial line the board may have buffered (e.g. boot noise).
    async send(command) {
      if (ended || closing) throw new Error('The device link is closed.');
      await writer.write(encoder.encode(`\n${command}\n`));
    },
    async close() {
      closing = true;
      try { await reader.cancel(); } catch { /* already cancelled */ }
      await finished;
    },
  };
}
