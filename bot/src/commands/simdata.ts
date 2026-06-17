import axios from 'axios';
import type { CommandModule } from './_registry';

interface SimRecord {
  full_name?: string; phone?: string; cnic?: string;
  address?: string; father_name?: string; city?: string; operator?: string;
}
interface SimApiResponse {
  success: boolean;
  data?: { records: SimRecord[] };
  msg?: string;
}

const PK_CARRIERS: Record<string, string> = {
  '30': 'Jazz', '31': 'Zong', '32': 'Warid', '33': 'Ufone', '34': 'Telenor',
};

function detectPKCarrier(number: string): string | null {
  let n = number.replace(/^0+/, '').replace(/^92/, '');
  if (n.length < 4) return null;
  return PK_CARRIERS[n.slice(0, 2)] || null;
}

export const simdata: CommandModule = {
  command: 'simdata',
  aliases: ['sim', 'carrier', 'cnic', 'owner'],
  description: 'Look up SIM registration data (PK numbers)',
  category: 'lookup',
  handler: async (ctx) => {
    const { sock, msg, chatJid, args } = ctx;
    let number = args[0]?.replace(/[^0-9]/g, '');
    if (!number && msg.message?.extendedTextMessage?.contextInfo?.participant) {
      number = msg.message.extendedTextMessage.contextInfo.participant.split('@')[0].split(':')[0];
    }
    if (!number || number.length < 10) {
      await sock.sendMessage(chatJid, {
        text: '❌ Usage: .sim <number>\nExample: .sim 3024379204',
      }, { quoted: msg });
      return;
    }
    await sock.sendMessage(chatJid, { react: { text: '🔍', key: msg.key } });

    let queryNumber = number;
    if (queryNumber.startsWith('92') && queryNumber.length > 10) queryNumber = queryNumber.substring(2);
    if (queryNumber.startsWith('0')) queryNumber = queryNumber.substring(1);

    try {
      const res = await axios.get<SimApiResponse>('https://sim-api.fakcloud.tech/', {
        params: { q: queryNumber }, timeout: 30_000,
        headers: { 'User-Agent': 'Zbot/1.0' },
      });
      const carrier = detectPKCarrier(queryNumber);
      const records = res.data?.data?.records || [];
      if (records.length > 0) {
        let text = `📱 *SIM Data Results*\n\n🔎 Query: ${queryNumber}\n📊 Records Found: ${records.length}\n`;
        if (carrier) text += `📡 Carrier: ${carrier}\n`;
        text += `\n────────────────\n`;
        records.forEach((r, i) => {
          if (records.length > 1) text += `\n📋 *Record ${i + 1}:*\n`;
          if (r.full_name) text += `👤 *Name:* ${r.full_name}\n`;
          if (r.phone) text += `📞 *Phone:* 0${r.phone}\n`;
          if (r.cnic) text += `🆔 *CNIC:* ${r.cnic}\n`;
          if (r.address) text += `📍 *Address:* ${r.address}\n`;
          if (r.father_name) text += `👨 *Father:* ${r.father_name}\n`;
          if (r.city) text += `🏙️ *City:* ${r.city}\n`;
          if (r.operator) text += `📡 *Operator:* ${r.operator}\n`;
        });
        text += `\n────────────────\n⚡ _Powered by Zbot_`;
        await sock.sendMessage(chatJid, { text }, { quoted: msg });
        await sock.sendMessage(chatJid, { react: { text: '✅', key: msg.key } });
      } else {
        const text = `📱 *SIM Data*\n\n🔎 Number: 0${queryNumber}\n` +
          (carrier ? `📡 Carrier: ${carrier}\n` : '') +
          `\n❌ No owner records found.\n_Try with full 10-digit number without 0 or 92_`;
        await sock.sendMessage(chatJid, { text }, { quoted: msg });
        await sock.sendMessage(chatJid, { react: { text: '❌', key: msg.key } });
      }
    } catch (err) {
      await sock.sendMessage(chatJid, {
        text: '❌ SIM data lookup failed: ' + (err as Error).message,
      }, { quoted: msg });
      await sock.sendMessage(chatJid, { react: { text: '❌', key: msg.key } });
    }
  },
};
