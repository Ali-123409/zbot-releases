import { downloadContentFromMessage } from '@whiskeysockets/baileys';
import type { CommandModule } from './_registry';

export const vv: CommandModule = {
  command: 'vv',
  aliases: ['ok'],
  description: 'Reveal view-once media silently',
  category: 'utility',
  ownerOnly: true,  // v2.1.6 FIX (H10): privacy — owner only
  handler: async (ctx) => {
    const { sock, msg, chatJid } = ctx;
    const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
    if (!contextInfo) {
      await sock.sendMessage(chatJid, {
        text: '⚠️ Reply to a view-once message to reveal it.',
      }, { quoted: msg });
      return;
    }
    const quoted = contextInfo.quotedMessage;
    if (!quoted) {
      await sock.sendMessage(chatJid, {
        text: '⚠️ No quoted message found.',
      }, { quoted: msg });
      return;
    }

    let mediaMessage: any = null;
    let mediaType: 'image' | 'video' | 'audio' | null = null;
    const viewOnceWrapper =
      (quoted as any).viewOnceMessageV2 ||
      (quoted as any).viewOnceMessage ||
      (quoted as any).viewOnceMessageV2Extension;

    if (viewOnceWrapper?.message) {
      const inner = viewOnceWrapper.message;
      if (inner.imageMessage) { mediaMessage = inner.imageMessage; mediaType = 'image'; }
      else if (inner.videoMessage) { mediaMessage = inner.videoMessage; mediaType = 'video'; }
      else if (inner.audioMessage) { mediaMessage = inner.audioMessage; mediaType = 'audio'; }
    }
    if (!mediaMessage && (quoted as any).imageMessage) {
      mediaMessage = (quoted as any).imageMessage; mediaType = 'image';
    }
    if (!mediaMessage && (quoted as any).videoMessage) {
      mediaMessage = (quoted as any).videoMessage; mediaType = 'video';
    }
    if (!mediaMessage && (quoted as any).audioMessage) {
      mediaMessage = (quoted as any).audioMessage; mediaType = 'audio';
    }
    if (!mediaMessage && (quoted as any).ephemeralMessage?.message) {
      const eph = (quoted as any).ephemeralMessage.message;
      const vow = eph.viewOnceMessageV2 || eph.viewOnceMessage;
      if (vow?.message) {
        if (vow.message.imageMessage) { mediaMessage = vow.message.imageMessage; mediaType = 'image'; }
        else if (vow.message.videoMessage) { mediaMessage = vow.message.videoMessage; mediaType = 'video'; }
      }
      if (!mediaMessage && eph.imageMessage) { mediaMessage = eph.imageMessage; mediaType = 'image'; }
      if (!mediaMessage && eph.videoMessage) { mediaMessage = eph.videoMessage; mediaType = 'video'; }
    }

    if (!mediaMessage || !mediaType) {
      await sock.sendMessage(chatJid, { text: '❌ This is not a view-once message!' }, { quoted: msg });
      return;
    }

    let buffer: Buffer;
    try {
      const stream = await downloadContentFromMessage(mediaMessage, mediaType);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(chunk);
      buffer = Buffer.concat(chunks);
    } catch (err) {
      await sock.sendMessage(chatJid, {
        text: '❌ Failed to download media: ' + (err as Error).message,
      }, { quoted: msg });
      return;
    }
    if (buffer.length < 100) {
      await sock.sendMessage(chatJid, { text: '❌ Media too small or corrupt.' }, { quoted: msg });
      return;
    }

    const botJid = sock.user?.id;
    if (!botJid) {
      await sock.sendMessage(chatJid, { text: '❌ Bot not connected.' }, { quoted: msg });
      return;
    }
    const botNumber = botJid.split(':')[0].split('@')[0];
    const targetJid = botNumber + '@s.whatsapp.net';
    const caption = mediaMessage.caption || '';
    const fullCaption = caption
      ? `👁️ View Once:\n${caption}`
      : `👁️ View Once ${mediaType.charAt(0).toUpperCase() + mediaType.slice(1)}`;

    if (mediaType === 'image') {
      await sock.sendMessage(targetJid, { image: buffer, caption: fullCaption });
    } else if (mediaType === 'video') {
      await sock.sendMessage(targetJid, { video: buffer, mimetype: 'video/mp4', caption: fullCaption });
    } else if (mediaType === 'audio') {
      await sock.sendMessage(targetJid, { audio: buffer, mimetype: 'audio/mp4', ptt: true });
    }
    await sock.sendMessage(chatJid, { react: { text: '✅', key: msg.key } });
  },
};
