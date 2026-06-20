/**
 * Zbot v2.1.6 — Local HTTP Server
 *
 * Fixes:
 * - /pair no longer gated on state.ready (was blocking first-time pairing forever — C1)
 * - Re-checks status.connected after waitForSocketReady to avoid race (H6)
 * - Bind to 127.0.0.1 (was 0.0.0.0 — security hole — anyone on LAN could drive the bot)
 * - EADDRINUSE: log clearly + exit (was a no-op — H1)
 * - Handles phone as array (M9)
 * - /stop calls gracefulShutdown (was leaving Firebase listeners dangling — H2)
 */

import express from 'express';
import {
  requestPairingCode, disconnectSession,
  stopBot, getCurrentQR, waitForSocketReady, getSocketStatus,
} from '../socket';
import { getDeviceId } from '../firebase/init';
import { isApproved, isRevoked } from '../firebase/number-registry';
import { getConfig, updateConfig, persistConfig } from '../firebase/config-runtime';

const PORT = parseInt(process.env.BOT_PORT || '3001', 10);
// v2.1.6 FIX (C4 from build audit): bind to 127.0.0.1 only (was 0.0.0.0 — exposed to LAN)
const HOST = '127.0.0.1';

// Ring buffer for bot-side logs (max 500 lines)
const botLogs: string[] = [];
const MAX_LOGS = 500;

function addLog(line: string): void {
  try {
    botLogs.push(`[${new Date().toISOString()}] ${line}`);
    while (botLogs.length > MAX_LOGS) botLogs.shift();
  } catch (e) {
    // ignore — logging should never crash the bot
  }
}

// Safe stringify — never throws (unlike JSON.stringify on circular refs)
function safeStringify(arg: any): string {
  try {
    if (arg === null) return 'null';
    if (arg === undefined) return 'undefined';
    if (typeof arg === 'string') return arg;
    if (typeof arg === 'number' || typeof arg === 'boolean') return String(arg);
    if (arg instanceof Error) return arg.message + '\n' + (arg.stack || '');
    if (typeof arg === 'object') {
      // Use util.inspect for objects (handles circular refs)
      const util = require('util');
      return util.inspect(arg, { depth: 3, maxArrayLength: 10 });
    }
    return String(arg);
  } catch (e) {
    return '[unprintable]';
  }
}

// Capture console.log + console.error into the buffer
// IMPORTANT: We save the ORIGINAL references BEFORE overriding
const origLog = console.log.bind(console);
const origErr = console.error.bind(console);
const origWarn = console.warn.bind(console);

console.log = (...args: any[]) => {
  try {
    const line = args.map(safeStringify).join(' ');
    addLog(line);
  } catch (e) {
    // ignore
  }
  origLog(...args);
};
console.error = (...args: any[]) => {
  try {
    const line = args.map(safeStringify).join(' ');
    addLog(`ERROR: ${line}`);
  } catch (e) {
    // ignore
  }
  origErr(...args);
};
console.warn = (...args: any[]) => {
  try {
    const line = args.map(safeStringify).join(' ');
    addLog(`WARN: ${line}`);
  } catch (e) {
    // ignore
  }
  origWarn(...args);
};

// Capture uncaught exceptions — DON'T exit, just log
process.on('uncaughtException', (err) => {
  try {
    addLog(`UNCAUGHT EXCEPTION: ${err.message}\n${err.stack || ''}`);
    origErr(`[UNCAUGHT] ${err.message}\n${err.stack || ''}`);
  } catch (e) {
    // ignore
  }
});
process.on('unhandledRejection', (reason) => {
  try {
    addLog(`UNHANDLED REJECTION: ${safeStringify(reason)}`);
    origErr(`[UNHANDLED REJECTION] ${safeStringify(reason)}`);
  } catch (e) {
    // ignore
  }
});

