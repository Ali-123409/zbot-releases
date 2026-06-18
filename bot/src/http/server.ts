/**
 * Zbot — Local HTTP Server
 */

import express from 'express';
import {
  getSocket, requestPairingCode, disconnectSession,
  stopBot, getCurrentQR, waitForSocketReady,
} from '../socket';
import { getDeviceId } from '../firebase/init';
import { isApproved, isRevoked } from '../firebase/number-registry';
import { getConfig, updateConfig, persistConfig } from '../firebase/config-runtime';

const PORT = parseInt(process.env.BOT_PORT || '3001', 10);
// Use 0.0.0.0 like FTGM — nodejs-mobile on Android has network isolation
const HOST = '0.0.0.0';

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
    const sock = getSocket();
    const connected = !!sock?.user;
    const phone = sock?.user?.id?.split(':')[0]?.split('@')[0] || '';
    res.json({
      status: connected ? `Connected: +${phone}` : 'Waiting for pairing...',
      connected, phone,
      deviceId: getDeviceId(),
      botVersion: process.env.BOT_VERSION || '1.0.0',
      approved: isApproved(),
      revoked: isRevoked(),
    });
  });

  app.get('/pair', async (req, res) => {
    try {
      const phone = (req.query.phone as string || '').replace(/[^0-9]/g, '');
      if (!phone || phone.length < 10 || phone.length > 15) {
        res.status(400).json({ error: 'Invalid phone number (must be 10-15 digits)' });
        return;
      }
      const sock = getSocket();
      if (sock?.user) {
        res.json({
          code: 'Already connected', connected: true,
          phone: sock.user.id.split(':')[0],
        });
        return;
      }
      const ready = await waitForSocketReady(10_000);
      if (!ready) {
        res.status(503).json({
          error: 'Socket not ready — bot is still starting up. Try again in a few seconds.',
        });
        return;
      }
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
    try { await disconnectSession(); res.json({ ok: true }); }
    catch (err) { res.status(500).json({ error: (err as Error).message }); }
  });

  app.get('/stop', async (_req, res) => {
    res.json({ ok: true });
    setTimeout(async () => {
      try { await stopBot(); process.exit(0); }
      catch (err) { console.error('[HTTP] stop failed:', err); process.exit(1); }
    }, 500);
  });

  const server = app.listen(PORT, HOST, () => {
    console.log(`[HTTP] server listening on http://${HOST}:${PORT}`);
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`[HTTP] port ${PORT} in use, trying ${PORT + 1}`);
    } else {
      console.error('[HTTP] server error:', err);
    }
  });

  return { close: () => server.close() };
}
