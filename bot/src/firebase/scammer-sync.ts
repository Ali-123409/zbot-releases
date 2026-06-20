/**
 * Zbot — Scammer Sync (real-time watchlist)
 */

import {
  collection, onSnapshot,
  type QuerySnapshot, type DocumentData,
} from 'firebase/firestore';
import { getDb } from './init';
import { FS_COLLECTIONS } from './config';

export interface Scammer {
  phone: string;
  reason: 'fraud' | 'impersonation' | 'spam' | 'other';
  totalReports: number;
  reportedBy: string[];
  reportedAt: number;
  lastReportedAt: number;
  status: 'active' | 'cleared';
  notes?: string;
  evidenceIds?: string[];
  displayName?: string;
}

const _scammerMap = new Map<string, Scammer>();
let _unsubscribe: (() => void) | null = null;

export function startScammerSync(): void {
  // v2.1.6 FIX (H7 from firebase audit): idempotent — unsubscribe previous first
  if (_unsubscribe) { _unsubscribe(); _unsubscribe = null; }
  console.log('[SCAMMER-SYNC] starting listener');
  _unsubscribe = onSnapshot(
    collection(getDb(), FS_COLLECTIONS.scammers),
    (snapshot: QuerySnapshot<DocumentData>) => {
      snapshot.docChanges().forEach((change) => {
        const data = change.doc.data() as Scammer;
        // v2.1.6 FIX (C1): normalize doc ID to +digits format to match lookup key
        const phone = normalizePhone(change.doc.id) || change.doc.id;
        if (change.type === 'removed') {
          _scammerMap.delete(phone);
        } else {
          if (data.status === 'active') {
            _scammerMap.set(phone, { ...data, phone });
          } else {
            _scammerMap.delete(phone);
          }
        }
      });
      console.log('[SCAMMER-SYNC] watchlist size:', _scammerMap.size);
    },
    (err: Error) => {
      console.error('[SCAMMER-SYNC] error:', err.message);
      // v2.1.6 FIX: only retry if still active (not stopped)
      if (_unsubscribe) {
        setTimeout(() => {
          if (_unsubscribe) _unsubscribe();
          startScammerSync();
        }, 5_000);
      }
    },
  );
}

export function stopScammerSync(): void {
  if (_unsubscribe) { _unsubscribe(); _unsubscribe = null; }
  _scammerMap.clear();
}

export function isKnownScammer(phone: string): Scammer | null {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  return _scammerMap.get(normalized) || null;
}

export function getAllScammers(): Scammer[] {
  return Array.from(_scammerMap.values());
}

function normalizePhone(input: string): string {
  if (!input || typeof input !== 'string') return '';
  const cleaned = input.replace(/[^0-9+]/g, '');
  const digits = cleaned.replace(/^\+/, '');
  if (!/^\d{8,15}$/.test(digits)) return '';
  return '+' + digits;
}
