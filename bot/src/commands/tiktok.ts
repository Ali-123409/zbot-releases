import axios from 'axios';
import type { CommandModule } from './_registry';

interface TikTokResponse {
  code: number;
  data: {
    title?: string;
    author?: { nickname?: string; unique_id?: string };
    duration?: number;
    play?: string;
    wmplay?: string;
    music?: string;
    cover?: string;
  };
  msg?: string;
}

export const tiktok: CommandModule = {
  command: 'tiktok',
  aliases: ['tt', 'ttdl'],
  description: 'Download TikTok video (no watermark)',
  category: 'downloader',
  handler: async (ctx) => {
    const { sock, msg, chatJid, args } = ctx;
    const url = args[0];
    if (!url || !url.match(/tiktok\.com|vt\.tiktok/i)) {
      await sock.sendMessage(chatJid, {
        text: '⚠️ Usage: .tiktok <url>\nExample: .tiktok https://vt.tiktok.com/xxxxx',
      }, { quoted: msg });
      return;
    }
    await sock.sendMessage(chatJid, { react: { text: '⏳', key: msg.key } });
    try {
      const res = await axios.get<TikTokResponse>('https://tikwm.com/api/', {
        params: { url }, timeout: 30_000,
      });
      if (res.data.code !== 0 || !res.data.data?.play) {
        await sock.sendMessage(chatJid, {
          text: '❌ Failed to fetch: ' + (res.data.msg || 'Unknown error'),
        }, { quoted: msg });
        return;
      }
      const data = res.data.data;
      const caption = `📹 *TikTok Video*\n\n` +
        (data.title ? `_${data.title}_\n\n` : '') +
        (data.author?.nickname ? `👤 ${data.author.nickname}` : '') +
        (data.author?.unique_id ? ` (@${data.author.unique_id})` : '') +
        (data.duration ? `\n⏱️ ${Math.floor(data.duration / 60)}:${String(data.duration % 60).padStart(2, '0')}` : '');
      const videoRes = await axios.get(data.play as string, {
        responseType: 'arraybuffer', timeout: 60_000,
      });
      const buffer = Buffer.from(videoRes.data);
      await sock.sendMessage(chatJid, {
        video: buffer, caption, mimetype: 'video/mp4',
      }, { quoted: msg });
      await sock.sendMessage(chatJid, { react: { text: '✅', key: msg.key } });
    } catch (err) {
      await sock.sendMessage(chatJid, {
        text: '❌ TikTok download failed: ' + (err as Error).message,
      }, { quoted: msg });
      await sock.sendMessage(chatJid, { react: { text: '❌', key: msg.key } });
    }
  },
};
