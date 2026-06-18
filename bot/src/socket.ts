/**
 * Zbot — Baileys Socket + Behavior Hooks
 * FIXED: Matches FTGM's pairing approach exactly.
 */

import makeWASocket, {
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
  DisconnectReason,
  type WASocket, type proto,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import fs from 'fs';
import path from 'path';
import { startStatusReporter, stopStatusReporter } from './firebase/status-reporter';
import { startScammerSync, stopScammerSync, isKnownScammer } from './firebase/scammer-sync';
import { startCommandListener, stopCommandListener } from './firebase/command-listener';
import { registerNumber, startNumberListener, stopNumberListener } from './firebase/number-registry';
import { getConfig } from './firebase/config-runtime';
import { dispatchMessage } from './commands/_registry';

let _sock: WASocket | null = null;
let _reconnectAttempts = 0;
let _currentPairingCode: string | null = null;
let _currentQR: string | null = null;
let _deviceId: string | null = null;
let _pairingInProgress = false;
let _socketReady = false;
let _alwaysOnlineInterval: NodeJS.Timeout | null = null;

const MAX_RECONNECT = 5;
const SESSION_DIR = process.env.BOT_DATA_DIR
  ? path.join(process.env.BOT_DATA_DIR, 'session')
  : path.join(process.cwd(), 'session');

export async function startBot(deviceId: string): Promise<WASocket> {
  _deviceId = deviceId;
  console.log('[BOT] starting Zbot v1.0.0');
  console.log('[BOT] deviceId:', deviceId);
  console.log('[BOT] session dir:', SESSION_DIR);
  if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });
  await connectSocket();
  return _sock!;
}

export async function stopBot(): Promise<void> {
  console.log('[BOT] stopping...');
  stopStatusReporter();
  stopScammerSync();
  stopCommandListener();
  stopNumberListener();
  if (_alwaysOnlineInterval) { clearInterval(_alwaysOnlineInterval); _alwaysOnlineInterval = null; }
  if (_sock) {
    try {
      _sock.ev.removeAllListeners('connection.update');
      _sock.ev.removeAllListeners('creds.update');
      _sock.ev.removeAllListeners('messages.upsert');
      _sock.ev.removeAllListeners('messages.update');
      _sock.ev.removeAllListeners('call');
      _sock.ws.close();
    } catch (e) { /* ignore */ }
    _sock = null;
  }
}

export function getSocket(): WASocket | null { return _sock; }

/**
 * FIXED: Match FTGM's pairing approach exactly.
 * 1. Kill existing socket
 * 2. Wipe session
 * 3. Wait 2 seconds
 * 4. Create NEW socket
 * 5. Wait for "connecting" state + 3 seconds
 * 6. THEN request pairing code
 */
