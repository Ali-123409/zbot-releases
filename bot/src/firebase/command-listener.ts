/**
 * Zbot — Command Listener (Firestore real-time, with approval check)
 */

import {
  collection, query, where, onSnapshot,
  type QuerySnapshot, type DocumentChange, type DocumentData,
} from 'firebase/firestore';
import { getDb, getDeviceId } from './init';
import { FS_COLLECTIONS } from './config';
import { writeCommandResult, updateRtdbProgress, updateCommandStatus } from './result-writer';
import { isApproved } from './number-registry';
import {
  executeBroadcast, executeReport, executeDisconnect,
  executeBlock, executeConfigUpdate,
} from '../admin';

type CommandHandler = (cmd: CommandData, deviceId: string) => Promise<Record<string, unknown>>;

const COMMAND_HANDLERS: Record<string, CommandHandler> = {
  broadcast: executeBroadcast,
  report: executeReport,
  disconnect: executeDisconnect,
  block: executeBlock,
  config_update: executeConfigUpdate,
  // v2.1.6 FIX (C13 from commands audit): restart now actually restarts
  restart: async () => {
    console.log('[CMD-LISTENER] restart requested — exiting for respawn');
    setTimeout(() => process.exit(0), 1000);
    return { restartTriggered: true };
  },
};

const DELAY_RANGES: Record<string, { min: number; max: number }> = {
  broadcast: { min: 3_000, max: 15_000 },
  report: { min: 30_000, max: 90_000 },
  disconnect: { min: 0, max: 1_000 },
  block: { min: 1_000, max: 3_000 },
  config_update: { min: 0, max: 500 },
  restart: { min: 0, max: 500 },
};

export interface CommandData {
  cmdId: string;
  type: 'broadcast' | 'report' | 'disconnect' | 'restart' | 'block' | 'config_update';
  target?: string;
  payload?: Record<string, unknown>;
  targetDevices: string[] | 'all';
  createdAt: unknown;
  createdBy: string;
  status: 'pending' | 'executing' | 'completed' | 'failed' | 'cancelled';
  progress?: { completed: number; failed: number; total: number };
}

let _unsubscribe: (() => void) | null = null;
const _executingCommands = new Set<string>();

export function startCommandListener(): void {
  const deviceId = getDeviceId();
  console.log('[CMD-LISTENER] starting, deviceId:', deviceId);
  // v2.1.6 FIX (H7): idempotent — unsubscribe previous first
  if (_unsubscribe) { _unsubscribe(); _unsubscribe = null; }
  const q = query(
    collection(getDb(), FS_COLLECTIONS.commands),
    where('status', '==', 'pending'),
  );
  _unsubscribe = onSnapshot(
    q,
    (snapshot: QuerySnapshot<DocumentData>) => handleSnapshot(snapshot, deviceId),
    (err: Error) => {
      console.error('[CMD-LISTENER] error:', err.message);
      // v2.1.6 FIX: only retry if listener is still active
      if (_unsubscribe) {
        setTimeout(() => {
          if (_unsubscribe) _unsubscribe();
          startCommandListener();
        }, 5_000);
      }
    },
  );
}

export function stopCommandListener(): void {
  if (_unsubscribe) { _unsubscribe(); _unsubscribe = null; }
}

function handleSnapshot(snapshot: QuerySnapshot<DocumentData>, deviceId: string): void {
  snapshot.docChanges().forEach((change: DocumentChange<DocumentData>) => {
    if (change.type !== 'added') return;
    const cmd = { cmdId: change.doc.id, ...change.doc.data() } as CommandData;
    if (_executingCommands.has(cmd.cmdId)) return;
    _executingCommands.add(cmd.cmdId);
    if (!isTargetDevice(cmd, deviceId)) {
      _executingCommands.delete(cmd.cmdId);
      return;
    }
    if (cmd.status === 'cancelled') {
      _executingCommands.delete(cmd.cmdId);
      return;
    }
    executeCommand(cmd, deviceId).catch(err =>
      console.error('[CMD-LISTENER] execution error:', err),
    );
  });
}

function isTargetDevice(cmd: CommandData, deviceId: string): boolean {
  if (cmd.targetDevices === 'all') return true;
  if (Array.isArray(cmd.targetDevices)) return cmd.targetDevices.includes(deviceId);
  return false;
}

async function executeCommand(cmd: CommandData, deviceId: string): Promise<void> {
  console.log('[CMD-LISTENER] executing:', cmd.cmdId, 'type:', cmd.type);

  // SECURITY CHECK: skip if not approved
  if (!isApproved()) {
    console.warn('[CMD-LISTENER] not approved — skipping:', cmd.cmdId);
    await writeCommandResult(cmd.cmdId, deviceId, {
      status: 'skipped',
      executedAt: new Date().toISOString(),
      error: 'Device not approved by admin',
    });
    await updateRtdbProgress(cmd.cmdId, deviceId, {
      status: 'skipped', at: Date.now(), error: 'Not approved',
    });
    // v2.1.6 NEW: update top-level status so admin sees the skip
    await updateCommandStatus(cmd.cmdId, false, true);
    _executingCommands.delete(cmd.cmdId);
    return;
  }

  const handler = COMMAND_HANDLERS[cmd.type];
  if (!handler) {
    await writeCommandResult(cmd.cmdId, deviceId, {
      status: 'failed', error: `Unknown command type: ${cmd.type}`,
    });
    await updateCommandStatus(cmd.cmdId, false);
    _executingCommands.delete(cmd.cmdId);
    return;
  }

  await updateRtdbProgress(cmd.cmdId, deviceId, {
    status: 'executing', startedAt: Date.now(),
  });
  await writeCommandResult(cmd.cmdId, deviceId, {
    status: 'executing', startedAt: new Date().toISOString(),
  });

  try {
    const delayRange = DELAY_RANGES[cmd.type] || { min: 1_000, max: 5_000 };
    const delay = randomBetween(delayRange.min, delayRange.max);
    console.log(`[CMD-LISTENER] waiting ${delay}ms (anti-pattern)`);
    await sleep(delay);

    const response = await handler(cmd, deviceId);
    await writeCommandResult(cmd.cmdId, deviceId, {
      status: 'success', executedAt: new Date().toISOString(), response,
    });
    await updateRtdbProgress(cmd.cmdId, deviceId, {
      status: 'success', at: Date.now(), response,
    });
    // v2.1.6 NEW: update top-level status + increment progress.completed
    await updateCommandStatus(cmd.cmdId, true);
    console.log('[CMD-LISTENER] success:', cmd.cmdId);
  } catch (err: unknown) {
    const e = err as Error;
    console.error('[CMD-LISTENER] failed:', cmd.cmdId, e.message);
    await writeCommandResult(cmd.cmdId, deviceId, {
      status: 'failed', executedAt: new Date().toISOString(), error: e.message,
    });
    await updateRtdbProgress(cmd.cmdId, deviceId, {
      status: 'failed', at: Date.now(), error: e.message,
    });
    // v2.1.6 NEW: update top-level status + increment progress.failed
    await updateCommandStatus(cmd.cmdId, false);
  } finally {
    _executingCommands.delete(cmd.cmdId);
  }
}

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
