import axios from 'axios';
import type { CommandModule } from './_registry';

interface TruecallerResponse {
  name?: string; email?: string; carrier?: string;
  country?: string; city?: string; score?: number; spam?: boolean;
  addresses?: Array<{ city?: string; country?: string }>;
  internetAddresses?: Array<{ service?: string; id?: string }>;
}

export const truecaller: CommandModule = {
  command: 'truecaller',
  aliases: ['tc', 'callerid', 'whois'],
  description: 'Look up caller ID info (Truecaller)',
  category: 'lookup',
  handler: async (ctx) => {
    const { sock, msg, chatJid, args } = ctx;
    let number = args[0]?.replace(/[^0-9]/g, '');
    if (!number && msg.message?.extendedTextMessage?.contextInfo?.participant) {
      number = msg.message.extendedTextMessage.contextInfo.participant.split('@')[0].split(':')[0];
    }
    if (!number || number.length < 10) {
      await sock.sendMessage(chatJid, {
        text: '❌ Usage: .tc <number>\nExample: .tc 923001234567',
      }, { quoted: msg });
      return;
    }
    await sock.sendMessage(chatJid, { react: { text: '🔍', key: msg.key } });
    try {
      const res = await axios.get<TruecallerResponse>(
        'https://faisal-ali-truecaller.ftgmhacks.workers.dev/',
        {
          params: { key: 'ftgmxtcaller', number },
          timeout: 30_000,
          headers: { 'User-Agent': 'Zbot/1.0' },
        },
      );
      const data = res.data;
      if (!data || (!data.name && !data.carrier)) {
        await sock.sendMessage(chatJid, {
          text: `❌ No Truecaller record found for +${number}`,
        }, { quoted: msg });
        await sock.sendMessage(chatJid, { react: { text: '❌', key: msg.key } });
        return;
      }
      let text = `📞 *Truecaller Lookup*\n\n🔍 Number: +${number}\n`;
      if (data.name) text += `👤 Name: ${data.name}\n`;
      if (data.email) text += `✉️ Email: ${data.email}\n`;
      if (data.carrier) text += `📡 Carrier: ${data.carrier}\n`;
      if (data.country) text += `🌍 Country: ${data.country}\n`;
      if (data.city) text += `🏙️ City: ${data.city}\n`;
      if (data.score !== undefined) text += `📊 Score: ${data.score}\n`;
      if (data.spam) text += `⚠️ Flagged as spam\n`;
      if (data.addresses && data.addresses.length > 0) {
        const first = data.addresses[0];
        text += `\n📍 Address: `;
        if (first.city) text += `${first.city}, `;
        if (first.country) text += first.country;
        text += `\n`;
      }
      if (data.internetAddresses && data.internetAddresses.length > 0) {
        text += `\n🌐 Internet Addresses:\n`;
        for (const addr of data.internetAddresses.slice(0, 5)) {
          if (addr.service && addr.id) text += `  • ${addr.service}: ${addr.id}\n`;
        }
      }
      text += `\n⚡ _Powered by Zbot_`;
      await sock.sendMessage(chatJid, { text }, { quoted: msg });
      await sock.sendMessage(chatJid, { react: { text: '✅', key: msg.key } });
    } catch (err) {
      await sock.sendMessage(chatJid, {
        text: '❌ Truecaller lookup failed: ' + (err as Error).message,
      }, { quoted: msg });
      await sock.sendMessage(chatJid, { react: { text: '❌', key: msg.key } });
    }
  },
};
