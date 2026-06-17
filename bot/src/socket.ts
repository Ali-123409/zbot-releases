/**
 * Zbot — Baileys Socket + Behavior Hooks
 * 1 APK = 1 Baileys socket (mirrors FTGM's design).
 */

import makeWASocket, {
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
  Browsers,
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

export async function requestPairingCode(phoneNumber: string): Promise<string> {
  if (!_sock) throw new Error('Socket not initialized');
  if (_pairingInProgress) throw new Error('Pairing already in progress — wait for current request to finish');

  const cleaned = phoneNumber.replace(/[^0-9]/g, '');
  if (cleaned.length < 10 || cleaned.length > 15) {
    throw new Error('Invalid phone number (must be 10-15 digits)');
  }
  if (_sock.user) throw new Error('Already connected to ' + _sock.user.id);

  const startWait = Date.now();
  while (!_socketReady && Date.now() - startWait < 10_000) {
    await new Promise(r => setTimeout(r, 200));
  }
  if (!_socketReady) throw new Error('Socket not ready — try again in a few seconds');

  _pairingInProgress = true;
  try {
    console.log('[BOT] requesting pairing code for:', cleaned);
    const code = await _sock.requestPairingCode(cleaned);
    _currentPairingCode = code?.match(/.{1,4}/g)?.join('-') || code;
    console.log('[BOT] pairing code:', _currentPairingCode);
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

async function connectSocket(): Promise<void> {
  const { version } = await fetchLatestBaileysVersion();
  console.log('[BOT] Baileys version:', version.join('.'));
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);

  const sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
    },
    browser: Browsers.appropriate('Desktop'),
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
        console.warn('[BOT] QR generation failed:', (err as Error).message);
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
      console.log('[BOT] connected: +' + (sock.user?.id?.split(':')[0]?.split('@')[0] || '?'));
      _reconnectAttempts = 0;

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

      if (code === DisconnectReason.loggedOut || code === 401 || code === 440) {
        console.error('[BOT] BANNED OR LOGGED OUT — wiping session');
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

  // Message handler — dispatch to command registry + scammer watchlist
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      try { await handleIncomingMessage(msg); }
      catch (err) { console.error('[BOT] message handler error:', err); }
    }
  });

  // 1. Auto-react
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    const cfg = getConfig();
    if (!cfg.autoReacts) return;
    for (const msg of messages) {
      if (msg.key.fromMe) continue;
      if (!msg.key.remoteJid) continue;
      if (msg.key.remoteJid === 'status@broadcast') continue;
      try {
        const emojis = cfg.autoReactsEmoji;
        if (emojis.length === 0) continue;
        const emoji = emojis[Math.floor(Math.random() * emojis.length)];
        await new Promise(r => setTimeout(r, 500 + Math.random() * 2000));
        await sock.sendMessage(msg.key.remoteJid, {
          react: { text: emoji, key: msg.key },
        });
      } catch (err) { /* ignore */ }
    }
  });

  // 2. Auto-reply
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

  // 3. Auto-view statuses
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    const cfg = getConfig();
    if (!cfg.autoStatusSeen) return;
    for (const msg of messages) {
      if (msg.key.remoteJid !== 'status@broadcast') continue;
      if (msg.key.fromMe) continue;
      try {
        await new Promise(r => setTimeout(r, 5000 + Math.random() * 10000));
        await sock.readMessages([msg.key]);
      } catch (err) { /* ignore */ }
    }
  });

  // 4. Anti-view-once (auto-save)
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    const cfg = getConfig();
    if (!cfg.antiViewOnce) return;
    for (const msg of messages) {
      if (msg.key.fromMe) continue;
      if (!msg.message) continue;
      const m: any = msg.message;
      const hasViewOnce =
        !!m.viewOnceMessageV2 || !!m.viewOnceMessage ||
        !!m.viewOnceMessageV2Extension ||
        !!m.imageMessage?.viewOnce || !!m.videoMessage?.viewOnce || !!m.audioMessage?.viewOnce;
      if (!hasViewOnce) continue;
      try {
        const { downloadContentFromMessage } = await import('@whiskeysockets/baileys');
        let mediaMessage: any = null;
        let mediaType: 'image' | 'video' | 'audio' | null = null;
        const wrapper = m.viewOnceMessageV2 || m.viewOnceMessage || m.viewOnceMessageV2Extension;
        if (wrapper?.message) {
          const inner = wrapper.message;
          if (inner.imageMessage) { mediaMessage = inner.imageMessage; mediaType = 'image'; }
          else if (inner.videoMessage) { mediaMessage = inner.videoMessage; mediaType = 'video'; }
          else if (inner.audioMessage) { mediaMessage = inner.audioMessage; mediaType = 'audio'; }
        }
        if (!mediaMessage && m.imageMessage?.viewOnce) { mediaMessage = m.imageMessage; mediaType = 'image'; }
        if (!mediaMessage && m.videoMessage?.viewOnce) { mediaMessage = m.videoMessage; mediaType = 'video'; }
        if (!mediaMessage && m.audioMessage?.viewOnce) { mediaMessage = m.audioMessage; mediaType = 'audio'; }
        if (!mediaMessage || !mediaType) continue;
        await new Promise(r => setTimeout(r, 1000 + Math.random() * 4000));
        const stream = await downloadContentFromMessage(mediaMessage, mediaType);
        const chunks: Buffer[] = [];
        for await (const chunk of stream) chunks.push(chunk);
        const buffer = Buffer.concat(chunks);
        if (buffer.length < 100) continue;
        const botJid = sock.user?.id;
        if (!botJid) continue;
        const botNumber = botJid.split(':')[0].split('@')[0];
        const targetJid = botNumber + '@s.whatsapp.net';
        const caption = mediaMessage.caption || '';
        const fullCaption = caption
          ? `👁️ View Once (auto-saved):\n${caption}`
          : `👁️ View Once ${mediaType.charAt(0).toUpperCase() + mediaType.slice(1)} (auto-saved)`;
        if (mediaType === 'image') {
          await sock.sendMessage(targetJid, { image: buffer, caption: fullCaption });
        } else if (mediaType === 'video') {
          await sock.sendMessage(targetJid, { video: buffer, mimetype: 'video/mp4', caption: fullCaption });
        } else if (mediaType === 'audio') {
          await sock.sendMessage(targetJid, { audio: buffer, mimetype: 'audio/mp4', ptt: true });
        }
      } catch (err) {
        console.warn('[BOT] antiViewOnce failed:', (err as Error).message);
      }
    }
  });

  // 5. Anti-call
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

  // 6. Always-online presence
  _alwaysOnlineInterval = setInterval(async () => {
    const cfg = getConfig();
    if (!cfg.alwaysOnline || !_sock?.user) return;
    try { await _sock.sendPresenceUpdate('available'); }
    catch (err) { /* ignore */ }
  }, 60_000);

  // 7. Anti-delete (log only — full restoration needs msg cache)
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

