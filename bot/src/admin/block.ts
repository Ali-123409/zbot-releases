import { getSocket } from '../socket';
import type { CommandData } from '../firebase/command-listener';

interface BlockPayload { jid: string; }

export async function executeBlock(
  cmd: CommandData, _deviceId: string,
): Promise<Record<string, unknown>> {
  const sock = getSocket();
  if (!sock) throw new Error('Bot socket not connected');
  const payload = cmd.payload as BlockPayload | undefined;
  let jid = payload?.jid;
  if (!jid && cmd.target) {
    const phone = cmd.target.replace(/[^0-9]/g, '');
    if (phone.length >= 10) jid = phone + '@s.whatsapp.net';
  }
  if (!jid) throw new Error('Block requires a target JID or phone number');
  await sock.updateBlockStatus(jid, 'block');
  return { blocked: true, jid, timestamp: Date.now() };
}
