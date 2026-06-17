import { downloadMediaMessage } from '@whiskeysockets/baileys';
import type { CommandModule } from './_registry';

export const sticker: CommandModule = {
  command: 'sticker',
  aliases: ['s', 'stiker'],
  description: 'Convert image/video to sticker',
  category: 'media',
  handler: async (ctx) => {
    const { sock, msg, chatJid } = ctx;
    let mediaMsg: any = msg;
    const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
    const quoted = contextInfo?.quotedMessage;
    if (quoted && contextInfo?.stanzaId) {
      mediaMsg = { key: { remoteJid: chatJid, id: contextInfo.stanzaId }, message: quoted };
    }
    const m = mediaMsg.message || {};
    let mediaType: 'image' | 'video' | null = null;
    if (m.imageMessage || m.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage) {
      mediaType = 'image';
    } else if (m.videoMessage || m.extendedTextMessage?.contextInfo?.quotedMessage?.videoMessage) {
      mediaType = 'video';
    }
    if (!mediaType) {
      await sock.sendMessage(chatJid, {
        text: '⚠️ Reply to an image or short video to make a sticker.',
      }, { quoted: msg });
      return;
    }
    try {
      const buffer = await downloadMediaMessage(mediaMsg, 'buffer', {}) as Buffer;
      if (!buffer || buffer.length < 100) {
        await sock.sendMessage(chatJid, { text: '❌ Could not download media.' }, { quoted: msg });
        return;
      }
      const packName = process.env.BOT_NAME || 'Zbot';
      const author = process.env.BOT_OWNER || 'Admin';
      await sock.sendMessage(chatJid, {
        sticker: buffer, packname: packName, author,
      } as any, { quoted: msg });
    } catch (err) {
      await sock.sendMessage(chatJid, {
        text: '❌ Sticker creation failed: ' + (err as Error).message,
      }, { quoted: msg });
    }
  },
};