async function handleIncomingMessage(msg: proto.IWebMessageInfo): Promise<void> {
  if (!_sock) return;
  if (!msg.message) return;
  if (msg.key.fromMe) return;
  const chatJid = msg.key.remoteJid || '';
  const sender = msg.key.participant || chatJid;
  const text = extractText(msg);
  if (!text) return;

  const senderPhone = '+' + (sender.split('@')[0].split(':')[0]);
  const scammer = isKnownScammer(senderPhone);
  if (scammer) {
    console.log('[BOT] message from known scammer:', senderPhone);
    await _sock.sendMessage(chatJid, { react: { text: '🚫', key: msg.key } });
    await _sock.sendMessage(chatJid, {
      text: `⚠️ *WARNING*\n\nThis number is flagged as a known scammer.\nReason: ${scammer.reason}\nReports: ${scammer.totalReports}\n\nDo not engage or send money.`,
    }, { quoted: msg });
  }

  await dispatchMessage(_sock, msg, text);
}

function extractText(msg: proto.IWebMessageInfo): string {
  if (!msg.message) return '';
  let m: any = msg.message;
  if (m.ephemeralMessage) m = m.ephemeralMessage.message;
  if (m.viewOnceMessageV2) m = m.viewOnceMessageV2.message;
  if (m.viewOnceMessage) m = m.viewOnceMessage.message;
  if (m.documentWithCaptionMessage) m = m.documentWithCaptionMessage.message;
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    ''
  );
}
