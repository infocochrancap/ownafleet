// Cloudflare Email Worker for log@ownafleet.com
//
// Auto-logs emails BCC'd to log@ownafleet.com into prospect_interactions.
// Andrea (or Josh) puts log@ownafleet.com in the BCC of any outbound
// outreach; this worker parses the message and POSTs to the OwnaFleet
// /api/log-interaction endpoint.
//
// Setup (one-time):
//
//   1. Cloudflare Dashboard → Workers & Pages → Create Worker
//      - Name it: ownafleet-email-logger
//      - Paste this entire file as the worker code, deploy.
//
//   2. Same worker → Settings → Variables and Secrets, add:
//      - INTERACTION_API_URL = https://ownafleet.com/api/log-interaction
//      - INTERACTION_API_KEY = <the same value used in Vercel for
//                              INTERACTION_LOG_API_KEY>  (mark as Secret)
//
//   3. Cloudflare Dashboard → ownafleet.com domain → Email → Routing
//      - Routing Addresses → Create address
//      - Custom address: log@ownafleet.com
//      - Action: Send to a Worker → select ownafleet-email-logger
//
//   4. Test by BCC'ing log@ownafleet.com on any outbound email. Open
//      /admin?view=interactions in a minute or two; the email should
//      appear as a new interaction row.

const INTERNAL_DOMAINS = ['ownafleet.com', 'cochrancap.com'];
const SELF_ADDRESS = 'log@ownafleet.com';
const MAX_BODY_BYTES = 100_000;
const MAX_NOTES_CHARS = 1000;

export default {
  async email(message, env, ctx) {
    try {
      const fromHeader = message.from || '';
      const toHeader   = message.headers.get('To')   || '';
      const ccHeader   = message.headers.get('Cc')   || '';
      const subject    = message.headers.get('Subject')    || '';
      const messageId  = message.headers.get('Message-ID') || null;

      const fromAddr = extractAddresses(fromHeader)[0] || { email: '', name: '' };
      const recipients = [
        ...extractAddresses(toHeader),
        ...extractAddresses(ccHeader)
      ].filter(r => r.email && r.email !== SELF_ADDRESS);

      const isOutbound = isInternal(fromAddr.email);

      // Best-effort body excerpt
      let body = '';
      try {
        const raw = await streamToString(message.raw, MAX_BODY_BYTES);
        body = extractTextBody(raw).slice(0, MAX_NOTES_CHARS);
      } catch (_) { /* body excerpt is optional */ }

      // For outbound: prospects = external recipients.
      // For inbound:  prospect  = the external sender.
      const parties = isOutbound
        ? recipients.filter(r => !isInternal(r.email))
        : (!isInternal(fromAddr.email) ? [fromAddr] : []);

      if (parties.length === 0) {
        console.log('No external parties found, skipping.');
        return;
      }

      for (let i = 0; i < parties.length; i++) {
        const p = parties[i];
        const [first, ...rest] = (p.name || '').split(/\s+/).filter(Boolean);

        // Compose a unique external_id per row when one email goes to multiple
        // prospects, so the unique (source, external_id) index doesn't drop
        // siblings as dupes.
        const externalId = messageId
          ? (parties.length > 1 ? `${messageId}#${i}` : messageId)
          : null;

        const payload = {
          first_name: first || null,
          last_name: rest.join(' ') || null,
          email: p.email,
          direction: isOutbound ? 'outbound' : 'inbound',
          method: 'email',
          subject: subject || null,
          notes: body || null,
          external_id: externalId,
          source: 'email_bcc'
        };

        const resp = await fetch(env.INTERACTION_API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': env.INTERACTION_API_KEY
          },
          body: JSON.stringify(payload)
        });
        if (!resp.ok) {
          console.warn('API rejected payload:', resp.status, await resp.text());
        }
      }
    } catch (e) {
      console.error('Email Worker error:', e && e.stack || e);
    }
  }
};

// -------------------- helpers --------------------

function extractAddresses(header) {
  // Handles common forms:
  //   foo@bar.com
  //   Name <foo@bar.com>
  //   "Last, First" <foo@bar.com>
  //   Multiple, comma-separated
  if (!header) return [];
  const out = [];
  const re = /(?:"?([^"<,]+?)"?\s*<)?([\w.\-+]+@[\w.\-]+)>?/g;
  let m;
  while ((m = re.exec(header)) !== null) {
    out.push({ name: (m[1] || '').trim(), email: m[2].toLowerCase() });
  }
  return out;
}

function isInternal(email) {
  if (!email) return false;
  return INTERNAL_DOMAINS.some(d => email.endsWith('@' + d));
}

async function streamToString(stream, maxBytes) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let result = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.length;
    result += decoder.decode(value, { stream: true });
    if (bytes >= maxBytes) break;
  }
  return result;
}

function extractTextBody(raw) {
  // If multipart, pull the text/plain part first.
  const plainMatch = raw.match(/Content-Type:\s*text\/plain[^\n]*\r?\n[\s\S]*?\r?\n\r?\n([\s\S]*?)(?=\r?\n--|\Z)/i);
  if (plainMatch) {
    return decodeQuotedPrintable(plainMatch[1]).trim();
  }
  // Otherwise, body starts after the first blank line; strip HTML tags crudely.
  const blank = raw.indexOf('\r\n\r\n');
  if (blank === -1) return '';
  const body = raw.slice(blank + 4);
  return body
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeQuotedPrintable(s) {
  // Lightweight QP decode — turns "=20" into space, "=\r\n" into nothing.
  return s
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}
