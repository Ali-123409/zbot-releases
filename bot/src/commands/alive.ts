import type { CommandModule } from './_registry';
const startTime = Date.now();

export const alive: CommandModule = {
  command: 'alive',
  description: 'Show bot status',
  category: 'general',
  handler: async (ctx) => {
    const { sock, msg, chatJid } = ctx;
    const botName = process.env.BOT_NAME || 'Zbot';
    const botVersion = process.env.BOT_VERSION || '1.0.0';
    const phone = sock.user?.id?.split(':')[0]?.split('@')[0] || '?';
    const uptime = formatUptime(Date.now() - startTime);
    const text =
      `╭─────────────────╮\n│ ⚡ ${botName.toUpperCase()} IS ALIVE ⚡ │\n╰─────────────────╯\n\n` +
      `◆ *Bot:* ${botName} v${botVersion}\n◆ *Phone:* +${phone}\n◆ *Uptime:* ${uptime}\n◆ *Status:* 🟢 Online\n\n_Powered by ${botName}_`;
    await sock.sendMessage(chatJid, { text }, { quoted: msg });
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
