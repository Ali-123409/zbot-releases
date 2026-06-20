import type { CommandModule, CommandContext } from './_registry';
import { getConfig, updateConfig, persistConfig } from '../firebase/config-runtime';

export const welcome: CommandModule = {
  command: 'welcome',
  aliases: ['setwelcome'],
  description: 'Set or view welcome message (placeholders: @user @group @date)',
  category: 'admin',
  ownerOnly: true,
  groupOnly: true,
  handler: async (ctx: CommandContext) => {
    const { sock, msg, chatJid, text } = ctx;
    const cfg = getConfig();
    if (!text) {
      const current = cfg.groups.welcomeMsg[chatJid];
      await sock.sendMessage(chatJid, {
        text: current ? `📝 *Current welcome message:*\n\n${current}` : 'ℹ️ No welcome message set. Use: .welcome <message>',
      }, { quoted: msg });
      return;
    }
    updateConfig({
      groups: { ...cfg.groups, welcomeMsg: { ...cfg.groups.welcomeMsg, [chatJid]: text } },
    });
    await persistConfig();
    await sock.sendMessage(chatJid, {
      text: `✅ Welcome message set for this group:\n\n${text}`,
    }, { quoted: msg });
  },
};

export const goodbye: CommandModule = {
  command: 'goodbye',
  aliases: ['setgoodbye', 'bye'],
  description: 'Set or view goodbye message (placeholders: @user @group @date)',
  category: 'admin',
  ownerOnly: true,
  groupOnly: true,
  handler: async (ctx: CommandContext) => {
    const { sock, msg, chatJid, text } = ctx;
    const cfg = getConfig();
    if (!text) {
      const current = cfg.groups.goodbyeMsg[chatJid];
      await sock.sendMessage(chatJid, {
        text: current ? `📝 *Current goodbye message:*\n\n${current}` : 'ℹ️ No goodbye message set. Use: .goodbye <message>',
      }, { quoted: msg });
      return;
    }
    updateConfig({
      groups: { ...cfg.groups, goodbyeMsg: { ...cfg.groups.goodbyeMsg, [chatJid]: text } },
    });
    await persistConfig();
    await sock.sendMessage(chatJid, {
      text: `✅ Goodbye message set for this group:\n\n${text}`,
    }, { quoted: msg });
  },
};
