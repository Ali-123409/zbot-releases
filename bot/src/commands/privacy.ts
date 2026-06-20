import type { CommandModule, CommandContext } from './_registry';
import { getConfig, updateConfig, persistConfig } from '../firebase/config-runtime';
import { parseToggle, statusText } from './_helpers';

export const antidelete: CommandModule = {
  command: 'antidelete',
  aliases: ['antidel'],
  description: 'Toggle restore of deleted messages',
  category: 'privacy',
  ownerOnly: true,
  handler: async (ctx: CommandContext) => await toggleSetting(ctx, 'antiDelete', 'Anti-Delete'),
};

export const antiedit: CommandModule = {
  command: 'antiedit',
  description: 'Toggle restore of edited messages',
  category: 'privacy',
  ownerOnly: true,
  handler: async (ctx: CommandContext) => await toggleSetting(ctx, 'antiEdit', 'Anti-Edit'),
};

export const autoseen: CommandModule = {
  command: 'autoseen',
  aliases: ['autostatus', 'statusview'],
  description: 'Toggle auto-view of statuses',
  category: 'privacy',
  ownerOnly: true,
  handler: async (ctx: CommandContext) => await toggleSetting(ctx, 'autoStatusSeen', 'Auto Status Seen'),
};

export const autostatusreact: CommandModule = {
  command: 'autostatusreact',
  aliases: ['statusreact', 'asr'],
  description: 'Toggle auto-react to statuses',
  category: 'privacy',
  ownerOnly: true,
  handler: async (ctx: CommandContext) => {
    const { sock, msg, chatJid, args } = ctx;
    const cfg = getConfig();
    const val = parseToggle(args[0]);
    let newVal: boolean;
    if (val === null) newVal = !cfg.autoStatusReact;
    else newVal = val;
    updateConfig({ autoStatusReact: newVal });
    if (args[1]) updateConfig({ autoStatusEmoji: args[1] });
    await persistConfig();
    await sock.sendMessage(chatJid, {
      text: statusText('Auto Status React', newVal) + `\nEmoji: ${args[1] || cfg.autoStatusEmoji}`,
    }, { quoted: msg });
  },
};

export const anticall: CommandModule = {
  command: 'anticall',
  description: 'Toggle auto-reject of incoming calls',
  category: 'privacy',
  ownerOnly: true,
  handler: async (ctx: CommandContext) => await toggleSetting(ctx, 'antiCall', 'Anti-Call'),
};

export const alwaysonline: CommandModule = {
  command: 'alwaysonline',
  aliases: ['online'],
  description: 'Toggle always-online presence',
  category: 'privacy',
  ownerOnly: true,
  handler: async (ctx: CommandContext) => {
    const { sock, msg, chatJid } = ctx;
    const cfg = getConfig();
    const newVal = !cfg.alwaysOnline;
    updateConfig({ alwaysOnline: newVal });
    await persistConfig();
    try {
      await sock.sendPresenceUpdate(newVal ? 'available' : 'unavailable');
    } catch (err) { /* ignore */ }
    await sock.sendMessage(chatJid, { text: statusText('Always Online', newVal) }, { quoted: msg });
  },
};

export const mode: CommandModule = {
  command: 'mode',
  aliases: ['public', 'private'],
  description: 'Toggle public/private mode',
  category: 'privacy',
  ownerOnly: true,
  handler: async (ctx: CommandContext) => {
    const { sock, msg, chatJid, args } = ctx;
    const cfg = getConfig();
    let newMode: 'public' | 'private';
    if (args[0]?.toLowerCase() === 'public') newMode = 'public';
    else if (args[0]?.toLowerCase() === 'private') newMode = 'private';
    else newMode = cfg.mode === 'public' ? 'private' : 'public';
    updateConfig({ mode: newMode });
    await persistConfig();
    await sock.sendMessage(chatJid, {
      text: `⚙️ *Mode*: ${newMode === 'public' ? '🌐 Public (anyone can use)' : '🔒 Private (owner only)'}`,
    }, { quoted: msg });
  },
};

export const getjid: CommandModule = {
  command: 'getjid',
  aliases: ['channeljid', 'jid'],
  description: 'Get the current chat\'s JID',
  category: 'general',
  handler: async (ctx: CommandContext) => {
    const { sock, msg, chatJid, isGroup } = ctx;
    await sock.sendMessage(chatJid, {
      text: `🆔 *Chat JID:* ${chatJid}\nType: ${isGroup ? 'Group' : 'Private'}\nBot: ${sock.user?.id || 'N/A'}`,
    }, { quoted: msg });
  },
};

async function toggleSetting(
  ctx: CommandContext, field: string, label: string,
): Promise<void> {
  const { sock, msg, chatJid, args } = ctx;
  const cfg = getConfig();
  const val = parseToggle(args[0]);
  let newVal: boolean;
  if (val === null) newVal = !(cfg[field as keyof typeof cfg] as boolean);
  else newVal = val;
  updateConfig({ [field]: newVal } as any);
  await persistConfig();
  await sock.sendMessage(chatJid, { text: statusText(label, newVal) }, { quoted: msg });
}