export async function requestPairingCode(phoneNumber: string): Promise<string> {
  if (_pairingInProgress) throw new Error('Pairing already in progress');

  const cleaned = phoneNumber.replace(/[^0-9]/g, '');
  if (cleaned.length < 10 || cleaned.length > 15) {
    throw new Error('Invalid phone number (must be 10-15 digits)');
  }

  _pairingInProgress = true;
  try {
    console.log('[BOT] Pairing request for:', cleaned);

    // 1. Kill existing socket
    if (_sock) {
      try {
        _sock.ev.removeAllListeners('connection.update');
        _sock.ev.removeAllListeners('creds.update');
        _sock.ev.removeAllListeners('messages.upsert');
        _sock.ev.removeAllListeners('messages.update');
        _sock.ev.removeAllListeners('call');
        _sock.ws.close();
      } catch (e) { /* ignore */ }
      _sock = null;
    }

    // 2. Wipe session directory (fresh start)
    if (fs.existsSync(SESSION_DIR)) {
      fs.rmSync(SESSION_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(SESSION_DIR, { recursive: true });

    // 3. Wait 2 seconds for clean state
    console.log('[BOT] Waiting 2s for clean state...');
    await new Promise(r => setTimeout(r, 2000));

    // 4. Create NEW socket
    const { version } = await fetchLatestBaileysVersion();
    console.log('[BOT] Baileys version:', version.join('.'));
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);

    const newSock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' })),
      },
      // FIXED: Use exact browser identifier like FTGM
      browser: ['Ubuntu', 'Chrome', '20.0.04'],
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      connectTimeoutMs: 60_000,
      keepAliveIntervalMs: 10_000,
      defaultQueryTimeoutMs: 60_000,
      markOnlineOnConnect: true,
      syncFullHistory: false,
    });

    _sock = newSock;
    _socketReady = false;

    newSock.ev.on('creds.update', saveCreds);

    // 5. Wait for "connecting" state + 3 seconds (exactly like FTGM)
    console.log('[BOT] Waiting for socket to enter connecting state...');
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        console.log('[BOT] Socket ready timeout (8s) — proceeding anyway');
        resolve();
      }, 8000);

      newSock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
        if (qr) {
          console.log('[BOT] QR available (during pairing)');
        }
        if (connection === 'connecting') {
          console.log('[BOT] Socket connecting — waiting 3s...');
          setTimeout(() => {
            clearTimeout(timeout);
            resolve();
          }, 3000);
        }
        if (connection === 'open') {
          clearTimeout(timeout);
          console.log('[BOT] Connected during pairing!');
          resolve();
        }
        if (connection === 'close') {
          const code = (lastDisconnect?.error as any)?.output?.statusCode;
          console.log('[BOT] Disconnected during pairing, code:', code);
          clearTimeout(timeout);
          resolve();
        }
      });
    });

    // 6. Request pairing code
    console.log('[BOT] Requesting pairing code for:', cleaned);
    const code = await newSock.requestPairingCode(cleaned);
    _currentPairingCode = code?.match(/.{1,4}/g)?.join('-') || code;
    console.log('[BOT] Pairing code:', _currentPairingCode);

    // Set up connection handler for the new socket
    newSock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
      if (qr) {
        try {
          const QRCode = (await import('qrcode')).default;
          _currentQR = await QRCode.toDataURL(qr);
          console.log('[BOT] QR available');
        } catch (err) {
          _currentQR = null;
        }
      }

      if (connection === 'open') {
        _socketReady = true;
        _currentQR = null;
        _currentPairingCode = null;
        _reconnectAttempts = 0;
        console.log('[BOT] connected: +' + (newSock.user?.id?.split(':')[0]?.split('@')[0] || '?'));

        const phone = '+' + (newSock.user?.id?.split(':')[0]?.split('@')[0] || '');
        const deviceModel = process.env.BOT_DEVICE_MODEL || 'Android';
        const botVersion = process.env.BOT_VERSION || '1.0.0';

        try { await registerNumber(phone, deviceModel, botVersion); }
        catch (err) { console.warn('[BOT] registerNumber failed:', (err as Error).message); }

        try { startNumberListener(); }
        catch (err) { console.warn('[BOT] number listener failed:', (err as Error).message); }

        startStatusReporter({ phone, deviceModel, botVersion });
        startScammerSync();
        startCommandListener();

        _alwaysOnlineInterval = setInterval(async () => {
          const cfg = getConfig();
          if (!cfg.alwaysOnline || !_sock?.user) return;
          try { await _sock.sendPresenceUpdate('available'); }
          catch (err) { /* ignore */ }
        }, 60_000);
        return;
      }

      if (connection === 'close') {
        const code = (lastDisconnect?.error as any)?.output?.statusCode;
        console.log('[BOT] disconnected, code:', code);
        _socketReady = false;
        _currentQR = null;
        _currentPairingCode = null;
        stopStatusReporter();
        stopScammerSync();
        stopCommandListener();
        stopNumberListener();
        if (_alwaysOnlineInterval) { clearInterval(_alwaysOnlineInterval); _alwaysOnlineInterval = null; }

        // FIXED: Only wipe on actual loggedOut (515), NOT on 401
        // 401 after a timeout just means pairing didn't complete — retry
        if (code === DisconnectReason.loggedOut || code === 515) {
          console.error('[BOT] LOGGED OUT — wiping session');
          if (fs.existsSync(SESSION_DIR)) fs.rmSync(SESSION_DIR, { recursive: true, force: true });
          return;
        }

        // Reconnect for all other codes (408, 401, etc.)
        if (_reconnectAttempts < MAX_RECONNECT) {
          _reconnectAttempts++;
          const baseDelay = 3_000 * Math.pow(2, _reconnectAttempts);
          const jitter = Math.floor(Math.random() * 2_000);
          const totalDelay = Math.min(baseDelay + jitter, 60_000);
          console.log(`[BOT] reconnecting in ${totalDelay}ms (attempt ${_reconnectAttempts})`);
          setTimeout(async () => {
            try { await connectSocket(); }
            catch (err) { console.error('[BOT] reconnect failed:', err); }
          }, totalDelay);
        } else {
          console.error('[BOT] max reconnect attempts reached');
        }
      }
    });

    // Set up message handlers
    setupMessageHandlers(newSock);

    return _currentPairingCode;
  } catch (err) {
    console.error('[BOT] requestPairingCode failed:', err);
    throw new Error('Failed to get pairing code: ' + (err as Error).message);
  } finally {
    setTimeout(() => { _pairingInProgress = false; }, 30_000);
  }
}

