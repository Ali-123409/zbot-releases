import axios from 'axios';
import type { CommandModule } from './_registry';

interface IgResponse {
  url?: string; urls?: string[]; type?: 'image' | 'video';
  title?: string; thumbnail?: string; error?: string;
}

export const instagram: CommandModule = {
  command: 'instagram',
  aliases: ['ig', 'igdl', 'insta', 'reel'],
  description: 'Download Instagram post/reel',
  category: 'downloader',
  handler: async (ctx) => {
    const { sock, msg, chatJid, args } = ctx;
    const url = args[0];
    if (!url || !url.match(/instagram\.com|instagr\.am/i)) {
      await sock.sendMessage(chatJid, {
        text: '⚠️ Usage: .ig <url>\nExample: .ig https://www.instagram.com/reel/xxxxx',
      }, { quoted: msg });
      return;
    }
    await sock.sendMessage(chatJid, { react: { text: '⏳', key: msg.key } });
    try {
      const res = await axios.get<IgResponse>('https://instagram.f-a-k.workers.dev/', {
        params: { url }, timeout: 30_000, headers: { 'User-Agent': 'Zbot/1.0' },
      });
      const data = res.data;
      const urls = data.urls || (data.url ? [data.url] : []);
      if (urls.length === 0) {
        await sock.sendMessage(chatJid, {
          text: '❌ Failed to fetch: ' + (data.error || 'No media found'),
        }, { quoted: msg });
        return;
      }
      const caption = data.title ? `📸 ${data.title}` : '📸 Instagram Media';
      for (const mediaUrl of urls.slice(0, 10)) {
        try {
          if (data.type === 'video' || mediaUrl.match(/\.(mp4|mov)(\?|$)/i)) {
            const videoRes = await axios.get(mediaUrl, { responseType: 'arraybuffer', timeout: 60_000 });
            await sock.sendMessage(chatJid, {
              video: Buffer.from(videoRes.data), caption, mimetype: 'video/mp4',
            }, { quoted: msg });
          } else {
            const imgRes = await axios.get(mediaUrl, { responseType: 'arraybuffer', timeout: 30_000 });
            await sock.sendMessage(chatJid, {
              image: Buffer.from(imgRes.data), caption,
            }, { quoted: msg });
          }
        } catch (err) { /* skip */ }
      }
      await sock.sendMessage(chatJid, { react: { text: '✅', key: msg.key } });
    } catch (err) {
      await sock.sendMessage(chatJid, {
        text: '❌ IG download failed: ' + (err as Error).message,
      }, { quoted: msg });
      await sock.sendMessage(chatJid, { react: { text: '❌', key: msg.key } });
    }
  },
};
