import axios from 'axios';
import type { CommandModule } from './_registry';

interface YtSearchResult {
  title: string; url: string; duration: string;
  author: string; thumbnail: string;
}

/**
 * Search YouTube using the InnerTube API (no cheerio needed).
 * Uses the same API key as the download function.
 */
async function searchYouTube(query: string, limit = 5): Promise<YtSearchResult[]> {
  const API_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
  const INNERTUBE_URL = `https://www.youtube.com/youtubei/v1/search?key=${API_KEY}`;

  const payload = {
    context: {
      client: {
        clientName: 'WEB',
        clientVersion: '2.20240101.00.00',
      },
    },
    query,
  };

  const res = await axios.post(INNERTUBE_URL, payload, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 15_000,
  });

  const results: YtSearchResult[] = [];
  const contents = res.data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents || [];

  for (const item of contents) {
    if (results.length >= limit) break;
    const video = item.videoRenderer;
    if (!video?.videoId) continue;

    results.push({
      title: video.title?.runs?.[0]?.text || 'Unknown',
      url: `https://www.youtube.com/watch?v=${video.videoId}`,
      duration: video.lengthText?.simpleText || 'N/A',
      author: video.ownerText?.runs?.[0]?.text || 'Unknown',
      thumbnail: video.thumbnail?.thumbnails?.[0]?.url || '',
    });
  }

  return results;
}

async function downloadYt(url: string, type: 'audio' | 'video'): Promise<Buffer> {
  const endpoints = type === 'audio'
    ? [
        `https://api.yupra.my.id/api/downloader/ytmp3?url=${encodeURIComponent(url)}`,
        `https://okatsu-rolezapiiz.vercel.app/downloader/ytmp3?url=${encodeURIComponent(url)}`,
      ]
    : [`https://eliteprotech-apis.zone.id/ytdown?url=${encodeURIComponent(url)}&type=video`];
  let lastError: Error | null = null;
  for (const endpoint of endpoints) {
    try {
      const res = await axios.get(endpoint, { timeout: 30_000 });
      const data = res.data;
      let mediaUrl: string | undefined;
      if (typeof data === 'object') {
        mediaUrl = data.result?.url || data.download || data.url || data.data?.url ||
                   (Array.isArray(data.links) ? data.links[0]?.url : undefined);
      }
      if (!mediaUrl) { lastError = new Error('No media URL'); continue; }
      const mediaRes = await axios.get(mediaUrl, {
        responseType: 'arraybuffer', timeout: 120_000, maxContentLength: 80 * 1024 * 1024,
      });
      return Buffer.from(mediaRes.data);
    } catch (err) { lastError = err as Error; }
  }
  throw lastError || new Error('All download endpoints failed');
}

export const youtube: CommandModule = {
  command: 'youtube',
  aliases: ['yt', 'ytdl', 'ytmp4', 'ytmp3', 'play', 'song', 'yts'],
  description: 'Download YouTube video/audio or search',
  category: 'downloader',
  handler: async (ctx) => {
    const { sock, msg, chatJid, args } = ctx;
    const cmd = (msg.message?.extendedTextMessage?.text || '').split(/\s+/)[0]?.toLowerCase().slice(1);
    if (!args[0]) {
      await sock.sendMessage(chatJid, {
        text: '⚠️ Usage:\n• .yt <url> — download video\n• .ytmp3 <url> — download audio\n• .play <song name> — search and play audio\n• .yts <query> — search YouTube',
      }, { quoted: msg });
      return;
    }
    await sock.sendMessage(chatJid, { react: { text: '⏳', key: msg.key } });
    try {
      if (cmd === 'play' || cmd === 'song' || cmd === 'yts') {
        const query = args.join(' ');
        const results = await searchYouTube(query, 5);
        if (results.length === 0) {
          await sock.sendMessage(chatJid, {
            text: '❌ No results found for: ' + query,
          }, { quoted: msg });
          return;
        }
        if (cmd === 'yts') {
          let text = `🔎 *YouTube Search: ${query}*\n\n`;
          results.forEach((r, i) => {
            text += `${i + 1}. ${r.title}\n   👤 ${r.author} | ⏱️ ${r.duration}\n   🔗 ${r.url}\n\n`;
          });
          await sock.sendMessage(chatJid, { text }, { quoted: msg });
          await sock.sendMessage(chatJid, { react: { text: '✅', key: msg.key } });
          return;
        }
        const first = results[0];
        const buffer = await downloadYt(first.url, 'audio');
        await sock.sendMessage(chatJid, {
          audio: buffer, mimetype: 'audio/mp4', ptt: false,
          caption: `🎵 ${first.title}\n👤 ${first.author}`,
        } as any, { quoted: msg });
        await sock.sendMessage(chatJid, { react: { text: '✅', key: msg.key } });
        return;
      }
      const url = args[0];
      if (!url.match(/youtube\.com|youtu\.be/i)) {
        await sock.sendMessage(chatJid, {
          text: '❌ Invalid YouTube URL: ' + url,
        }, { quoted: msg });
        return;
      }
      const isAudio = cmd === 'ytmp3' || cmd === 'song';
      const buffer = await downloadYt(url, isAudio ? 'audio' : 'video');
      if (isAudio) {
        await sock.sendMessage(chatJid, {
          audio: buffer, mimetype: 'audio/mp4',
        } as any, { quoted: msg });
      } else {
        await sock.sendMessage(chatJid, {
          video: buffer, mimetype: 'video/mp4', caption: '📹 YouTube Video',
        }, { quoted: msg });
      }
      await sock.sendMessage(chatJid, { react: { text: '✅', key: msg.key } });
    } catch (err) {
      await sock.sendMessage(chatJid, {
        text: '❌ YT download failed: ' + (err as Error).message,
      }, { quoted: msg });
      await sock.sendMessage(chatJid, { react: { text: '❌', key: msg.key } });
    }
  },
};
