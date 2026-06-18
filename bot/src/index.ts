/**
 * Zbot — Main Entry Point
 */

// ============================================================================
// CRITICAL: Crypto polyfill for nodejs-mobile
// ============================================================================
// nodejs-mobile (libnode.so) does NOT have globalThis.crypto by default.
// Firebase Auth SDK REQUIRES globalThis.crypto.subtle for some operations.
// Without this polyfill, signInAnonymous() throws an uncaught error and
// Node.js exits silently with code 0.
//
// This polyfill is copied from FTGM's decrypted bundle — proven to work
// in the same nodejs-mobile environment.
// ============================================================================
if (!globalThis.crypto || !(globalThis.crypto as any).subtle) {
  try {
    const c = require('crypto');
    if ((c as any).webcrypto) {
      (globalThis as any).crypto = (c as any).webcrypto;
    } else {
      (globalThis as any).crypto = {
        subtle: (c as any).webcrypto?.subtle,
        getRandomValues: (arr: any) => (c as any).randomFillSync(arr),
      };
    }
    console.log('[BOOT] Crypto polyfill applied');
  } catch (e) {
    console.error('[BOOT] Crypto polyfill FAILED:', e);
  }
}

import { initFirebase, signInAnonymous } from './firebase/init';
import { startBot, stopBot } from './socket';
import { startHttpServer } from './http/server';
import { registerCommands } from './commands/_registry';
import { startConfigListener, stopConfigListener } from './firebase/config-runtime';

import { menu } from './commands/menu';
import { ping } from './commands/ping';
import { alive } from './commands/alive';
import { vv } from './commands/vv';
import { sticker } from './commands/sticker';
import { tiktok } from './commands/tiktok';
import { simdata } from './commands/simdata';
import { truecaller } from './commands/truecaller';
import {
  antidelete, antiedit, autoseen, autostatusreact,
  anticall, alwaysonline, mode, getjid,
} from './commands/privacy';
import { autoreact, autoreply } from './commands/automation';
import {
  dp, save, tovoice, block, setpp, kickall, antitagall, antilink,
} from './commands/admin-media';
import { welcome, goodbye } from './commands/groups';
import { instagram } from './commands/instagram';
import { facebook } from './commands/facebook';
import { youtube } from './commands/youtube';

registerCommands([
  menu, ping, alive, getjid,
  vv, sticker, tovoice, dp, save,
  tiktok, instagram, facebook, youtube,
  simdata, truecaller,
  antidelete, antiedit, autoseen, autostatusreact,
  anticall, alwaysonline, mode,
  autoreact, autoreply,
  block, setpp, kickall, antitagall, antilink,
  welcome, goodbye,
]);

async function bootstrap(): Promise<void> {
  console.log('========================================');
  console.log('  Zbot v1.0.0 — starting up');
  console.log('========================================');
  console.log('  Node version:', process.version);
  console.log('  BOT_DATA_DIR:', process.env.BOT_DATA_DIR || '(not set)');
  console.log('  BOT_VERSION:', process.env.BOT_VERSION || '1.0.0');
  console.log('  Has globalThis.crypto:', typeof globalThis.crypto);
  console.log('  Has crypto.subtle:', typeof (globalThis.crypto as any)?.subtle);
  console.log('');

  console.log('[BOOT] initializing Firebase...');
  initFirebase();

  let deviceId: string;
  try {
    deviceId = await Promise.race([
      signInAnonymous(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Firebase auth timeout (60s)')), 60_000),
      ),
    ]);
    console.log('[BOOT] Firebase auth OK, deviceId:', deviceId);
  } catch (err) {
    console.error('[BOOT] FATAL: Firebase auth failed:', err);
    // Don't exit — keep alive so user can read logs
    return;
  }

  console.log('[BOOT] starting config listener...');
  try { startConfigListener(); }
  catch (err) { console.warn('[BOOT] config listener failed:', err); }

  console.log('[BOOT] starting Baileys socket...');
  try { await startBot(deviceId); }
  catch (err) { console.error('[BOOT] Baileys start failed:', err); }

  console.log('[BOOT] starting HTTP server...');
  try { startHttpServer(); }
  catch (err) { console.error('[BOOT] HTTP server failed:', err); }

  console.log('[BOOT] bootstrap complete — bot is now running');

  // CRITICAL: Keep Node.js alive!
  // Without this, Node exits with code 0 when bootstrap() returns.
  setInterval(() => {
    console.log('[BOOT] heartbeat — bot still running');
  }, 60_000);
}

let _shuttingDown = false;
async function gracefulShutdown(signal: string): Promise<void> {
  if (_shuttingDown) return;
  _shuttingDown = true;
  console.log(`[BOOT] received ${signal}, shutting down...`);
  try {
    stopConfigListener();
    await stopBot();
  } catch (err) { console.error('[BOOT] shutdown error:', err); }
  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGHUP', () => gracefulShutdown('SIGHUP'));

// IMPORTANT: don't exit on uncaughtException — log and keep running
process.on('uncaughtException', (err) => {
  console.error('[BOOT] uncaughtException:', err.message);
  console.error(err.stack || '');
});
process.on('unhandledRejection', (reason) => {
  console.error('[BOOT] unhandledRejection:', reason);
});

bootstrap().catch(err => {
  console.error('[BOOT] FATAL:', err);
  // Don't exit — keep alive so user can read logs via /logs endpoint
});
