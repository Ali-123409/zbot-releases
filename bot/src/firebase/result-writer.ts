/**
 * Zbot v2.1.6 — Result Writer
 *
 * v2.1.6 FIX (C1 from build audit): write to correct Firestore path
 *   commandResults/{cmdId}/devices/{deviceId}  (was {cmdId}/{deviceId} — 3 segments,
 *   which matched no rule and was silently denied)
 *
 * v2.1.6 NEW: updateCommandStatus — bot now updates commands/{cmdId}.status + progress
 *   so admin panel can see real-time status (was always "pending" forever — C3 from android audit)
 */

import { doc, setDoc, updateDoc, increment } from 'firebase/firestore';
import { ref, update } from 'firebase/database';
import { getDb, getRtdb } from './init';
import { FS_COLLECTIONS, RTDB_PATHS } from './config';

export interface CommandResult {
  status: 'pending' | 'executing' | 'success' | 'failed' | 'skipped';
  startedAt?: string;
  executedAt?: string;
  error?: string;
  response?: Record<string, unknown>;
}

export async function writeCommandResult(
  cmdId: string, deviceId: string, result: CommandResult,
): Promise<void> {
  // v2.1.6 FIX (C1): correct path is commandResults/{cmdId}/devices/{deviceId} (4 segments)
  const resultDoc = doc(getDb(), FS_COLLECTIONS.commandResults, cmdId, 'devices', deviceId);
  await setDoc(resultDoc, { deviceId, ...result }, { merge: true });
}

export async function updateRtdbProgress(
  cmdId: string, deviceId: string, data: Record<string, unknown>,
): Promise<void> {
  const progressRef = ref(getRtdb(), RTDB_PATHS.commandProgressDevice(cmdId, deviceId));
  await update(progressRef, { ...data, updatedAt: Date.now() });
}

/**
 * v2.1.6 NEW: update the top-level commands/{cmdId}.status + progress fields.
 * Firestore rules now allow the bot to update only `status` and `progress` keys.
 * Called by command-listener after each device completes/fails.
 */
export async function updateCommandStatus(
  cmdId: string,
  success: boolean,
  skipped: boolean = false,
): Promise<void> {
  try {
    const cmdRef = doc(getDb(), FS_COLLECTIONS.commands, cmdId);
    const statusField = skipped ? 'skipped' : (success ? 'completed' : 'failed');
    const progressUpdate: Record<string, any> = {
      status: statusField,
    };
    // Increment progress counters atomically
    if (success) {
      progressUpdate['progress.completed'] = increment(1);
    } else if (skipped) {
      // skipped counts as neither success nor failure for progress visibility
    } else {
      progressUpdate['progress.failed'] = increment(1);
    }
    await updateDoc(cmdRef, progressUpdate);
  } catch (err) {
    console.warn('[RESULT] updateCommandStatus failed:', (err as Error).message);
  }
}
