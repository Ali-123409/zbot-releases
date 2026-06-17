import { getSocket } from '../socket';
import {
  doc, getDoc, updateDoc, arrayUnion, setDoc, serverTimestamp,
} from 'firebase/firestore';
import { getDb, getDeviceId, getRtdb } from '../firebase/init';
import { FS_COLLECTIONS } from '../firebase/config';
import { ref, get } from 'firebase/database';
import type { CommandData } from '../firebase/command-listener';

interface ReportPayload {
  reason: 'fraud' | 'impersonation' | 'spam' | 'other';
  evidenceIds?: string[];
  blockScammer?: boolean;
  warnIfContacted?: boolean;
}

export async function executeReport(
  cmd: CommandData, deviceId: string,
): Promise<Record<string, unknown>> {
  const sock = getSocket();
  if (!sock) throw new Error('Bot socket not connected');
  if (!cmd.target) throw new Error('Report requires a target phone number');

  const targetPhone = cmd.target.replace(/[^0-9]/g, '');
  if (targetPhone.length < 10) throw new Error('Invalid target phone number');
  const scammerJid = targetPhone + '@s.whatsapp.net';

  // Per-device cap check
  const scammerDocRef = doc(getDb(), FS_COLLECTIONS.scammers, targetPhone);
  const scammerDoc = await getDoc(scammerDocRef);
  if (scammerDoc.exists()) {
    const data = scammerDoc.data();
    if (data.reportedBy?.includes(deviceId)) {
      console.log('[REPORT] already reported by this device, skipping');
      return { skipped: true, reason: 'already_reported', message: 'Already reported by this device' };
    }
  }

  const payload = cmd.payload as ReportPayload | undefined;
  let reportActioned = false;
  let blockActioned = false;
  let evidenceForwarded = false;

  // 1. WhatsApp in-app report
  try {
    if (typeof (sock as any).reportChat === 'function') {
      await (sock as any).reportChat(scammerJid, 'spam');
      reportActioned = true;
    }
  } catch (err) { /* continue */ }

  // 2. Block
  if (payload?.blockScammer !== false) {
    try {
      await sock.updateBlockStatus(scammerJid, 'block');
      blockActioned = true;
    } catch (err) { /* ignore */ }
  }

  // 3. Forward evidence to Saved Chats
  if (payload?.evidenceIds && payload.evidenceIds.length > 0) {
    try {
      const botJid = sock.user?.id;
      if (botJid) {
        const botNumber = botJid.split(':')[0].split('@')[0];
        const savedChatJid = botNumber + '@s.whatsapp.net';
        const caption = `🚨 *Scammer Report Record*\n\n📞 Scammer: +${targetPhone}\n📋 Reason: ${payload.reason}\n🤖 Reported by: +${botNumber}\n⏰ At: ${new Date().toISOString()}`;
        await sock.sendMessage(savedChatJid, { text: caption });
        for (const evId of payload.evidenceIds) {
          try {
            const evSnap = await get(ref(getRtdb(), `scammers/${targetPhone}/evidence/${evId}`));
            const ev = evSnap.val();
            if (ev?.dataBase64) {
              const buf = Buffer.from(ev.dataBase64, 'base64');
              const mime = ev.mimeType || 'image/jpeg';
              if (mime.startsWith('image/')) {
                await sock.sendMessage(savedChatJid, { image: buf, caption: ev.caption || '' });
              } else if (mime.startsWith('video/')) {
                await sock.sendMessage(savedChatJid, { video: buf, mimetype: mime, caption: ev.caption || '' });
              }
            }
          } catch (e) { /* skip */ }
        }
        evidenceForwarded = true;
      }
    } catch (err) { /* ignore */ }
  }

  // 4. Update scammers/{phone}
  try {
    if (scammerDoc.exists()) {
      await updateDoc(scammerDocRef, {
        totalReports: (scammerDoc.data().totalReports || 0) + 1,
        reportedBy: arrayUnion(deviceId),
        lastReportedAt: Date.now(),
        status: 'active',
      });
    } else {
      await setDoc(scammerDocRef, {
        phone: '+' + targetPhone,
        reason: payload?.reason || 'other',
        totalReports: 1,
        reportedBy: [deviceId],
        reportedAt: Date.now(),
        lastReportedAt: Date.now(),
        status: 'active',
        evidenceIds: payload?.evidenceIds || [],
        createdAt: serverTimestamp(),
      });
    }
  } catch (err) { /* don't fail whole command */ }

  return {
    reported: reportActioned, blocked: blockActioned, evidenceForwarded,
    scammerPhone: '+' + targetPhone, reason: payload?.reason || 'other',
  };
}
