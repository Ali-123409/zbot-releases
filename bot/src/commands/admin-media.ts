import { downloadContentFromMessage } from '@whiskeysockets/baileys';
import type { CommandModule, CommandContext } from './_registry';
import { getConfig, updateConfig, persistConfig } from '../firebase/config-runtime';
import { parseToggle, statusText } from './_helpers';

export const dp: CommandModule = {
  command: 'dp',
  aliases: ['getdp', 'pp', 'pfp', 'getpp'],
  description: 'Download profile picture of a user (reply or @mention)',
  category: 'media',
  handler: async (ctx: CommandContext) => {
    const { sock, msg, chatJid } = ctx;
    let targetJid: string | undefined = msg.message?.extendedTextMessage?.contextInfo?.participant || undefined;
    if (!targetJid && msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.length) {
      targetJid = msg.message.extendedTextMessage.contextInfo.mentionedJid[0];
    }
    if (!targetJid && chatJid.endsWith('@s.whatsapp.net')) targetJid = chatJid;
    if (!targetJid) {
      await sock.sendMessage(chatJid, {
        text: '⚠️ Reply to a user or @mention them to get their DP.',
      }, { quoted: msg });
      return;
    }
    try {
      const picUrl = await sock.profilePictureUrl(targetJid, 'image');
      await sock.sendMessage(chatJid, {
        image: { url: picUrl as string },
        caption: `📸 Profile picture of @${targetJid.split('@')[0]}`,
        contextInfo: { mentionedJid: [targetJid] },
      }, { quoted: msg });
    } catch (err) {
      await sock.sendMessage(chatJid, {
        text: '❌ Could not fetch DP (user may have hidden it).',
      }, { quoted: msg });
    }
  },
};

export const save: CommandModule = {
  command: 'save',
  aliases: ['statussave', 'dl'],
  description: 'Save a status message (reply to status)',
  category: 'media',
  handler: async (ctx: CommandContext) => {
    const { sock, msg, chatJid } = ctx;
    const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage as any;
    if (!quoted) {
      await sock.sendMessage(chatJid, {
        text: '⚠️ Reply to a status message to save it.',
      }, { quoted: msg });
      return;
    }
    let mediaMessage: any = null;
    let mediaType: 'image' | 'video' | null = null;
    if (quoted.imageMessage) { mediaMessage = quoted.imageMessage; mediaType = 'image'; }
    else if (quoted.videoMessage) { mediaMessage = quoted.videoMessage; mediaType = 'video'; }
    else if (quoted.extendedTextMessage) {
      const text = quoted.extendedTextMessage.text || '';
      const botJid = sock.user?.id;
      if (botJid) {
        const botNumber = botJid.split(':')[0].split('@')[0];
        await sock.sendMessage(botNumber + '@s.whatsapp.net', {
          text: `💾 Saved Status:\n\n${text}`,
        });
      }
      await sock.sendMessage(chatJid, { text: '✅ Status text saved' }, { quoted: msg });
      return;
    }
    if (!mediaMessage || !mediaType) {
      await sock.sendMessage(chatJid, {
        text: '❌ No media found in replied message.',
      }, { quoted: msg });
      return;
    }
    try {
      const stream = await downloadContentFromMessage(mediaMessage, mediaType);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(chunk);
      const buffer = Buffer.concat(chunks);
      const botJid = sock.user?.id;
      if (!botJid) {
        await sock.sendMessage(chatJid, { text: '❌ Bot not connected' }, { quoted: msg });
        return;
      }
      const botNumber = botJid.split(':')[0].split('@')[0];
      const targetJid = botNumber + '@s.whatsapp.net';
      if (mediaType === 'image') {
        await sock.sendMessage(targetJid, { image: buffer, caption: '💾 Saved Status' });
      } else {
        await sock.sendMessage(targetJid, {
          video: buffer, mimetype: 'video/mp4', caption: '💾 Saved Status',
        });
      }
      await sock.sendMessage(chatJid, { text: '✅ Status saved to your Saved Chats' }, { quoted: msg });
    } catch (err) {
      await sock.sendMessage(chatJid, {
        text: '❌ Failed: ' + (err as Error).message,
      }, { quoted: msg });
    }
  },
};

export const tovoice: CommandModule = {
  command: 'tovoice',
  aliases: ['toogg', 'mp3toogg', 'ptt'],
  description: 'Convert replied audio to voice note (PTT)',
  category: 'media',
  handler: async (ctx: CommandContext) => {
    const { sock, msg, chatJid } = ctx;
    const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage as any;
    if (!quoted?.audioMessage && !quoted?.audio) {
      await sock.sendMessage(chatJid, {
        text: '⚠️ Reply to an audio message to convert it.',
      }, { quoted: msg });
      return;
    }
    try {
      const audioMsg = quoted.audioMessage || quoted.audio;
      const stream = await downloadContentFromMessage(audioMsg, 'audio');
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(chunk);
      const buffer = Buffer.concat(chunks);
      await sock.sendMessage(chatJid, {
        audio: buffer, ptt: true, mimetype: 'audio/mp4',
      }, { quoted: msg });
    } catch (err) {
      await sock.sendMessage(chatJid, {
        text: '❌ Conversion failed: ' + (err as Error).message,
      }, { quoted: msg });
    }
  },
};

