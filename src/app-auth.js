const SESSION_COOKIE = 'kentaurai_session';
const SESSION_SECONDS = 60 * 60 * 24 * 30;

function textEncoder() {
  return new TextEncoder();
}

function timingSafeEqualText(a, b) {
  const left = textEncoder().encode(String(a));
  const right = textEncoder().encode(String(b));
  const length = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let i = 0; i < length; i += 1) diff |= (left[i] || 0) ^ (right[i] || 0);
  return diff === 0;
}

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function signature(secret, expiresAt) {
  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const bytes = await crypto.subtle.sign('HMAC', key, textEncoder().encode(`kentaurai-app-v1:${expiresAt}`));
  return bytesToHex(new Uint8Array(bytes));
}

function readCookie(request, name) {
  const cookie = request.headers.get('cookie') || '';
  for (const part of cookie.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}

export function appAuthConfigured(env) {
  return Boolean(env.APP_PASSWORD);
}

export async function createAppSessionCookie(env, nowMs = Date.now()) {
  if (!env.APP_PASSWORD) throw new Error('APP_PASSWORD is not configured');
  const expiresAt = Math.floor(nowMs / 1000) + SESSION_SECONDS;
  const sig = await signature(env.APP_PASSWORD, expiresAt);
  return `${SESSION_COOKIE}=${expiresAt}.${sig}; Path=/app; Max-Age=${SESSION_SECONDS}; HttpOnly; Secure; SameSite=Strict`;
}

export function clearAppSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/app; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

export async function hasValidAppSession(request, env, nowMs = Date.now()) {
  if (!env.APP_PASSWORD) return false;
  const raw = readCookie(request, SESSION_COOKIE);
  if (!raw) return false;
  const [expiresText, suppliedSig, extra] = raw.split('.');
  if (!expiresText || !suppliedSig || extra != null) return false;
  const expiresAt = Number(expiresText);
  if (!Number.isInteger(expiresAt) || expiresAt <= Math.floor(nowMs / 1000)) return false;
  const expectedSig = await signature(env.APP_PASSWORD, expiresAt);
  return timingSafeEqualText(suppliedSig, expectedSig);
}

export function appPasswordMatches(env, supplied) {
  if (!env.APP_PASSWORD) return false;
  return timingSafeEqualText(String(supplied || ''), env.APP_PASSWORD);
}
