export const PROVIDER_FROM_ALLOWLIST = Object.freeze({
  'contacto@bci.cl': 'bci',
  'transferencias@bci.cl': 'bci',
  'no-reply@mail.machbank.cl': 'mach',
  'no-reply@tenpo.cl': 'tenpo',
  'info@mercadopago.com': 'mercadopago',
});
// Use the parsed mailbox from MIME in production. This conservative fallback
// supports only one bare mailbox or one display name + angle mailbox.
export function senderAddress(from) {
  if (typeof from !== 'string' || /[\r\n]/.test(from)) return null;
  const value = from.trim();
  const angled = value.match(/^[^<>@,]*<([^<>]+)>$/);
  const address = (angled ? angled[1] : value).trim().toLowerCase();
  return /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+$/.test(address) ? address : null;
}
export function getProviderFromEmail(from) {
  return PROVIDER_FROM_ALLOWLIST[senderAddress(from)] || null;
}
export function verifyGmailAuthentication(headerLines, from) {
  const domain = senderAddress(from)?.split('@')[1];
  const lines = headerLines || [];
  const first = lines.find(line => line.key?.toLowerCase() === 'authentication-results');
  if (!first || !domain) return { verified: false, reason: 'authentication_missing' };
  const value = String(first.line).replace(/\r?\n[ \t]+/g, ' ').replace(/^Authentication-Results:\s*/i, '');
  // Trust only the topmost receiver result inserted by Gmail, never an arbitrary
  // authserv-id or a later attacker-provided authentication header.
  const received = lines.some(line => line.key?.toLowerCase() === 'received'
    && /\bby mx\.google\.com\b/i.test(line.line));
  if (!received || !/^mx\.google\.com\s*;/i.test(value)) return { verified: false, reason: 'authentication_missing' };
  const results = value.split(';').slice(1);
  const aligned = results.some(result => /\bdmarc=pass\b/i.test(result)
    && result.match(/\bheader\.from=([^\s;()]+)/i)?.[1]?.toLowerCase() === domain);
  // MACH's real forwarded receipt has no DMARC verdict. Gmail does verify an
  // exact-domain DKIM signature. Do not use this fallback after a DMARC failure.
  const machDkim = domain === 'mail.machbank.cl' && !results.some(result => /\bdmarc=/i.test(result))
    && results.some(result => /\bdkim=pass\b/i.test(result)
      && result.match(/\bheader\.i=@([^\s;()]+)/i)?.[1]?.toLowerCase() === domain);
  return { verified: aligned || machDkim,
    reason: aligned ? 'gmail_dmarc_pass' : machDkim ? 'gmail_aligned_dkim_pass' : 'authentication_failed' };
}
