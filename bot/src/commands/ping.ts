import type { CommandModule } from './_registry';
const startTime = Date.now();

export const ping: CommandModule = {
  command: 'ping',
  description: 'Check bot latency',
  category: 'general',
  handler: async (ctx) => {
    const { sock, msg, chatJid } = ctx;
    const sentAt = Date.now();
    await sock.sendMessage(chatJid, {
      text: `🏓 Pong!\n⚡ Response: ${Date.now() - sentAt}ms\n⏱️ Uptime: ${formatUptime(Date.now() - startTime)}`,
    }, { quoted: msg });
  },
};

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}