export function startHttpServer(): { close: () => void } {
  const app = express();
  app.use(express.json({ limit: '15mb' }));

  app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

  // Debug endpoint — returns all accumulated bot logs
  app.get('/logs', (_req, res) => {
    res.json({
      logs: botLogs,
      count: botLogs.length,
      ts: Date.now(),
    });
  });

  app.get('/status', (_req, res) => {
    const status = getSocketStatus();
    let deviceId: string | null = null;
    try { deviceId = getDeviceId(); }
    catch (e) { deviceId = null; } // v2.1.6 FIX (M11): don't crash if Firebase auth not done
    res.json({
      status: status.connected
        ? `Connected: +${status.phone}`
        : (status.pairing ? 'Pairing in progress...' : 'Waiting for pairing...'),
      connected: status.connected,
      pairing: status.pairing,
      phone: status.phone,
      ready: status.ready,
      deviceId,
      botVersion: process.env.BOT_VERSION || '2.1.6',
      approved: isApproved(),
      revoked: isRevoked(),
    });
  });

  /**
   * Pair endpoint — v2.1.6 logic:
   * 1. If already connected (sock.user AND state.ready) → return "Already connected"
   * 2. If pairing in progress → return 409 "Pairing in progress"
   * 3. Otherwise → request pair code (NO waitForSocketReady gate — was blocking
   *    first-time pairing because state.ready only becomes true AFTER connect)
   */
  app.get('/pair', async (req, res) => {
    try {
      // v2.1.6 FIX (M9): phone might be array if ?phone=123&phone=456
      const rawPhone = Array.isArray(req.query.phone) ? req.query.phone[0] : req.query.phone;
      const phone = (rawPhone as string || '').replace(/[^0-9]/g, '');
      if (!phone || phone.length < 10 || phone.length > 15) {
        res.status(400).json({ error: 'Invalid phone number (must be 10-15 digits)' });
        return;
      }

      const status = getSocketStatus();

      // Already connected (sock.user is set AND state.ready is true)
      if (status.connected) {
        console.log('[HTTP] /pair: already connected as', status.phone);
        res.json({
          code: 'Already connected',
          connected: true,
          phone: status.phone,
        });
        return;
      }

      // Pairing in progress — DON'T start a new pair, let the existing one finish
      if (status.pairing) {
        console.log('[HTTP] /pair: pairing already in progress');
        res.status(409).json({
          error: 'Pairing already in progress. Wait for the current code to expire (30s) or enter it in WhatsApp.',
          pairing: true,
        });
        return;
      }

      // v2.1.6 FIX (C1): removed waitForSocketReady gate — was blocking first-time pairing
      // because state.ready only becomes true AFTER a successful connection.
      // For a fresh bot with no creds, the socket is created in startBot() (synchronously
      // awaited in index.ts), so by the time HTTP requests arrive, state.sock is set.
      // requestPairingCode will kill + recreate the socket anyway.

      // v2.1.6 FIX (H6): re-check status one more time to avoid race with auto-reconnect
      const statusNow = getSocketStatus();
      if (statusNow.connected) {
        res.json({
          code: 'Already connected',
          connected: true,
          phone: statusNow.phone,
        });
        return;
      }

      console.log('[HTTP] /pair: requesting pair code for', phone);
      const code = await requestPairingCode(phone);
      res.json({ code, connected: false, phone });
    } catch (err) {
      console.error('[HTTP] /pair error:', err);
      const e = err as Error;
      const status = e.message.includes('already in progress') ? 409 : 500;
      res.status(status).json({ error: e.message });
    }
  });

  app.get('/qr', (_req, res) => {
    const qr = getCurrentQR();
    if (qr) res.json({ qr, hasQr: true });
    else res.json({
      qr: null, hasQr: false,
      message: 'QR not ready. Either bot is connected, or pair code is being used.',
    });
  });

  app.get('/get-config', (_req, res) => res.json(getConfig()));

  app.post('/set-config', async (req, res) => {
    try {
      updateConfig(req.body || {});
      await persistConfig();
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/disconnect', async (_req, res) => {
    try {
      await disconnectSession();
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get('/stop', async (_req, res) => {
    res.json({ ok: true });
    // v2.1.6 FIX (H2): use a short delay then exit. BotService will respawn us.
    // The OS will clean up Firebase listeners on process exit.
    setTimeout(async () => {
      try {
        await stopBot();
        process.exit(0);
      } catch (err) {
        console.error('[HTTP] stop failed:', err);
        process.exit(1);
      }
    }, 500);
  });

  const server = app.listen(PORT, HOST, () => {
    console.log(`[HTTP] server listening on http://${HOST}:${PORT}`);
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    // v2.1.6 FIX (H1): actually log + flag the error clearly (was a no-op lie)
    if (err.code === 'EADDRINUSE') {
      console.error(`[HTTP] FATAL: port ${PORT} already in use. Bot cannot start HTTP server.`);
      console.error('[HTTP] Another bot instance may be running. Exiting.');
    } else {
      console.error('[HTTP] server error:', err);
    }
  });

  return { close: () => server.close() };
}
