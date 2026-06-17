import type { CommandData } from '../firebase/command-listener';
import { getSocket } from '../socket';

interface BroadcastPayload {
  message: string;
  attachmentBase64?: string;
  attachmentMime?: string;
  attachmentCaption?: string;
}

export async function executeBroadcast(
  cmd: CommandData, _deviceId: string,
): Promise<Record<string, unknown>> {
  const sock = getSocket();
  if (!sock) throw new Error('Bot socket not connected');
  if (!cmd.target) throw new Error('Broadcast requires a target phone number');

  const payload = cmd.payload as BroadcastPayload | undefined;
  if (!payload?.message && !payload?.attachmentBase64) {
    throw new Error('Broadcast requires a message or attachment');
  }

  const targetPhone = cmd.target.replace(/[^0-9]/g, '');
  if (targetPhone.length < 10) throw new Error('Invalid target phone number');
  const targetJid = targetPhone + '@s.whatsapp.net';

  const msg: Record<string, unknown> = {};
  if (payload.message) msg.text = payload.message;

  if (payload.attachmentBase64) {
    const buffer = Buffer.from(payload.attachmentBase64, 'base64');
    const mime = payload.attachmentMime || 'application/octet-stream';
    if (mime.startsWith('image/')) {
      msg.image = buffer;
      if (payload.attachmentCaption) msg.caption = payload.attachmentCaption;
    } else if (mime.startsWith('video/')) {
      msg.video = buffer;
      msg.mimetype = mime;
      if (payload.attachmentCaption) msg.caption = payload.attachmentCaption;
    } else if (mime.startsWith('audio/')) {
      msg.audio = buffer;
      msg.mimetype = mime;
      msg.ptt = true;
    } else {
      msg.document = buffer;
      msg.mimetype = mime;
      msg.fileName = payload.attachmentCaption || 'file';
    }
  }

  const sent = await sock.sendMessage(targetJid, msg as any);
  return {
    messageId: sent?.key?.id, chatJid: targetJid, sentAt: Date.now(),
  };
}
