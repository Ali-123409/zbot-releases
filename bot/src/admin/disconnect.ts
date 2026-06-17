import { disconnectSession } from '../socket';
import type { CommandData } from '../firebase/command-listener';

export async function executeDisconnect(
  _cmd: CommandData, _deviceId: string,
): Promise<Record<string, unknown>> {
  await disconnectSession();
  return { disconnected: true, timestamp: Date.now() };
}
