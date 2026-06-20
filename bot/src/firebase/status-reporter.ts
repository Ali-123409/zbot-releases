/**
 * Zbot v2.1.6 — Status Reporter (30s RTDB heartbeat)
 *
 * Fixes:
 * - stopStatusReporter no longer calls markOffline (was flapping online/offline on every transient disconnect — C5)
 * - RTDB sets wrapped in try/catch so FS counter still increments (H1)
 * - onDisconnect uses serverTimestamp() instead of Date.now() (H2)
 * - _onDisconnectWired flag reset on stop so hooks re-arm after restart (H3)
 * - _firestoreUpdateCounter reset on start (L2)
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
  // v2.1.6 FIX (L2): reset counter on start
  _firestoreUpdateCounter = 0;

  if (_statusInterval) clearInterval(_statusInterval);
  wireOnDisconnect();
  reportStatus().catch(err => console.warn('[STATUS] first report:', (err as Error).message));

  _statusInterval = setInterval(() => {
    reportStatus().catch(err => console.warn('[STATUS] report:', (err as Error).message));
  }, 30_000);
}

export function stopStatusReporter(): void {
  if (_statusInterval) { clearInterval(_statusInterval); _statusInterval = null; }
  // v2.1.6 FIX (C5): do NOT call markOffline here — was flapping status on every
  // transient WhatsApp disconnect (408/428/500). The RTDB onDisconnect hook will
  // mark offline automatically when the process actually exits.
  // v2.1.6 FIX (H3): reset _onDisconnectWired so hooks re-arm on next start
  _onDisconnectWired = false;
}

function wireOnDisconnect(): void {
  if (_onDisconnectWired) return;
  try {
    const rtdb = getRtdb();
    const deviceId = getDeviceId();
    // v2.1.6 FIX (H2): use serverTimestamp() instead of Date.now()
    // (Date.now() captures registration time, not disconnect time)
    onDisconnect(ref(rtdb, RTDB_PATHS.status(deviceId))).update({
      online: false, status: 'offline', updatedAt: serverTimestamp(),
    }).catch((err: Error) => console.warn('[STATUS] onDisconnect status wire failed:', err.message));
    onDisconnect(ref(rtdb, RTDB_PATHS.presence(deviceId))).update({
      online: false, lastSeen: serverTimestamp(),
    }).catch((err: Error) => console.warn('[STATUS] onDisconnect presence wire failed:', err.message));
    onDisconnect(ref(rtdb, RTDB_PATHS.heartbeat(deviceId))).set({ ts: 0 })
      .catch((err: Error) => console.warn('[STATUS] onDisconnect heartbeat wire failed:', err.message));
    _onDisconnectWired = true;
  } catch (err) {
    console.warn('[STATUS] wireOnDisconnect failed:', (err as Error).message);
  }
}

async function reportStatus(): Promise<void> {
  const deviceId = getDeviceId();
  const rtdb = getRtdb();
  const status: BotStatus = {
    online: true, phone: _currentPhone, battery: _batteryLevel,
    network: _networkType, deviceModel: _currentDeviceModel,
    botVersion: _currentBotVersion, status: 'online',
    lastHeartbeat: Date.now(), updatedAt: Date.now(),
  };

  // v2.1.6 FIX (H1): wrap each RTDB set in its own try/catch so a failure
  // doesn't prevent the FS counter from incrementing
  try { await set(ref(rtdb, RTDB_PATHS.heartbeat(deviceId)), { ts: Date.now() }); }
  catch (err) { console.warn('[STATUS] heartbeat set failed:', (err as Error).message); }

  try { await set(ref(rtdb, RTDB_PATHS.status(deviceId)), status); }
  catch (err) { console.warn('[STATUS] status set failed:', (err as Error).message); }

  try {
    await set(ref(rtdb, RTDB_PATHS.presence(deviceId)), {
      online: true, lastSeen: Date.now(),
    });
  } catch (err) { console.warn('[STATUS] presence set failed:', (err as Error).message); }

  // v2.1.6 FIX (H1): always increment counter (was being skipped when RTDB failed)
  _firestoreUpdateCounter++;
  if (_firestoreUpdateCounter >= 10) {
    _firestoreUpdateCounter = 0;
    try {
      const db = getDb();
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

// v2.1.6 FIX (C5): markOffline is now only called on explicit shutdown (not transient disconnects)
// It's exported but only invoked by gracefulShutdown in index.ts.
export async function markOffline(): Promise<void> {
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