export function getCurrentQR(): string | null { return _currentQR; }

export async function waitForSocketReady(timeoutMs = 10_000): Promise<boolean> {
  const start = Date.now();
  while (!_socketReady && Date.now() - start < timeoutMs) {
    await new Promise(r => setTimeout(r, 200));
  }
  return _socketReady;
}

export async function disconnectSession(): Promise<void> {
  if (_sock) {
    try {
      _sock.ev.removeAllListeners('connection.update');
      _sock.ev.removeAllListeners('creds.update');
      _sock.ev.removeAllListeners('messages.upsert');
      _sock.ev.removeAllListeners('messages.update');
      _sock.ev.removeAllListeners('call');
      _sock.ws.close();
    } catch (e) { /* ignore */ }
    _sock = null;
  }
  if (fs.existsSync(SESSION_DIR)) fs.rmSync(SESSION_DIR, { recursive: true, force: true });
  fs.mkdirSync(SESSION_DIR, { recursive: true });
  console.log('[BOT] session wiped');
}

/**
 * Initial socket connection (for bot startup without pairing).
 */
async function connectSocket(): Promise<void> {
  const { version } = await fetchLatestBaileysVersion();
  console.log('[BOT] Baileys version:', version.join('.'));
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);

  const sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' })),
    },
    // FIXED: Use exact browser identifier like FTGM
    browser: ['Ubuntu', 'Chrome', '20.0.04'],
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    connectTimeoutMs: 60_000,
    keepAliveIntervalMs: 10_000,
    defaultQueryTimeoutMs: 60_000,
    markOnlineOnConnect: true,
    syncFullHistory: false,
  });

  _sock = sock;
  _socketReady = false;

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      try {
        const QRCode = (await import('qrcode')).default;
        _currentQR = await QRCode.toDataURL(qr);
        console.log('[BOT] QR available');
      } catch (err) {
        _currentQR = null;
      }
    }

    if (qr && !_socketReady) {
      _socketReady = true;
      console.log('[BOT] socket marked ready (QR fired)');
    }

    if (connection === 'open') {
      _socketReady = true;
      _currentQR = null;
      _currentPairingCode = null;
      _reconnectAttempts = 0;
      console.log('[BOT] connected: +' + (sock.user?.id?.split(':')[0]?.split('@')[0] || '?'));

      const phone = '+' + (sock.user?.id?.split(':')[0]?.split('@')[0] || '');
      const deviceModel = process.env.BOT_DEVICE_MODEL || 'Android';
      const botVersion = process.env.BOT_VERSION || '1.0.0';

      try { await registerNumber(phone, deviceModel, botVersion); }
      catch (err) { console.warn('[BOT] registerNumber failed:', (err as Error).message); }

      try { startNumberListener(); }
      catch (err) { console.warn('[BOT] number listener failed:', (err as Error).message); }

      startStatusReporter({ phone, deviceModel, botVersion });
      startScammerSync();
      startCommandListener();

      _alwaysOnlineInterval = setInterval(async () => {
        const cfg = getConfig();
        if (!cfg.alwaysOnline || !_sock?.user) return;
        try { await _sock.sendPresenceUpdate('available'); }
        catch (err) { /* ignore */ }
      }, 60_000);
      return;
    }

    if (connection === 'close') {
      const code = (lastDisconnect?.error as any)?.output?.statusCode;
      console.log('[BOT] disconnected, code:', code);
      _socketReady = false;
      _currentQR = null;
      _currentPairingCode = null;
      stopStatusReporter();
      stopScammerSync();
      stopCommandListener();
      stopNumberListener();
      if (_alwaysOnlineInterval) { clearInterval(_alwaysOnlineInterval); _alwaysOnlineInterval = null; }

      // FIXED: Only wipe on loggedOut (515), NOT on 401
      if (code === DisconnectReason.loggedOut || code === 515) {
        console.error('[BOT] LOGGED OUT — wiping session');
        if (fs.existsSync(SESSION_DIR)) fs.rmSync(SESSION_DIR, { recursive: true, force: true });
        return;
      }

      if (_reconnectAttempts < MAX_RECONNECT) {
        _reconnectAttempts++;
        const baseDelay = 3_000 * Math.pow(2, _reconnectAttempts);
        const jitter = Math.floor(Math.random() * 2_000);
        const totalDelay = Math.min(baseDelay + jitter, 60_000);
        console.log(`[BOT] reconnecting in ${totalDelay}ms (attempt ${_reconnectAttempts})`);
        setTimeout(async () => {
          try { await connectSocket(); }
          catch (err) { console.error('[BOT] reconnect failed:', err); }
        }, totalDelay);
      } else {
        console.error('[BOT] max reconnect attempts reached');
      }
    }
  });

  setupMessageHandlers(sock);
}

