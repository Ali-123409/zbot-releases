export function parseToggle(input?: string): boolean | null {
  if (!input) return null;
  const v = input.toLowerCase().trim();
  if (['on', 'true', '1', 'yes', 'enable'].includes(v)) return true;
  if (['off', 'false', '0', 'no', 'disable'].includes(v)) return false;
  return null;
}

export function statusText(name: string, value: boolean): string {
  return `⚙️ *${name}*: ${value ? '✅ ON' : '❌ OFF'}`;
}
