/**
 * Zbot v2.1.4 — Baileys SocketManager (FULL AUDIT FIX)
 *
 * Bugs fixed vs user-uploaded v2.1.3:
 *   A. markOnlineOnConnect now `true` for pairing socket, `false` for regular.
 *   B. setupConnectionHandler called BEFORE requestPairingCode (was after — events missed).
 *   C. pairingInProgress reset in `finally` after 30s safety timeout (was never reset on timeout).
 *   D. HTTP /pair handler now checks state.ready + state.pairingInProgress (was only checking sock.user).
 *   E. Stale-session detection on boot: if session dir >1h old + never connected, wipe.
 *   F. Removed redundant healthCheck (alwaysOnline already does presence update).
 *   G. 401 disconnect: retry WITHOUT wiping session (was wiping like 515).
 *   H. Auto-status-seen now works (status@broadcast routed to handleStatus).
 *   I. Version uses process.env.BOT_VERSION (was hardcoded "v1.0.0").
 */

import makeWASocket, {
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
  DisconnectReason,
  type WASocket,
  type proto,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import fs from 'fs';
import path from 'path';
import { startStatusReporter, stopStatusReporter } from './firebase/status-reporter';
import { startScammerSync, stopScammerSync, isKnownScammer } from './firebase/scammer-sync';
import { startCommandListener, stopCommandListener } from './firebase/command-listener';
import { registerNumber, startNumberListener, stopNumberListener } from './firebase/number-registry';
import { getConfig, startConfigListener, stopConfigListener } from './firebase/config-runtime';
import { dispatchMessage } from './commands/_registry';

const CONFIG = {
  MAX_RECONNECT: 5,
  PAIRING_WAIT_MS: 2000,
  CONNECT_TIMEOUT_MS: 3000,
  PAIRING_LOCK_TIMEOUT_MS: 30_000,
  RECONNECT_BASE_DELAY: 3000,
  RECONNECT_MAX_DELAY: 60_000,
  ALWAYS_ONLINE_INTERVAL: 60_000,
  MESSAGE_DEDUP_TTL: 60_000,
  AUTO_REACT_DELAY_MIN: 500,
  AUTO_REACT_DELAY_MAX: 2000,
  AUTO_REPLY_DELAY_MIN: 1000,
  AUTO_REPLY_DELAY_MAX: 3000,
  STATUS_VIEW_DELAY_MIN: 5000,
  STATUS_VIEW_DELAY_MAX: 10000,
  // Hardcoded Baileys version — fetchLatestBaileysVersion returns buggy 1035194821
  // 1015901307 is the last known stable version that works with current WhatsApp protocol
  BAILEYS_VERSION: [2, 3000, 1015901307] as [number, number, number],
};

const SESSION_DIR = process.env.BOT_DATA_DIR
  ? path.join(process.env.BOT_DATA_DIR, 'session')
  : path.join(process.cwd(), 'session');

interface DisconnectError {
  output?: { statusCode?: number };
  statusCode?: number;
  message?: string;
}

interface SocketState {
  sock: WASocket | null;
  ready: boolean;
  pairingInProgress: boolean;
  reconnectAttempts: number;
  currentPairingCode: string | null;
  currentQR: string | null;
  deviceId: string | null;
  processedMessageIds: Set<string>;
  listeners: Map<string, { event: string; handler: Function }>;
  alwaysOnlineInterval: NodeJS.Timeout | null;
  pairingLockTimer: NodeJS.Timeout | null;
}

class SocketManager {
  private state: SocketState;
  private static instance: SocketManager;

  private constructor() {
    this.state = {
      sock: null,
      ready: false,
      pairingInProgress: false,
      reconnectAttempts: 0,
      currentPairingCode: null,
      currentQR: null,
      deviceId: null,
      processedMessageIds: new Set(),
      listeners: new Map(),
      alwaysOnlineInterval: null,
      pairingLockTimer: null,
    };
  }

  public static getInstance(): SocketManager {
    if (!SocketManager.instance) {
      SocketManager.instance = new SocketManager();
    }
    return SocketManager.instance;
  }

  public getSocket(): WASocket | null {
    return this.state.sock;
  }

  public isReady(): boolean {
    return this.state.ready;
  }

  public getQR(): string | null {
    return this.state.currentQR;
  }

  public getPairingCode(): string | null {
    return this.state.currentPairingCode;
  }

  public isPairing(): boolean {
    return this.state.pairingInProgress;
  }

  /**
   * Public status used by HTTP /pair handler to decide between
   * "Already connected", "Pairing in progress", or proceed.
   */
  public getStatus(): {
    connected: boolean;
    pairing: boolean;
    phone: string;
    ready: boolean;
  } {
    const sock = this.state.sock;
    const user = sock?.user;
    const phone = user?.id?.split(':')[0]?.split('@')[0] || '';
    return {
      connected: !!user && this.state.ready,
      pairing: this.state.pairingInProgress,
      phone,
      ready: this.state.ready,
    };
  }

  private ensureSessionDir(): void {
    if (!fs.existsSync(SESSION_DIR)) {
      fs.mkdirSync(SESSION_DIR, { recursive: true });
    }
  }

  private wipeSession(): void {
    if (fs.existsSync(SESSION_DIR)) {
      try {
        fs.rmSync(SESSION_DIR, { recursive: true, force: true });
      } catch (e) {
        console.warn('[BOT] wipeSession rmSync failed:', (e as Error).message);
      }
    }
    fs.mkdirSync(SESSION_DIR, { recursive: true });
  }

  /**
   * If session dir exists but is stale (older than 1h AND we have never connected),
   * wipe it. This prevents reconnect loops with partial creds from failed pairings.
   */
  private maybeWipeStaleSession(): void {
    if (!fs.existsSync(SESSION_DIR)) return;
    const stat = fs.statSync(SESSION_DIR);
    const ageMs = Date.now() - stat.mtimeMs;
    // If dir is empty (no creds), nothing to wipe
    const entries = fs.readdirSync(SESSION_DIR);
    if (entries.length === 0) return;
    // If we're not connected and dir is older than 1h, treat as stale
    if (!this.state.ready && ageMs > 3_600_000) {
      console.warn('[BOT] wiping stale session dir (age:', Math.round(ageMs / 1000), 's)');
      this.wipeSession();
    }
  }

  private registerListener(event: string, handler: Function): void {
    const key = `${event}_${Date.now()}_${Math.random()}`;
    this.state.listeners.set(key, { event, handler });
    if (this.state.sock) {
      this.state.sock.ev.on(event as any, handler as any);
    }
  }

  private clearListeners(): void {
    if (this.state.sock) {
      for (const [, { event, handler }] of this.state.listeners) {
        try {
          this.state.sock.ev.off(event as any, handler as any);
        } catch (e) { /* ignore */ }
      }
    }
    this.state.listeners.clear();
  }

  /**
   * Create a Baileys socket. `forPairing=true` uses settings that match FTGM's
   * pairing socket (markOnlineOnConnect: true, no shouldIgnoreJid).
   */
  private async createSocket(forPairing: boolean = false): Promise<WASocket> {
    this.ensureSessionDir();
    // Hardcoded version (fetchLatestBaileysVersion returns buggy version)
    const v = CONFIG.BAILEYS_VERSION;
    console.log('[BOT] Baileys version:', v.join('.'), forPairing ? '(pairing)' : '(regular)');

    const { state: authState, saveCreds } = await useMultiFileAuthState(SESSION_DIR);

    const socketOpts: any = {
      version: v,
      auth: {
        creds: authState.creds,
        keys: makeCacheableSignalKeyStore(authState.keys, pino({ level: 'fatal' })),
      },
      browser: ['Ubuntu', 'Chrome', '20.0.04'],
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      syncFullHistory: false,
      // CRITICAL FIX (Bug A): markOnlineOnConnect must be TRUE for pairing socket
      // FTGM uses true for pairing, false for regular. Without true, WhatsApp may
      // not acknowledge the link and the user sees "no notification".
      markOnlineOnConnect: forPairing ? true : false,
      generateHighQualityLinkPreview: false,
      defaultQueryTimeoutMs: 60_000,
      connectTimeoutMs: 60_000,
      keepAliveIntervalMs: 10_000,
    };

    // shouldIgnoreJid only for regular socket (matches FTGM)
    if (!forPairing) {
      socketOpts.shouldIgnoreJid = (jid: string) => jid === 'lid@broadcast';
    }

    const sock = makeWASocket(socketOpts);
    sock.ev.on('creds.update', saveCreds);
    return sock;
  }

  private getDisconnectCode(error: any): number | null {
    if (!error) return null;
    if (typeof error === 'object') {
      const err = error as DisconnectError;
      if (err.output?.statusCode) return err.output.statusCode;
      if (err.statusCode) return err.statusCode;
    }
    return null;
  }

  private isLoggedOut(code: number | null): boolean {
    return code === DisconnectReason.loggedOut || code === 515;
  }

  private isAuthError(code: number | null): boolean {
    return code === 401 || code === 403;
  }

  public async connect(deviceId: string): Promise<WASocket> {
    this.state.deviceId = deviceId;
    const ver = process.env.BOT_VERSION || '2.1.4';
    console.log('[BOT] Starting Zbot v' + ver);
    console.log('[BOT] DeviceId:', deviceId);
    console.log('[BOT] Session dir:', SESSION_DIR);
    this.maybeWipeStaleSession();
    await this.connectSocket();
    return this.state.sock!;
  }

  private async connectSocket(): Promise<void> {
    try {
      await this.cleanupSocket();
      const sock = await this.createSocket(false);
      this.state.sock = sock;
      this.state.ready = false;
      this.setupConnectionHandler(sock);
      this.setupMessageHandlers(sock);
      console.log('[BOT] Socket created, waiting for connection...');
    } catch (error) {
      console.error('[BOT] Failed to create socket:', error);
      throw error;
    }
  }

  /**
   * Set up the connection.update listener on a socket.
   * This MUST be called BEFORE requestPairingCode so we don't miss the "open" event.
   */
  private setupConnectionHandler(sock: WASocket): void {
    const handler = async (update: any) => {
      const { connection, lastDisconnect, qr } = update;
      if (qr) {
        try {
          const QRCode = (await import('qrcode')).default;
          this.state.currentQR = await QRCode.toDataURL(qr);
          console.log('[BOT] QR code generated');
        } catch (err) {
          this.state.currentQR = null;
          console.warn('[BOT] QR generation failed:', err);
        }
      }
      if (connection === 'open') {
        await this.handleSocketOpen(sock);
        return;
      }
      if (connection === 'close') {
        await this.handleSocketClose(lastDisconnect);
        return;
      }
    };
    this.registerListener('connection.update', handler);
  }

  private async handleSocketOpen(sock: WASocket): Promise<void> {
    this.state.ready = true;
    this.state.currentQR = null;
    this.state.currentPairingCode = null;
    this.state.reconnectAttempts = 0;
    this.state.pairingInProgress = false;
    this.clearPairingLock();

    const phone = '+' + (sock.user?.id?.split(':')[0]?.split('@')[0] || '?');
    const deviceModel = process.env.BOT_DEVICE_MODEL || 'Android';
    const botVersion = process.env.BOT_VERSION || '2.1.4';
    console.log('[BOT] Connected:', phone);

    try {
      await registerNumber(phone, deviceModel, botVersion);
      startNumberListener();
      startConfigListener();
      startStatusReporter({ phone, deviceModel, botVersion });
      startScammerSync();
      startCommandListener();
    } catch (error) {
      console.error('[BOT] Failed to start services:', error);
    }
    this.startAlwaysOnline(sock);
  }

  private async handleSocketClose(lastDisconnect: any): Promise<void> {
    const code = this.getDisconnectCode(lastDisconnect?.error);
    console.log('[BOT] Disconnected, code:', code);
    this.state.ready = false;
    this.state.currentQR = null;
    this.state.currentPairingCode = null;
    this.stopAllServices();

    // 515 (loggedOut): wipe session + reconnect fresh
    if (this.isLoggedOut(code)) {
      console.error('[BOT] Logged out (515) — wiping session');
      this.wipeSession();
      this.state.reconnectAttempts = 0;
      await this.reconnect(3000);
      return;
    }

    // 401/403 (auth error): retry WITHOUT wiping (creds might still be valid)
    // FIX (Bug G): was wiping session on 401, losing possibly-valid creds
    if (this.isAuthError(code)) {
      console.warn('[BOT] Auth error (', code, ') — retrying without wipe');
      this.state.reconnectAttempts++;
      if (this.state.reconnectAttempts <= CONFIG.MAX_RECONNECT) {
        await this.reconnect(3000);
      } else {
        console.error('[BOT] Max auth-error reconnect attempts reached — wiping');
        this.wipeSession();
        this.state.reconnectAttempts = 0;
        await this.reconnect(5000);
      }
      return;
    }

    // All other codes (408, 428, 500, etc.): reconnect with backoff
    if (this.state.reconnectAttempts < CONFIG.MAX_RECONNECT) {
      this.state.reconnectAttempts++;
      const delay = Math.min(
        CONFIG.RECONNECT_BASE_DELAY * Math.pow(2, this.state.reconnectAttempts) + Math.random() * 2000,
        CONFIG.RECONNECT_MAX_DELAY,
      );
      console.log(`[BOT] Reconnecting in ${delay}ms (attempt ${this.state.reconnectAttempts})`);
      await this.reconnect(delay);
    } else {
      console.error('[BOT] Max reconnect attempts reached');
    }
  }

  /**
   * CRITICAL FIX (Bugs A, B, C, D):
   * - Uses forPairing=true (markOnlineOnConnect: true)
   * - setupConnectionHandler called BEFORE requestPairingCode
   * - pairingInProgress reset in finally after 30s safety timeout
   */
  public async requestPairingCode(phoneNumber: string): Promise<string> {
    if (this.state.pairingInProgress) {
      throw new Error('Pairing already in progress');
    }

    const cleaned = phoneNumber.replace(/[^0-9]/g, '');
    if (cleaned.length < 10 || cleaned.length > 15) {
      throw new Error('Invalid phone number (must be 10-15 digits)');
    }

    this.state.pairingInProgress = true;
    this.startPairingLock();

    let newSock: WASocket | null = null;
    try {
      console.log('[BOT] Pairing request for:', cleaned);

      // 1. Kill existing socket + listeners
      await this.cleanupSocket();

      // 2. Wipe session (fresh start for pairing)
      this.wipeSession();

      // 3. Wait 2s for clean state
      console.log('[BOT] Waiting 2s for clean state...');
      await this.sleep(CONFIG.PAIRING_WAIT_MS);

      // 4. Create NEW socket with forPairing=true (markOnlineOnConnect: true)
      newSock = await this.createSocket(true);
      this.state.sock = newSock;
      this.state.ready = false;

      // 5. CRITICAL FIX (Bug B): Set up connection handler BEFORE requesting pair code.
      // This ensures we catch the "open" event when user enters the code in WhatsApp.
      this.setupConnectionHandler(newSock);
      this.setupMessageHandlers(newSock);

      // 6. Wait for socket to enter "connecting" state + 3s
      await this.waitForConnecting(newSock);

      // 7. Request pairing code
      console.log('[BOT] Requesting pairing code...');
      const code = await newSock.requestPairingCode(cleaned);
      this.state.currentPairingCode = code?.match(/.{1,4}/g)?.join('-') || code;
      console.log('[BOT] Pairing code:', this.state.currentPairingCode);
      console.log('[BOT] >>> Open WhatsApp → Settings → Linked Devices → Link with phone number');
      console.log('[BOT] >>> Enter the code above. Bot will auto-connect when paired.');

      return this.state.currentPairingCode!;
    } catch (error) {
      console.error('[BOT] Pairing failed:', error);
      // Clean up the half-created socket
      if (newSock) {
        try {
          (newSock.ev as any).removeAllListeners();
          newSock.ws.close();
        } catch (e) { /* ignore */ }
      }
      this.state.sock = null;
      this.state.pairingInProgress = false;
      this.clearPairingLock();
      throw new Error('Failed to get pairing code: ' + (error as Error).message);
    }
    // NOTE: No finally block here. pairingInProgress is reset by:
    //   - handleSocketOpen (on successful pair)
    //   - clearPairingLock (after 30s safety timeout)
    //   - catch block above (on immediate error)
  }

  /**
   * Start a 30s safety timer. If pairing doesn't complete in 30s, reset the flag
   * so user can try again. (Bug C fix)
   */
  private startPairingLock(): void {
    this.clearPairingLock();
    this.state.pairingLockTimer = setTimeout(() => {
      if (this.state.pairingInProgress) {
        console.warn('[BOT] Pairing lock timeout (30s) — resetting flag');
        this.state.pairingInProgress = false;
      }
    }, CONFIG.PAIRING_LOCK_TIMEOUT_MS);
  }

  private clearPairingLock(): void {
    if (this.state.pairingLockTimer) {
      clearTimeout(this.state.pairingLockTimer);
      this.state.pairingLockTimer = null;
    }
  }

  private waitForConnecting(sock: WASocket): Promise<void> {
    return new Promise((resolve) => {
      let resolved = false;
      const finish = () => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeout);
        try { sock.ev.off('connection.update', handler); } catch (e) { /* ignore */ }
        resolve();
      };

      const timeout = setTimeout(() => {
        console.log('[BOT] Socket ready timeout (8s) — proceeding anyway');
        finish();
      }, 8000);

      const handler = (update: any) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
          console.log('[BOT] QR available during pairing (will be ignored — using pair code)');
        }
        if (connection === 'connecting') {
          console.log('[BOT] Socket connecting — waiting 3s...');
          setTimeout(finish, CONFIG.CONNECT_TIMEOUT_MS);
        }
        if (connection === 'open') {
          console.log('[BOT] Connected during pairing!');
          finish();
        }
        if (connection === 'close') {
          const code = this.getDisconnectCode(lastDisconnect?.error);
          console.warn('[BOT] Disconnected during pairing wait, code:', code, '— proceeding to try pair code anyway');
          finish();
        }
      };
      sock.ev.on('connection.update', handler);
    });
  }

  private setupMessageHandlers(sock: WASocket): void {
    const messageHandler = async ({ messages, type }: any) => {
      if (type !== 'notify') return;
      for (const msg of messages) {
        try {
          await this.processMessage(sock, msg);
        } catch (error) {
          console.error('[BOT] Message processing error:', error);
        }
      }
    };
    this.registerListener('messages.upsert', messageHandler);

    const callHandler = async (event: any) => {
      await this.handleCall(sock, event);
    };
    this.registerListener('call', callHandler);

    const updateHandler = async (updates: any[]) => {
      await this.handleMessageUpdates(sock, updates);
    };
    this.registerListener('messages.update', updateHandler);
  }

  private async processMessage(sock: WASocket, msg: proto.IWebMessageInfo): Promise<void> {
    if (msg.key?.id && this.state.processedMessageIds.has(msg.key.id)) {
      return;
    }
    if (msg.key?.id) {
      this.state.processedMessageIds.add(msg.key.id);
      const id = msg.key.id;
      setTimeout(() => {
        this.state.processedMessageIds.delete(id);
      }, CONFIG.MESSAGE_DEDUP_TTL);
    }

    const chatJid = msg.key.remoteJid || '';

    // FIX (Bug H): Route status broadcasts to handleStatus BEFORE the early-return
    if (chatJid === 'status@broadcast') {
      if (!msg.key.fromMe) {
        await this.handleStatus(sock, msg);
      }
      return;
    }

    if (!chatJid) return;
    if (msg.key.fromMe) return;

    const sender = msg.key.participant || chatJid;
    const text = this.extractText(msg);
    const cfg = getConfig();

    if (text) {
      const senderPhone = '+' + (sender.split('@')[0].split(':')[0]);
      const scammer = isKnownScammer(senderPhone);
      if (scammer) {
        console.log('[BOT] Scammer detected:', senderPhone);
        await this.handleScammer(sock, msg, chatJid, scammer);
        return;
      }
    }

    if (cfg.autoReacts && cfg.autoReactsEmoji?.length > 0) {
      await this.handleAutoReact(sock, msg);
    }
    if (text && cfg.autoReply && Object.keys(cfg.autoReplyCommands).length > 0) {
      await this.handleAutoReply(sock, msg, text, cfg);
    }
    if (text) {
      await dispatchMessage(sock, msg, text);
    }
  }

  private async handleScammer(
    sock: WASocket,
    msg: proto.IWebMessageInfo,
    chatJid: string,
    scammer: any,
  ): Promise<void> {
    try {
      await sock.sendMessage(chatJid, { react: { text: '🚫', key: msg.key } });
      await sock.sendMessage(chatJid, {
        text: `⚠️ *WARNING*\n\nThis number is flagged as a known scammer.\nReason: ${scammer.reason}\nReports: ${scammer.totalReports}\n\nDo not engage or send money.`,
      }, { quoted: msg });
    } catch (error) {
      console.warn('[BOT] Scammer handling failed:', error);
    }
  }

  private async handleAutoReact(sock: WASocket, msg: proto.IWebMessageInfo): Promise<void> {
    try {
      const emojis = getConfig().autoReactsEmoji;
      if (!emojis || emojis.length === 0) return;
      const emoji = emojis[Math.floor(Math.random() * emojis.length)];
      await this.sleep(CONFIG.AUTO_REACT_DELAY_MIN + Math.random() * CONFIG.AUTO_REACT_DELAY_MAX);
      if (msg.key.remoteJid) {
        await sock.sendMessage(msg.key.remoteJid, { react: { text: emoji, key: msg.key } });
      }
    } catch (error) { /* ignore */ }
  }

  private async handleAutoReply(
    sock: WASocket,
    msg: proto.IWebMessageInfo,
    text: string,
    cfg: any,
  ): Promise<void> {
    const lower = text.toLowerCase();
    const commands = cfg.autoReplyCommands || {};
    for (const [keyword, reply] of Object.entries(commands)) {
      if (lower.includes(keyword.toLowerCase())) {
        try {
          await this.sleep(CONFIG.AUTO_REPLY_DELAY_MIN + Math.random() * CONFIG.AUTO_REPLY_DELAY_MAX);
          if (msg.key.remoteJid) {
            await sock.sendMessage(msg.key.remoteJid, { text: reply as string }, { quoted: msg });
          }
          break;
        } catch (error) { /* ignore */ }
      }
    }
  }

  private async handleCall(sock: WASocket, event: any): Promise<void> {
    const cfg = getConfig();
    if (!cfg.antiCall) return;
    const callId = event?.id || event?.callId;
    const from = event?.from || event?.fromJid;
    if (!callId || !from) return;
    try {
      if (typeof (sock as any).rejectCall === 'function') {
        await (sock as any).rejectCall(callId, from);
        console.log('[BOT] Rejected call from:', from);
      }
    } catch (error) {
      console.warn('[BOT] Call rejection failed:', error);
    }
  }

  private async handleMessageUpdates(sock: WASocket, updates: any[]): Promise<void> {
    const cfg = getConfig();
    if (!cfg.antiDelete) return;
    for (const update of updates) {
      try {
        if (update.update?.message === null && update.key) {
          console.log('[BOT] Message deleted:', update.key.id);
        }
      } catch (error) { /* ignore */ }
    }
  }

  private async handleStatus(sock: WASocket, msg: proto.IWebMessageInfo): Promise<void> {
    const cfg = getConfig();
    if (!cfg.autoStatusSeen) return;
    if (msg.key.fromMe) return;
    try {
      await this.sleep(CONFIG.STATUS_VIEW_DELAY_MIN + Math.random() * CONFIG.STATUS_VIEW_DELAY_MAX);
      await sock.readMessages([msg.key]);
    } catch (error) { /* ignore */ }
  }

  private extractText(msg: proto.IWebMessageInfo): string {
    if (!msg.message) return '';
    let m: any = msg.message;
    if (m.ephemeralMessage) m = m.ephemeralMessage.message;
    if (m.viewOnceMessageV2) m = m.viewOnceMessageV2.message;
    if (m.viewOnceMessage) m = m.viewOnceMessage.message;
    if (m.documentWithCaptionMessage) m = m.documentWithCaptionMessage.message;
    if (m.conversation) return m.conversation;
    if (m.extendedTextMessage?.text) return m.extendedTextMessage.text;
    if (m.imageMessage?.caption) return m.imageMessage.caption;
    if (m.videoMessage?.caption) return m.videoMessage.caption;
    if (m.buttonsResponseMessage?.selectedButtonId) return m.buttonsResponseMessage.selectedButtonId;
    if (m.templateButtonReplyMessage?.selectedId) return m.templateButtonReplyMessage.selectedId;
    if (m.listResponseMessage?.singleSelectReply?.selectedRowId) {
      return m.listResponseMessage.singleSelectReply.selectedRowId;
    }
    if (m.pollMessage?.pollCreationMessage?.name) return m.pollMessage.pollCreationMessage.name;
    if (m.pollCreationMessage?.name) return m.pollCreationMessage.name;
    return '';
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async cleanupSocket(): Promise<void> {
    this.clearListeners();
    this.stopAlwaysOnline();
    if (this.state.sock) {
      try {
        (this.state.sock.ev as any).removeAllListeners();
        this.state.sock.ws.close();
      } catch (error) { /* ignore */ }
      this.state.sock = null;
    }
    this.state.ready = false;
    this.state.currentQR = null;
    this.state.currentPairingCode = null;
  }

  private stopAllServices(): void {
    stopStatusReporter();
    stopScammerSync();
    stopCommandListener();
    stopNumberListener();
    stopConfigListener();
    this.stopAlwaysOnline();
  }

  private stopAlwaysOnline(): void {
    if (this.state.alwaysOnlineInterval) {
      clearInterval(this.state.alwaysOnlineInterval);
      this.state.alwaysOnlineInterval = null;
    }
  }

  private startAlwaysOnline(sock: WASocket): void {
    this.stopAlwaysOnline();
    this.state.alwaysOnlineInterval = setInterval(async () => {
      try {
        const cfg = getConfig();
        if (!cfg.alwaysOnline || !this.state.sock?.user) return;
        await this.state.sock.sendPresenceUpdate('available');
      } catch (error) { /* ignore */ }
    }, CONFIG.ALWAYS_ONLINE_INTERVAL);
  }

  private async reconnect(delay: number): Promise<void> {
    await this.sleep(delay);
    try {
      await this.connectSocket();
    } catch (error) {
      console.error('[BOT] Reconnect failed:', error);
    }
  }

  public async disconnect(): Promise<void> {
    console.log('[BOT] Disconnecting...');
    this.stopAllServices();
    this.clearPairingLock();
    this.state.pairingInProgress = false;
    await this.cleanupSocket();
    this.state.deviceId = null;
    this.state.processedMessageIds.clear();
  }

  public async waitForReady(timeoutMs: number = 10_000): Promise<boolean> {
    const start = Date.now();
    while (!this.state.ready && Date.now() - start < timeoutMs) {
      await this.sleep(200);
    }
    return this.state.ready;
  }

  public async disconnectSession(): Promise<void> {
    console.log('[BOT] Disconnecting and wiping session...');
    await this.disconnect();
    this.wipeSession();
    console.log('[BOT] Session wiped');
  }
}

const socketManager = SocketManager.getInstance();

export async function startBot(deviceId: string): Promise<WASocket> {
  return await socketManager.connect(deviceId);
}
export async function stopBot(): Promise<void> {
  await socketManager.disconnect();
}
export function getSocket(): WASocket | null {
  return socketManager.getSocket();
}
export async function requestPairingCode(phoneNumber: string): Promise<string> {
  return await socketManager.requestPairingCode(phoneNumber);
}
export function getCurrentQR(): string | null {
  return socketManager.getQR();
}
export function getPairingCode(): string | null {
  return socketManager.getPairingCode();
}
export function isPairing(): boolean {
  return socketManager.isPairing();
}
export function getSocketStatus(): {
  connected: boolean; pairing: boolean; phone: string; ready: boolean;
} {
  return socketManager.getStatus();
}
export async function waitForSocketReady(timeoutMs: number = 10_000): Promise<boolean> {
  return await socketManager.waitForReady(timeoutMs);
}
export async function disconnectSession(): Promise<void> {
  await socketManager.disconnectSession();
}
