/**
 * Zbot — Status Reporter (30s RTDB heartbeat)
 */

import { ref, set, update, onDisconnect, serverTimestamp } from 'firebase/database';
import { doc, setDoc, serverTimestamp as fsServerTimestamp } from 'firebase/firestore';
import { getDb, getRtdb, getDeviceId } from './init';
import { RTDB_PATHS, FS_COLLECTIONS } from './config';

export interface BotStatus {
  online: boolean;
  phone: string;
  battery: number;
  network: 'wifi' | 'mobile' | 'none';
  deviceModel: string;
  botVersion: string;
  status: 'online' | 'offline' | 'banned' | 'pairing' | 'disconnected';
  lastHeartbeat: number;
  updatedAt: number;
}

let _statusInterval: NodeJS.Timeout | null = null;
let _firestoreUpdateCounter = 0;
let _currentPhone = '';
let _currentDeviceModel = '';
let _currentBotVersion = '';
let _onDisconnectWired = false;
let _batteryLevel = 100;
let _networkType: 'wifi' | 'mobile' | 'none' = 'wifi';

export function setBatteryLevel(level: number): void {
  _batteryLevel = Math.max(0, Math.min(100, level));
}
export function setNetworkType(type: 'wifi' | 'mobile' | 'none'): void {
  _networkType = type;
}

export function startStatusReporter(opts: {
  phone: string; deviceModel: string; botVersion: string;
}): void {
  _currentPhone = opts.phone;
  _currentDeviceModel = opts.deviceModel;
  _currentBotVersion = opts.botVersion;

  if (_statusInterval) clearInterval(_statusInterval);
  wireOnDisconnect();
  reportStatus().catch(err => console.warn('[STATUS] first report:', (err as Error).message));

  _statusInterval = setInterval(() => {
    reportStatus().catch(err => console.warn('[STATUS] report:', (err as Error).message));
  }, 30_000);
}

export function stopStatusReporter(): void {
  if (_statusInterval) { clearInterval(_statusInterval); _statusInterval = null; }
  markOffline().catch(() => {});
}

function wireOnDisconnect(): void {
  if (_onDisconnectWired) return;
  const rtdb = getRtdb();
  const deviceId = getDeviceId();
  onDisconnect(ref(rtdb, RTDB_PATHS.status(deviceId))).update({
    online: false, status: 'offline', updatedAt: Date.now(),
  });
  onDisconnect(ref(rtdb, RTDB_PATHS.presence(deviceId))).update({
    online: false, lastSeen: serverTimestamp(),
  });
  onDisconnect(ref(rtdb, RTDB_PATHS.heartbeat(deviceId))).set({ ts: 0 });
  _onDisconnectWired = true;
}

async function reportStatus(): Promise<void> {
  const deviceId = getDeviceId();
  const rtdb = getRtdb();
  const db = getDb();
  const status: BotStatus = {
    online: true, phone: _currentPhone, battery: _batteryLevel,
    network: _networkType, deviceModel: _currentDeviceModel,
    botVersion: _currentBotVersion, status: 'online',
    lastHeartbeat: Date.now(), updatedAt: Date.now(),
  };
  await set(ref(rtdb, RTDB_PATHS.heartbeat(deviceId)), { ts: Date.now() });
  await set(ref(rtdb, RTDB_PATHS.status(deviceId)), status);
  await set(ref(rtdb, RTDB_PATHS.presence(deviceId)), {
    online: true, lastSeen: Date.now(),
  });
  _firestoreUpdateCounter++;
  if (_firestoreUpdateCounter >= 10) {
    _firestoreUpdateCounter = 0;
    try {
      await setDoc(doc(db, FS_COLLECTIONS.numbers, deviceId), {
        status: 'online', lastSeen: fsServerTimestamp(),
        battery: status.battery, networkType: status.network,
        botVersion: status.botVersion, phoneJid: status.phone,
      }, { merge: true });
    } catch (err) {
      console.warn('[STATUS] FS update skipped:', (err as Error).message);
    }
  }
}

async function markOffline(): Promise<void> {
  const deviceId = getDeviceId();
  try {
    await update(ref(getRtdb(), RTDB_PATHS.status(deviceId)), {
      online: false, status: 'offline', updatedAt: Date.now(),
    });
    await set(ref(getRtdb(), RTDB_PATHS.presence(deviceId)), {
      online: false, lastSeen: Date.now(),
    });
    await setDoc(doc(getDb(), FS_COLLECTIONS.numbers, deviceId), {
      status: 'offline', lastSeen: fsServerTimestamp(),
    }, { merge: true });
  } catch (err) { /* ignore */ }
}
