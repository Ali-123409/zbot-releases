import type { CommandModule, CommandContext } from './_registry';
import { getConfig, updateConfig, persistConfig } from '../firebase/config-runtime';
import { parseToggle, statusText } from './_helpers';

export const autoreact: CommandModule = {
  command: 'autoreact',
  aliases: ['autoreacts'],
  description: 'Toggle auto-react to all messages',
  category: 'privacy',
  ownerOnly: true,
  handler: async (ctx: CommandContext) => {
    const { sock, msg, chatJid, args } = ctx;
    const cfg = getConfig();
    const val = parseToggle(args[0]);
    let newVal: boolean;
    if (val === null) newVal = !cfg.autoReacts;
    else newVal = val;
    updateConfig({ autoReacts: newVal });
    await persistConfig();
    let text = statusText('Auto-React', newVal);
    if (args[1]) {
      const emojis = args.slice(1).join('').split(/[\s,]+/).filter(Boolean);
      if (emojis.length > 0) {
        updateConfig({ autoReactsEmoji: emojis });
        await persistConfig();
        text += `\nEmojis: ${emojis.join(' ')}`;
      }
    } else {
      text += `\nEmojis: ${cfg.autoReactsEmoji.join(' ')}`;
    }
    await sock.sendMessage(chatJid, { text }, { quoted: msg });
  },
};

export const autoreply: CommandModule = {
  command: 'autoreply',
  aliases: ['ar'],
  description: 'Keyword-based auto-reply (add/list/del)',
  category: 'privacy',
  ownerOnly: true,
  handler: async (ctx: CommandContext) => {
    const { sock, msg, chatJid, args } = ctx;
    const cfg = getConfig();
    const sub = args[0]?.toLowerCase();

    if (!sub) {
      const list = Object.entries(cfg.autoReplyCommands);
      let text = statusText('Auto-Reply', cfg.autoReply);
      if (list.length > 0) {
        text += '\n\n📝 *Triggers:*';
        for (const [k, v] of list) {
          text += `\n• "${k}" → "${v.length > 40 ? v.slice(0, 40) + '...' : v}"`;
        }
      } else {
        text += '\n\nℹ️ No triggers set. Use: .autoreply add <keyword> | <reply>';
      }
      await sock.sendMessage(chatJid, { text }, { quoted: msg });
      return;
    }
    if (sub === 'on' || sub === 'off') {
      const val = sub === 'on';
      updateConfig({ autoReply: val });
      await persistConfig();
      await sock.sendMessage(chatJid, { text: statusText('Auto-Reply', val) }, { quoted: msg });
      return;
    }
    if (sub === 'add') {
      const rest = args.slice(1).join(' ');
      const sep = rest.indexOf('|');
      if (sep === -1) {
        await sock.sendMessage(chatJid, {
          text: '⚠️ Usage: .autoreply add <keyword> | <reply>',
        }, { quoted: msg });
        return;
      }
      const keyword = rest.slice(0, sep).trim().toLowerCase();
      const reply = rest.slice(sep + 1).trim();
      if (!keyword || !reply) {
        await sock.sendMessage(chatJid, {
          text: '⚠️ Both keyword and reply are required.',
        }, { quoted: msg });
        return;
      }
      const newCommands = { ...cfg.autoReplyCommands, [keyword]: reply };
      updateConfig({ autoReplyCommands: newCommands, autoReply: true });
      await persistConfig();
      await sock.sendMessage(chatJid, {
        text: `✅ Added trigger:\n• "${keyword}" → "${reply}"`,
      }, { quoted: msg });
      return;
    }
    if (sub === 'del' || sub === 'delete' || sub === 'remove') {
      const keyword = args[1]?.toLowerCase();
      if (!keyword) {
        await sock.sendMessage(chatJid, {
          text: '⚠️ Usage: .autoreply del <keyword>',
        }, { quoted: msg });
        return;
      }
      const newCommands = { ...cfg.autoReplyCommands };
      if (newCommands[keyword]) {
        delete newCommands[keyword];
        updateConfig({ autoReplyCommands: newCommands });
        await persistConfig();
        await sock.sendMessage(chatJid, {
          text: `✅ Removed trigger: "${keyword}"`,
        }, { quoted: msg });
      } else {
        await sock.sendMessage(chatJid, {
          text: `❌ Trigger "${keyword}" not found.`,
        }, { quoted: msg });
      }
      return;
    }
    if (sub === 'list') {
      const list = Object.entries(cfg.autoReplyCommands);
      let text = `📝 *Auto-Reply Triggers (${list.length}):*`;
      if (list.length === 0) text += '\n\n(empty)';
      else {
        for (const [k, v] of list) {
          text += `\n• "${k}" → "${v.length > 50 ? v.slice(0, 50) + '...' : v}"`;
        }
      }
      await sock.sendMessage(chatJid, { text }, { quoted: msg });
      return;
    }
    await sock.sendMessage(chatJid, {
      text: '⚠️ Usage:\n.autoreply add <keyword> | <reply>\n.autoreply del <keyword>\n.autoreply list\n.autoreply on|off',
    }, { quoted: msg });
  },
};
