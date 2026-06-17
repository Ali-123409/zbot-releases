/**
 * Zbot — Command Registry
 */

import type { WASocket, proto } from '@whiskeysockets/baileys';

export interface CommandContext {
  sock: WASocket;
  msg: proto.IWebMessageInfo;
  chatJid: string;
  sender: string;
  args: string[];
  text: string;
  isFromMe: boolean;
  isGroup: boolean;
}

export interface CommandModule {
  command: string;
  aliases?: string[];
  description: string;
  category: 'general' | 'utility' | 'media' | 'admin' | 'privacy' | 'downloader' | 'fun' | 'lookup';
  handler: (ctx: CommandContext) => Promise<void>;
  ownerOnly?: boolean;
  groupOnly?: boolean;
}

const _commands = new Map<string, CommandModule>();

export function registerCommand(mod: CommandModule): void {
  const names = [mod.command, ...(mod.aliases || [])].map(n => n.toLowerCase());
  for (const name of names) _commands.set(name, mod);
}

export function registerCommands(modules: CommandModule[]): void {
  for (const mod of modules) registerCommand(mod);
}

export function getAllCommands(): CommandModule[] {
  const seen = new Set<string>();
  const result: CommandModule[] = [];
  for (const cmd of _commands.values()) {
    if (seen.has(cmd.command)) continue;
    seen.add(cmd.command);
    result.push(cmd);
  }
  return result;
}

export async function dispatchMessage(
  sock: WASocket, msg: proto.IWebMessageInfo, text: string,
): Promise<boolean> {
  const prefix = process.env.BOT_PREFIX || '.';
  if (!text.startsWith(prefix)) return false;
  const body = text.slice(prefix.length).trim();
  if (!body) return false;
  const parts = body.split(/\s+/);
  const cmdName = parts[0].toLowerCase();
  const args = parts.slice(1);
  const mod = _commands.get(cmdName);
  if (!mod) return false;
  const chatJid = msg.key.remoteJid || '';
  const sender = msg.key.participant || chatJid;
  const isGroup = chatJid.endsWith('@g.us');

  if (mod.groupOnly && !isGroup) {
    await sock.sendMessage(chatJid, {
      text: '⚠️ This command only works in groups.',
    }, { quoted: msg });
    return true;
  }

  const ctx: CommandContext = {
    sock, msg, chatJid, sender, args,
    text: args.join(' '),
    isFromMe: msg.key.fromMe || false, isGroup,
  };

  try {
    await mod.handler(ctx);
  } catch (err) {
    console.error(`[CMD] ${cmdName} failed:`, err);
    try {
      await sock.sendMessage(chatJid, {
        text: '❌ Command failed: ' + (err as Error).message,
      }, { quoted: msg });
    } catch (e) { /* ignore */ }
  }
  return true;
}
