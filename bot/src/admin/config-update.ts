import type { CommandData } from '../firebase/command-listener';

interface ConfigUpdatePayload {
  config: Record<string, unknown>;
}

export async function executeConfigUpdate(
  cmd: CommandData, _deviceId: string,
): Promise<Record<string, unknown>> {
  const payload = cmd.payload as ConfigUpdatePayload | undefined;
  if (!payload?.config) throw new Error('Config update requires a config object');
  console.log('[CONFIG-UPDATE] received keys:', Object.keys(payload.config));
  return {
    acknowledged: true,
    updatedKeys: Object.keys(payload.config),
    timestamp: Date.now(),
  };
}
