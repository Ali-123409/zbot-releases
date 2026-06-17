/**
 * Zbot — Local HTTP Server (127.0.0.1:3001 ONLY)
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
const HOST = '127.0.0.1';

export function startHttpServer(): { close: () => void } {
  const app = express();
  app.use(express.json({ limit: '15mb' }));

  app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

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
