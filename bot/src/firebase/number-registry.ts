/**
 * Zbot — Number Registry (numbers/{deviceId} lifecycle + approval/revocation)
 */

import {
  doc, setDoc, onSnapshot, serverTimestamp, type Unsubscribe,
} from 'firebase/firestore';
import { getDb, getDeviceId } from './init';
import { FS_COLLECTIONS } from './config';
import { disconnectSession } from '../socket';

let _approved = false;
let _revoked = false;
let _unsubscribe: Unsubscribe | null = null;
let _docCreated = false;

export function isApproved(): boolean { return _approved; }
export function isRevoked(): boolean { return _revoked; }

export async function registerNumber(
  phone: string, deviceModel: string, botVersion: string,
): Promise<void> {
  const deviceId = getDeviceId();
  console.log('[NUMBER-REGISTRY] registering:', deviceId, phone);
  await setDoc(doc(getDb(), FS_COLLECTIONS.numbers, deviceId), {
    phone, phoneJid: '', status: 'online',
    deviceModel, botVersion, lastSeen: serverTimestamp(),
  }, { merge: true });
  _docCreated = true;
  console.log('[NUMBER-REGISTRY] registered, awaiting admin approval');
}

export async function updateNumberStatus(patch: Record<string, unknown>): Promise<void> {
  if (!_docCreated) return;
  try {
    await setDoc(doc(getDb(), FS_COLLECTIONS.numbers, getDeviceId()), patch, { merge: true });
  } catch (err) {
    console.warn('[NUMBER-REGISTRY] update failed:', (err as Error).message);
  }
}

export function startNumberListener(): void {
  const deviceId = getDeviceId();
  console.log('[NUMBER-REGISTRY] starting listener for', deviceId);
  _unsubscribe = onSnapshot(
    doc(getDb(), FS_COLLECTIONS.numbers, deviceId),
    (snap) => {
      if (!snap.exists()) {
        console.warn('[NUMBER-REGISTRY] doc deleted by admin — stopping');
        _approved = false; _revoked = true; _docCreated = false;
        triggerShutdown('doc_deleted');
        return;
      }
      const data = snap.data();
      const wasApproved = _approved;
      _approved = data.approved === true;
      if (_approved && !wasApproved) {
        console.log('[NUMBER-REGISTRY] ✅ approved by admin');
      } else if (!_approved && wasApproved) {
        console.log('[NUMBER-REGISTRY] ⚠️ approval revoked');
      }
      if (data.status === 'revoked') {
        console.warn('[NUMBER-REGISTRY] 🚨 admin revoked access');
        _revoked = true;
        triggerShutdown('revoked');
      }
    },
    (err) => {
      console.warn('[NUMBER-REGISTRY] listener error:', err.message);
      setTimeout(() => {
        if (_unsubscribe) _unsubscribe();
        startNumberListener();
      }, 5_000);
    },
  );
}

export function stopNumberListener(): void {
  if (_unsubscribe) { _unsubscribe(); _unsubscribe = null; }
}

let _shuttingDown = false;
async function triggerShutdown(reason: string): Promise<void> {
  if (_shuttingDown) return;
  _shuttingDown = true;
  console.error('[NUMBER-REGISTRY] shutdown triggered:', reason);
  try { await disconnectSession(); } catch (err) { /* ignore */ }
  setTimeout(() => process.exit(1), 2_000);
}
