/**
 * Zbot v2.1.6 — Config Update command
 *
 * v2.1.6 FIX (C12 from commands audit / C3 from build audit):
 *   Previously a no-op stub. Now actually applies the config + persists to Firestore.
 */

import type { CommandData } from '../firebase/command-listener';
import { updateConfig, persistConfig } from '../firebase/config-runtime';

interface ConfigUpdatePayload {
  config: Record<string, unknown>;
}

export async function executeConfigUpdate(
  cmd: CommandData, _deviceId: string,
): Promise<Record<string, unknown>> {
  const payload = cmd.payload as ConfigUpdatePayload | undefined;
  if (!payload?.config) throw new Error('Config update requires a config object');

  console.log('[CONFIG-UPDATE] applying keys:', Object.keys(payload.config));

  // v2.1.6: actually apply + persist (was a no-op)
  updateConfig(payload.config);
  await persistConfig();

  return {
    acknowledged: true,
    updatedKeys: Object.keys(payload.config),
    timestamp: Date.now(),
  };
}
