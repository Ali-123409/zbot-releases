/**
 * Zbot — Result Writer
 */

import { doc, setDoc } from 'firebase/firestore';
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
  const resultDoc = doc(getDb(), FS_COLLECTIONS.commandResults, cmdId, 'devices', deviceId);
  await setDoc(resultDoc, { deviceId, ...result }, { merge: true });
}

export async function updateRtdbProgress(
  cmdId: string, deviceId: string, data: Record<string, unknown>,
): Promise<void> {
  const progressRef = ref(getRtdb(), RTDB_PATHS.commandProgressDevice(cmdId, deviceId));
  await update(progressRef, { ...data, updatedAt: Date.now() });
}