export const block: CommandModule = {
  command: 'block',
  aliases: ['unblock'],
  description: 'Block/unblock a user (reply or @mention)',
  category: 'admin',
  handler: async (ctx: CommandContext) => {
    const { sock, msg, chatJid, args } = ctx;
    const cmd = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
    const isUnblock = cmd.toLowerCase().startsWith('.unblock');
    let targetJid: string | undefined = msg.message?.extendedTextMessage?.contextInfo?.participant || undefined;
    if (!targetJid && msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.length) {
      targetJid = msg.message.extendedTextMessage.contextInfo.mentionedJid[0];
    }
    if (!targetJid && args[0]) {
      const phone = args[0].replace(/[^0-9]/g, '');
      if (phone.length >= 10) targetJid = phone + '@s.whatsapp.net';
    }
    if (!targetJid) {
      await sock.sendMessage(chatJid, {
        text: '⚠️ Reply to a user, @mention them, or provide a phone number.',
      }, { quoted: msg });
      return;
    }
    try {
      await sock.updateBlockStatus(targetJid, isUnblock ? 'unblock' : 'block');
      await sock.sendMessage(chatJid, {
        text: `✅ ${isUnblock ? 'Unblocked' : 'Blocked'} @${targetJid.split('@')[0]}`,
        contextInfo: { mentionedJid: [targetJid] },
      }, { quoted: msg });
    } catch (err) {
      await sock.sendMessage(chatJid, {
        text: '❌ Failed: ' + (err as Error).message,
      }, { quoted: msg });
    }
  },
};

export const setpp: CommandModule = {
  command: 'setpp',
  aliases: ['setpfp', 'setdp', 'setprofilepic'],
  description: 'Set bot\'s profile picture (reply to an image)',
  category: 'admin',
  handler: async (ctx: CommandContext) => {
    const { sock, msg, chatJid } = ctx;
    const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage as any;
    if (!quoted?.imageMessage) {
      await sock.sendMessage(chatJid, {
        text: '⚠️ Reply to an image to set as profile picture.',
      }, { quoted: msg });
      return;
    }
    try {
      const stream = await downloadContentFromMessage(quoted.imageMessage, 'image');
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(chunk);
      const buffer = Buffer.concat(chunks);
      await sock.updateProfilePicture(sock.user!.id, buffer);
      await sock.sendMessage(chatJid, { text: '✅ Profile picture updated!' }, { quoted: msg });
    } catch (err) {
      await sock.sendMessage(chatJid, {
        text: '❌ Failed: ' + (err as Error).message,
      }, { quoted: msg });
    }
  },
};

export const kickall: CommandModule = {
  command: 'kickall',
  aliases: ['removeall'],
  description: 'Kick everyone from the current group (use with caution)',
  category: 'admin',
  groupOnly: true,
  handler: async (ctx: CommandContext) => {
    const { sock, msg, chatJid } = ctx;
    if (!chatJid.endsWith('@g.us')) {
      await sock.sendMessage(chatJid, { text: '❌ Group only.' }, { quoted: msg });
      return;
    }
    try {
      const metadata = await sock.groupMetadata(chatJid);
      const botNumber = sock.user?.id?.split(':')[0]?.split('@')[0] || '';
      const botJid = sock.user?.id || '';
      const toKick = metadata.participants
        .filter(p => p.id !== botJid && !p.id.startsWith(botNumber))
        .map(p => p.id);
      if (toKick.length === 0) {
        await sock.sendMessage(chatJid, { text: 'ℹ️ No users to kick.' }, { quoted: msg });
        return;
      }
      await sock.groupParticipantsUpdate(chatJid, toKick, 'remove');
      await sock.sendMessage(chatJid, {
        text: `✅ Kicked ${toKick.length} members.`,
      }, { quoted: msg });
    } catch (err) {
      await sock.sendMessage(chatJid, {
        text: '❌ Failed: ' + (err as Error).message + '\n(Make sure bot is admin)',
      }, { quoted: msg });
    }
  },
};

export const antitagall: CommandModule = {
  command: 'antitagall',
  aliases: ['antitag'],
  description: 'Toggle anti-tag-all (warn members who @everyone)',
  category: 'admin',
  groupOnly: true,
  handler: async (ctx: CommandContext) => {
    const { sock, msg, chatJid } = ctx;
    const cfg = getConfig();
    const val = parseToggle(msg.message?.extendedTextMessage?.text?.split(/\s+/)[1]);
    let enabled: boolean;
    if (val === null) enabled = !cfg.groups.antiTagAll.includes(chatJid);
    else enabled = val;
    let newGroups: string[];
    if (enabled) newGroups = [...new Set([...cfg.groups.antiTagAll, chatJid])];
    else newGroups = cfg.groups.antiTagAll.filter(g => g !== chatJid);
    updateConfig({ groups: { ...cfg.groups, antiTagAll: newGroups } });
    await persistConfig();
    await sock.sendMessage(chatJid, {
      text: statusText('Anti-Tag-All (this group)', enabled),
    }, { quoted: msg });
  },
};

export const antilink: CommandModule = {
  command: 'antilink',
  description: 'Toggle anti-link (auto-delete links in this group)',
  category: 'admin',
  groupOnly: true,
  handler: async (ctx: CommandContext) => {
    const { sock, msg, chatJid } = ctx;
    const cfg = getConfig();
    const val = parseToggle(msg.message?.extendedTextMessage?.text?.split(/\s+/)[1]);
    let enabled: boolean;
    if (val === null) enabled = !cfg.groups.antiLink.includes(chatJid);
    else enabled = val;
    let newGroups: string[];
    if (enabled) newGroups = [...new Set([...cfg.groups.antiLink, chatJid])];
    else newGroups = cfg.groups.antiLink.filter(g => g !== chatJid);
    updateConfig({ groups: { ...cfg.groups, antiLink: newGroups } });
    await persistConfig();
    await sock.sendMessage(chatJid, {
      text: statusText('Anti-Link (this group)', enabled),
    }, { quoted: msg });
  },
};
