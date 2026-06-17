import axios from 'axios';
import type { CommandModule } from './_registry';

interface FbResponse {
  url?: string; hd?: string; sd?: string;
  title?: string; thumbnail?: string; error?: string;
  links?: Array<{ label: string; url: string }>;
}

export const facebook: CommandModule = {
  command: 'facebook',
  aliases: ['fb', 'fbdl'],
  description: 'Download Facebook video',
  category: 'downloader',
  handler: async (ctx) => {
    const { sock, msg, chatJid, args } = ctx;
    const url = args[0];
    if (!url || !url.match(/facebook\.com|fb\.watch|fb\.com/i)) {
      await sock.sendMessage(chatJid, {
        text: '⚠️ Usage: .fb <url>\nExample: .fb https://www.facebook.com/watch?v=xxxxx',
      }, { quoted: msg });
      return;
    }
    await sock.sendMessage(chatJid, { react: { text: '⏳', key: msg.key } });
    try {
      const res = await axios.post<FbResponse>(
        'https://fdown.isuru.eu.org/download',
        { url },
        { timeout: 30_000, headers: { 'User-Agent': 'Zbot/1.0' } },
      );
      const data = res.data;
      const videoUrl = data.hd || data.sd || data.url || data.links?.[0]?.url;
      if (!videoUrl) {
        await sock.sendMessage(chatJid, {
          text: '❌ Failed to fetch: ' + (data.error || 'No video found'),
        }, { quoted: msg });
        return;
      }
      const videoRes = await axios.get(videoUrl, { responseType: 'arraybuffer', timeout: 60_000 });
      const caption = `📹 *Facebook Video*\n${data.title ? `\n_${data.title}_` : ''}`;
      await sock.sendMessage(chatJid, {
        video: Buffer.from(videoRes.data), caption, mimetype: 'video/mp4',
      }, { quoted: msg });
      await sock.sendMessage(chatJid, { react: { text: '✅', key: msg.key } });
    } catch (err) {
      await sock.sendMessage(chatJid, {
        text: '❌ FB download failed: ' + (err as Error).message,
      }, { quoted: msg });
      await sock.sendMessage(chatJid, { react: { text: '❌', key: msg.key } });
    }
  },
};
