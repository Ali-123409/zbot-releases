/**
 * Zbot — Runtime Config (Firestore + RTDB live overrides)
 */

import {
  doc, onSnapshot, setDoc, type Unsubscribe,
} from 'firebase/firestore';
import { ref, onValue } from 'firebase/database';
import { getDb, getRtdb, getDeviceId } from './init';
import { FS_COLLECTIONS, RTDB_PATHS } from './config';

export interface BotConfig {
  botName: string;
  ownerName: string;
  ownerNumber: string;
  prefix: string;
  botVersion: string;
  mode: 'public' | 'private';
  channelJid: string;
  channelLink: string;
  forwardScore: number;
  antiDelete: boolean;
  antiDeleteStatus: boolean;
  antiEdit: boolean;
  autoStatusSeen: boolean;
  autoStatusReact: boolean;
  autoStatusEmoji: string;
  antiViewOnce: boolean;
  antiCall: boolean;
  alwaysOnline: boolean;
  autoReacts: boolean;
  autoReactsEmoji: string[];
  autoReply: boolean;
  autoReplyCommands: Record<string, string>;
  customMenu: string;
  menuImage: string;
  groups: {
    antiTagAll: string[];
    antiLink: string[];
    welcomeMsg: Record<string, string>;
    goodbyeMsg: Record<string, string>;
  };
}

const DEFAULT_CONFIG: BotConfig = {
  botName: 'Zbot', ownerName: 'Admin', ownerNumber: '0000000000',
  prefix: '.', botVersion: '1.0.0', mode: 'public',
  channelJid: '', channelLink: '', forwardScore: 1,
  antiDelete: true, antiDeleteStatus: true, antiEdit: true,
  autoStatusSeen: true, autoStatusReact: false, autoStatusEmoji: '🔥',
  antiViewOnce: true, antiCall: false, alwaysOnline: true,
  autoReacts: false, autoReactsEmoji: ['⚡', '💙', '✅', '❤️', '🇵🇰'],
  autoReply: false, autoReplyCommands: {},
  customMenu: '', menuImage: '',
  groups: { antiTagAll: [], antiLink: [], welcomeMsg: {}, goodbyeMsg: {} },
};

let _config: BotConfig = { ...DEFAULT_CONFIG };
let _unsubscribeFs: Unsubscribe | null = null;
let _unsubscribeRtdb: (() => void) | null = null;

export function getConfig(): BotConfig { return _config; }
export function updateConfig(patch: Partial<BotConfig>): void {
  _config = { ..._config, ...patch };
}
export async function persistConfig(): Promise<void> {
  try {
    await setDoc(doc(getDb(), FS_COLLECTIONS.configs, getDeviceId()), _config, { merge: true });
  } catch (err) {
    console.warn('[CONFIG] persist failed:', (err as Error).message);
  }
}

export function startConfigListener(): void {
  const deviceId = getDeviceId();
  _unsubscribeFs = onSnapshot(
    doc(getDb(), FS_COLLECTIONS.configs, deviceId),
    (snap) => {
      if (snap.exists()) {
        const data = snap.data() as Partial<BotConfig>;
        _config = {
          ...DEFAULT_CONFIG, ...data,
          groups: { ...DEFAULT_CONFIG.groups, ...(data.groups || {}) },
        } as BotConfig;
      } else {
        setDoc(doc(getDb(), FS_COLLECTIONS.configs, deviceId), DEFAULT_CONFIG).catch(() => {});
      }
    },
    (err) => console.warn('[CONFIG] FS listener error:', err.message),
  );
  _unsubscribeRtdb = onValue(
    ref(getRtdb(), RTDB_PATHS.configOverrides(deviceId)),
    (snap) => {
      const overrides = snap.val();
      if (overrides && typeof overrides === 'object') {
        const { updatedAt, ...cfg } = overrides;
        _config = { ..._config, ...cfg };
      }
    },
  );
}

export function stopConfigListener(): void {
  if (_unsubscribeFs) { _unsubscribeFs(); _unsubscribeFs = null; }
  if (_unsubscribeRtdb) { _unsubscribeRtdb(); _unsubscribeRtdb = null; }
}
