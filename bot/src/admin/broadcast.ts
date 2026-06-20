/**
 * Zbot v2.1.6 — Broadcast command
 *
 * Fixes:
 * - text + attachment: text is now used as caption fallback (was silently dropped — C7)
 * - fileName vs caption separated (was conflated — C8)
 * - audio PTT is opt-in (was hardcoded true — M6)
 */

import type { CommandData } from '../firebase/command-listener';
import { getSocket } from '../socket';

interface BroadcastPayload {
  message: string;
  attachmentBase64?: string;
  attachmentMime?: string;
  attachmentCaption?: string;
  attachmentFileName?: string;
  attachmentIsPtt?: boolean;
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

  if (payload.attachmentBase64) {
    const buffer = Buffer.from(payload.attachmentBase64, 'base64');
    const mime = payload.attachmentMime || 'application/octet-stream';
    // v2.1.6 FIX (C7): use message as caption fallback when no explicit caption
    const caption = payload.attachmentCaption || payload.message || '';

    if (mime.startsWith('image/')) {
      msg.image = buffer;
      if (caption) msg.caption = caption;
    } else if (mime.startsWith('video/')) {
      msg.video = buffer;
      msg.mimetype = mime;
      if (caption) msg.caption = caption;
    } else if (mime.startsWith('audio/')) {
      msg.audio = buffer;
      msg.mimetype = mime;
      // v2.1.6 FIX (M6): PTT opt-in (was hardcoded true)
      msg.ptt = payload.attachmentIsPtt === true;
    } else {
      msg.document = buffer;
      msg.mimetype = mime;
      // v2.1.6 FIX (C8): fileName is separate from caption
      msg.fileName = payload.attachmentFileName || 'file';
      if (caption) msg.caption = caption;
    }
  } else {
    // No attachment — just text
    msg.text = payload.message;
  }

  const sent = await sock.sendMessage(targetJid, msg as any);
  return {
    messageId: sent?.key?.id, chatJid: targetJid, sentAt: Date.now(),
  };
}