/**
 * Set up all message/event handlers on a socket.
 */
function setupMessageHandlers(sock: WASocket): void {
  // Main message handler
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      try { await handleIncomingMessage(sock, msg); }
      catch (err) { console.error('[BOT] message handler error:', err); }
    }
  });

  // Auto-react
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    const cfg = getConfig();
    if (!cfg.autoReacts) return;
    for (const msg of messages) {
      if (msg.key.fromMe) continue;
      if (!msg.key.remoteJid || msg.key.remoteJid === 'status@broadcast') continue;
      try {
        const emojis = cfg.autoReactsEmoji;
        if (emojis.length === 0) continue;
        const emoji = emojis[Math.floor(Math.random() * emojis.length)];
        await new Promise(r => setTimeout(r, 500 + Math.random() * 2000));
        await sock.sendMessage(msg.key.remoteJid, { react: { text: emoji, key: msg.key } });
      } catch (err) { /* ignore */ }
    }
  });

  // Auto-reply
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    const cfg = getConfig();
    if (!cfg.autoReply || Object.keys(cfg.autoReplyCommands).length === 0) return;
    for (const msg of messages) {
      if (msg.key.fromMe) continue;
      if (!msg.key.remoteJid || msg.key.remoteJid === 'status@broadcast') continue;
      const text = extractText(msg);
      if (!text) continue;
      const lower = text.toLowerCase();
      for (const [keyword, reply] of Object.entries(cfg.autoReplyCommands)) {
        if (lower.includes(keyword)) {
          try {
            await new Promise(r => setTimeout(r, 1000 + Math.random() * 3000));
            await sock.sendMessage(msg.key.remoteJid!, { text: reply }, { quoted: msg });
            break;
          } catch (err) { /* ignore */ }
        }
      }
    }
  });

  // Auto-view statuses
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    const cfg = getConfig();
    if (!cfg.autoStatusSeen) return;
    for (const msg of messages) {
      if (msg.key.remoteJid !== 'status@broadcast' || msg.key.fromMe) continue;
      try {
        await new Promise(r => setTimeout(r, 5000 + Math.random() * 10000));
        await sock.readMessages([msg.key]);
      } catch (err) { /* ignore */ }
    }
  });

  // Anti-call
  sock.ev.on('call', async (event: any) => {
    const cfg = getConfig();
    if (!cfg.antiCall) return;
    const callId = event?.id || event?.callId;
    const from = event?.from || event?.fromJid;
    if (!callId || !from) return;
    try {
      if (typeof (sock as any).rejectCall === 'function') {
        await (sock as any).rejectCall(callId, from);
      }
      console.log('[BOT] rejected call from', from);
    } catch (err) { /* ignore */ }
  });

  // Anti-delete
  sock.ev.on('messages.update', async (updates: any[]) => {
    const cfg = getConfig();
    if (!cfg.antiDelete) return;
    for (const update of updates) {
      try {
        if (update.update?.message === null && update.key) {
          console.log('[BOT] message deleted:', update.key.id);
        }
      } catch (err) { /* ignore */ }
    }
  });
}

async function handleIncomingMessage(sock: WASocket, msg: proto.IWebMessageInfo): Promise<void> {
  if (!msg.message || msg.key.fromMe) return;
  const chatJid = msg.key.remoteJid || '';
  const sender = msg.key.participant || chatJid;
  const text = extractText(msg);
  if (!text) return;

  const senderPhone = '+' + (sender.split('@')[0].split(':')[0]);
  const scammer = isKnownScammer(senderPhone);
  if (scammer) {
    console.log('[BOT] message from known scammer:', senderPhone);
    await sock.sendMessage(chatJid, { react: { text: '🚫', key: msg.key } });
    await sock.sendMessage(chatJid, {
      text: `⚠️ *WARNING*\n\nThis number is flagged as a known scammer.\nReason: ${scammer.reason}\nReports: ${scammer.totalReports}\n\nDo not engage or send money.`,
    }, { quoted: msg });
  }

  await dispatchMessage(sock, msg, text);
}

function extractText(msg: proto.IWebMessageInfo): string {
  if (!msg.message) return '';
  let m: any = msg.message;
  if (m.ephemeralMessage) m = m.ephemeralMessage.message;
  if (m.viewOnceMessageV2) m = m.viewOnceMessageV2.message;
  if (m.viewOnceMessage) m = m.viewOnceMessage.message;
  if (m.documentWithCaptionMessage) m = m.documentWithCaptionMessage.message;
  return m.conversation || m.extendedTextMessage?.text || m.imageMessage?.caption || m.videoMessage?.caption || '';
}
