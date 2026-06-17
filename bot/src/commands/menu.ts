import type { CommandModule } from './_registry';
import { getAllCommands } from './_registry';

export const menu: CommandModule = {
  command: 'menu',
  aliases: ['help', 'commands', 'list'],
  description: 'Show all available commands',
  category: 'general',
  handler: async (ctx) => {
    const { sock, msg, chatJid, args } = ctx;
    const allCommands = getAllCommands();
    const botName = process.env.BOT_NAME || 'Zbot';
    const botVersion = process.env.BOT_VERSION || '1.0.0';
    const byCategory: Record<string, CommandModule[]> = {};
    for (const cmd of allCommands) {
      if (!byCategory[cmd.category]) byCategory[cmd.category] = [];
      byCategory[cmd.category].push(cmd);
    }
    const filter = args[0]?.toLowerCase();
    if (filter && byCategory[filter]) {
      const text = `*${botName} v${botVersion}*\n📂 Category: ${filter}\nCommands: ${byCategory[filter].length}\n\n` +
        byCategory[filter].map(c => {
          const aliases = c.aliases?.length ? ` (${c.aliases.join(', ')})` : '';
          return `◆ .${c.command}${aliases}\n   ${c.description}`;
        }).join('\n');
      await sock.sendMessage(chatJid, { text }, { quoted: msg });
      return;
    }
    const categoryOrder: CommandModule['category'][] = [
      'general', 'utility', 'media', 'downloader', 'lookup', 'privacy', 'admin', 'fun',
    ];
    let text = `╭────────────────╮\n│ ⚡ ${botName.toUpperCase()} v${botVersion} │\n╰────────────────╯\n\n`;
    for (const cat of categoryOrder) {
      if (!byCategory[cat]) continue;
      text += `╭─ 📂 ${cat.toUpperCase()} ─╮\n`;
      for (const cmd of byCategory[cat]) {
        const aliases = cmd.aliases?.length ? ` (${cmd.aliases.join(', ')})` : '';
        text += `│ ◆ .${cmd.command}${aliases}\n`;
        text += `│   ${cmd.description}\n`;
      }
      text += `╰─────────────╯\n\n`;
    }
    text += `\n_Powered by ${botName}_`;
    await sock.sendMessage(chatJid, { text }, { quoted: msg });
  },
};
