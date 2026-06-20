/**
 * Zbot v2.1.6 — Command Registry
 *
 * v2.1.6 FIXES:
 * - dispatchMessage now enforces ownerOnly + mode + isApproved (C1 — was total security bypass)
 * - Uses getConfig().prefix instead of env var (C2 — prefix changes via config now work)
 * - Added invokedAs to CommandContext (C14 — handlers can now distinguish aliases)
 * - Deep-merge groups in updateConfig (M2 from firebase audit)
 */

import type { WASocket, proto } from '@whiskeysockets/baileys';
import { getConfig, updateConfig as updateRuntimeConfig } from '../firebase/config-runtime';
import { isApproved } from '../firebase/number-registry';

export interface CommandContext {
  sock: WASocket;
  msg: proto.IWebMessageInfo;
  chatJid: string;
  sender: string;
  args: string[];
  text: string;
  isFromMe: boolean;
  isGroup: boolean;
  invokedAs: string;  // v2.1.6: the actual command name typed (for alias handling)
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
  // v2.1.6 FIX: read prefix from runtime config (was hardcoded to env var)
  const cfg = getConfig();
  const prefix = cfg.prefix || process.env.BOT_PREFIX || '.';
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

  // v2.1.6 FIX (C1): enforce ownerOnly + mode + isApproved
  const senderPhone = sender.split('@')[0].split(':')[0];
  const ownerDigits = (cfg.ownerNumber || '').replace(/[^0-9]/g, '');
  const isOwner = ownerDigits.length > 0 && senderPhone === ownerDigits;

  // If bot is not approved by admin, ignore all commands (except owner commands)
  if (!isApproved() && !isOwner) {
    return false;
  }

  // Private mode: only owner can run commands
  if (cfg.mode === 'private' && !isOwner) {
    return false;
  }

  // ownerOnly enforcement
  if (mod.ownerOnly && !isOwner) {
    try {
      await sock.sendMessage(chatJid, {
        text: '🚫 Owner only command.',
      }, { quoted: msg });
    } catch (e) { /* ignore */ }
    return true;
  }

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
    invokedAs: cmdName,  // v2.1.6: pass the actual command name typed
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
