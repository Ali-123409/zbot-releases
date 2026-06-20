/**
 * Zbot v2.1.6 — Report Scammer command
 *
 * Fixes:
 * - Removed sock.reportChat (doesn't exist in Baileys — was silently skipped — C9)
 * - Use increment(1) for totalReports (was TOCTOU race — C10)
 * - Track forwardedCount (evidenceForwarded was always true even if all failed — C11)
 * - Validate reason enum (L7)
 * - Use RTDB_PATHS for evidence path (was hardcoded — H7/M9)
 */

import { getSocket } from '../socket';
import {
  doc, getDoc, updateDoc, arrayUnion, setDoc, serverTimestamp, increment,
} from 'firebase/firestore';
import { getDb, getDeviceId, getRtdb } from '../firebase/init';
import { FS_COLLECTIONS, RTDB_PATHS } from '../firebase/config';
import { ref, get } from 'firebase/database';
import type { CommandData } from '../firebase/command-listener';

type Reason = 'fraud' | 'impersonation' | 'spam' | 'other';
const VALID_REASONS: Reason[] = ['fraud', 'impersonation', 'spam', 'other'];

interface ReportPayload {
  reason?: Reason;
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

  const payload = cmd.payload as ReportPayload | undefined;
  // v2.1.6 FIX (L7): validate reason enum
  const reason: Reason = payload?.reason && VALID_REASONS.includes(payload.reason)
    ? payload.reason
    : 'other';

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

  let blockActioned = false;
  let evidenceForwardedCount = 0;

  // v2.1.6 FIX (C9): removed sock.reportChat — doesn't exist in Baileys

  // 1. Block the scammer (default true unless explicitly disabled)
  if (payload?.blockScammer !== false) {
    try {
      await sock.updateBlockStatus(scammerJid, 'block');
      blockActioned = true;
    } catch (err) {
      console.warn('[REPORT] block failed:', (err as Error).message);
    }
  }

  // 2. Forward evidence to Saved Chats
  if (payload?.evidenceIds && payload.evidenceIds.length > 0) {
    try {
      const botJid = sock.user?.id;
      if (botJid) {
        const botNumber = botJid.split(':')[0].split('@')[0];
        const savedChatJid = botNumber + '@s.whatsapp.net';
        const caption = `🚨 *Scammer Report Record*\n\n📞 Scammer: +${targetPhone}\n📋 Reason: ${reason}\n🤖 Reported by: +${botNumber}\n⏰ At: ${new Date().toISOString()}`;
        await sock.sendMessage(savedChatJid, { text: caption });

        for (const evId of payload.evidenceIds) {
          try {
            // v2.1.6 FIX (H7/M9): use RTDB_PATHS helper (was hardcoded)
            const evSnap = await get(ref(getRtdb(), RTDB_PATHS.scammerEvidence(targetPhone, evId)));
            const ev = evSnap.val();
            if (ev?.dataBase64) {
              const buf = Buffer.from(ev.dataBase64, 'base64');
              const mime = ev.mimeType || 'image/jpeg';
              if (mime.startsWith('image/')) {
                await sock.sendMessage(savedChatJid, { image: buf, caption: ev.caption || '' });
              } else if (mime.startsWith('video/')) {
                await sock.sendMessage(savedChatJid, { video: buf, mimetype: mime, caption: ev.caption || '' });
              }
              evidenceForwardedCount++;
            }
          } catch (e) {
            console.warn('[REPORT] evidence forward failed for', evId, ':', (e as Error).message);
          }
        }
      }
    } catch (err) {
      console.warn('[REPORT] evidence forward outer failed:', (err as Error).message);
    }
  }

  // 3. Update scammers/{phone}
  try {
    if (scammerDoc.exists()) {
      // v2.1.6 FIX (C10): use increment(1) for atomic counter (was TOCTOU race)
      await updateDoc(scammerDocRef, {
        totalReports: increment(1),
        reportedBy: arrayUnion(deviceId),
        lastReportedAt: Date.now(),
        status: 'active',
        reason,
      });
    } else {
      await setDoc(scammerDocRef, {
        phone: '+' + targetPhone,
        reason,
        totalReports: 1,
        reportedBy: [deviceId],
        reportedAt: Date.now(),
        lastReportedAt: Date.now(),
        status: 'active',
        evidenceIds: payload?.evidenceIds || [],
        createdAt: serverTimestamp(),
      });
    }
  } catch (err) {
    console.warn('[REPORT] scammer doc update failed:', (err as Error).message);
  }

  return {
    reported: true,
    blocked: blockActioned,
    evidenceForwarded: evidenceForwardedCount > 0,
    evidenceForwardedCount,
    scammerPhone: '+' + targetPhone,
    reason,
  };
}
