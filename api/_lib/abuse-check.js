// Lightweight abuse mitigation for public form endpoints (submit-lead,
// request-deck, apply-partner). Two layers:
//
//  1. HONEYPOT — checks a hidden form field that real humans can't see.
//     Bots auto-fill every input they find; humans don't see it because it's
//     CSS-hidden and tabindex=-1. ~95% effective on naive scrapers/bots
//     without slowing humans down at all.
//
//  2. PER-IP RATE LIMIT — in-memory rolling counter. Catches single-source
//     bursts (script-kiddie hammering refresh). Vercel serverless instances
//     are ephemeral and not globally shared, so this is best-effort, not
//     bulletproof. For distributed-attack protection, layer Cloudflare WAF
//     rate-limit rules at the CDN edge (free tier supports this).
//
// Usage in an API handler:
//   import { checkAbuse } from './_lib/abuse-check.js';
//   const abuse = checkAbuse(req, req.body);
//   if (!abuse.ok) return res.status(abuse.status).json({ error: abuse.error });
//
// Honeypot field name: 'website' — looks like a legit field a real form might
// have, which encourages bots to fill it. The hidden form input on each
// public-facing form must use exactly this name attribute.

const HONEYPOT_FIELD = 'website';

// Per-IP request log. Map<ip, number[]> — array of unix-ms timestamps for
// recent requests. Trimmed on every check.
const recentByIp = new Map();
const RATE_WINDOW_MS = 10 * 60 * 1000;  // 10 minutes
const RATE_LIMIT    = 5;                 // max requests per window per IP

function clientIp(req) {
  // Prefer x-forwarded-for (Vercel sets this with the real client IP first).
  // Fall back to socket address. Trim to first hop, since proxies append.
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length) {
    return xff.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || 'unknown';
}

export function checkAbuse(req, body) {
  // --- 1. Honeypot ---
  // Any non-empty value in the honeypot field = bot. Reject silently
  // (return 200 OK so the bot doesn't know it was caught — they retry less
  // when they think they succeeded).
  const honeypot = body?.[HONEYPOT_FIELD];
  if (typeof honeypot === 'string' && honeypot.trim().length > 0) {
    return {
      ok: false,
      status: 200,                    // lie to the bot
      error: 'ok',                    // never shown
      silent: true,                   // caller may log instead of erroring out
      reason: 'honeypot_triggered'
    };
  }

  // --- 2. Rate limit ---
  const ip = clientIp(req);
  const now = Date.now();
  const cutoff = now - RATE_WINDOW_MS;
  const log = (recentByIp.get(ip) || []).filter(t => t > cutoff);
  log.push(now);
  recentByIp.set(ip, log);

  // Periodic cleanup: every 100th request, drop entries with no recent activity
  if (recentByIp.size > 500 && Math.random() < 0.01) {
    for (const [k, v] of recentByIp) {
      if (!v.some(t => t > cutoff)) recentByIp.delete(k);
    }
  }

  if (log.length > RATE_LIMIT) {
    return {
      ok: false,
      status: 429,
      error: 'Too many requests — please wait a few minutes and try again.',
      reason: 'rate_limit_exceeded',
      ip
    };
  }

  return { ok: true };
}
