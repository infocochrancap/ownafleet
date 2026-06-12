// POST /api/jotform-webhook?key=<JOTFORM_WEBHOOK_KEY>
//
// Receives Jotform's webhook on every submission of the Armada Commercial
// Credit Application (the Jotform embedded at /apply, form 261395920834160)
// and closes the tracking gap where applications were invisible to the system
// ("Application Submitted" used to be a purely manual status flip).
//
// On each submission:
//   1. Extract every email address in the submission payload.
//   2. Match a lead by email (case-insensitive).
//   3. If matched and the lead hasn't already passed the application stage,
//      auto-promote status → 'application_submitted' (forward-only — never
//      moves a lead backward).
//   4. Log a prospect_interactions row (idempotent via submissionID, so
//      Jotform retries can't double-fire side effects).
//   5. Auto-skip any pending Outbox drafts that the application makes stale
//      (no_book / no_app / stalled_app).
//   6. Notify Josh — including when NO lead matches, so a submission from
//      someone who never touched the site still surfaces.
//
// SETUP (one-time): in the Jotform account that owns the form —
//   Settings → Integrations → WebHooks → add:
//     https://ownafleet.com/api/jotform-webhook?key=<JOTFORM_WEBHOOK_KEY>
//   Jotform doesn't sign webhooks, so the shared-secret query param is the
//   auth. The key lives in Vercel env (JOTFORM_WEBHOOK_KEY).
//
// PAYLOAD: Jotform posts multipart/form-data with text fields including
//   formID, submissionID, pretty (human-readable summary), and rawRequest
//   (JSON of all answers). Vercel's body helper doesn't parse multipart, so
//   we read the raw stream and extract the text fields ourselves.

import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const FROM = 'OwnaFleet <leads@ownafleet.com>';
const NOTIFY = 'josh@ownafleet.com';
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

// Forward-only promotion: flip to application_submitted only from these.
const PRE_APP_STATUSES = new Set([
  'submitted_homepage', 'booked_call', 'call_completed_app_sent',
  'not_now', 'dead', 'archived',
  // legacy
  'new', 'contacted', 'application_sent'
]);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ----- AUTH: shared-secret query param -----
  const expected = process.env.JOTFORM_WEBHOOK_KEY;
  if (!expected) {
    console.error('JOTFORM_WEBHOOK_KEY not set — refusing.');
    return res.status(500).json({ error: 'Not configured' });
  }
  const url = new URL(req.url, 'https://ownafleet.com');
  if (url.searchParams.get('key') !== expected) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // ----- PARSE the multipart (or json/urlencoded) payload -----
  let fields = {};
  try {
    const ctype = req.headers['content-type'] || '';
    if (ctype.includes('multipart/form-data')) {
      const raw = await readRawBody(req);
      fields = parseMultipartText(raw, ctype);
    } else if (req.body && typeof req.body === 'object') {
      fields = req.body;            // json / urlencoded fallback
    }
  } catch (e) {
    console.error('jotform-webhook parse error:', e.message);
    return res.status(400).json({ error: 'Unparseable payload' });
  }

  const submissionId = String(fields.submissionID || fields.submission_id || '').trim();
  const formId = String(fields.formID || '').trim();
  const pretty = String(fields.pretty || '');
  const rawRequest = String(fields.rawRequest || '');
  if (!submissionId) {
    console.warn('jotform-webhook: no submissionID; fields seen:', Object.keys(fields).join(','));
    return res.status(200).json({ ok: true, note: 'no submissionID — ignored' });
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

  // ----- IDEMPOTENCY: bail if we've already processed this submission -----
  const externalId = `jotform:${submissionId}`;
  {
    const { data: existing } = await supabase
      .from('prospect_interactions')
      .select('id').eq('source', 'other').eq('external_id', externalId).maybeSingle();
    if (existing) return res.status(200).json({ ok: true, deduped: true });
  }

  // ----- EXTRACT emails + a display name (best-effort) -----
  const emails = [...new Set([...(rawRequest.match(EMAIL_RE) || []), ...(pretty.match(EMAIL_RE) || [])]
    .map(e => e.toLowerCase())
    // Jotform sometimes echoes internal/system addresses; drop our own domains.
    .filter(e => !e.endsWith('@ownafleet.com') && !e.endsWith('@jotform.com')))];
  const displayName = extractName(rawRequest) || (emails[0] || 'Unknown applicant');

  // ----- MATCH a lead by any extracted email -----
  let lead = null;
  for (const em of emails) {
    const { data } = await supabase
      .from('leads')
      .select('id, first_name, last_name, email, status')
      .ilike('email', em).maybeSingle();
    if (data) { lead = data; break; }
  }

  let promoted = false;
  if (lead && PRE_APP_STATUSES.has(lead.status)) {
    const { error } = await supabase
      .from('leads')
      .update({ status: 'application_submitted' })
      .eq('id', lead.id);
    promoted = !error;
    if (error) console.error('jotform-webhook status flip failed:', error);
  }

  // ----- LOG the interaction (this row is also the idempotency marker) -----
  try {
    await supabase.from('prospect_interactions').insert({
      first_name: lead?.first_name || displayName,
      email: lead?.email || emails[0] || null,
      phone: null,
      direction: 'inbound',
      method: 'other',
      subject: 'Credit application submitted (Jotform)',
      notes: `Jotform submission ${submissionId}${formId ? ` on form ${formId}` : ''}.` +
             (lead ? (promoted ? ' Lead auto-promoted to Application Submitted.' : ` Lead matched (status ${lead.status} — not changed).`) : ' No matching lead found.'),
      external_id: externalId,
      external_url: formId ? `https://www.jotform.com/inbox/${formId}` : null,
      source: 'other'
    });
  } catch (e) {
    console.warn('jotform-webhook interaction log failed:', e.message);
  }

  // ----- AUTO-SKIP Outbox drafts the application makes stale -----
  if (lead) {
    try {
      await supabase.from('followup_drafts')
        .update({ status: 'skipped', skipped_at: new Date().toISOString() })
        .eq('lead_id', lead.id)
        .eq('status', 'pending')
        .in('followup_type', ['no_book', 'no_app', 'stalled_app']);
    } catch (e) {
      console.warn('jotform-webhook draft skip failed:', e.message);
    }
  }

  // ----- NOTIFY Josh -----
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const who = lead ? `${lead.first_name || ''} ${lead.last_name || ''}`.trim() : displayName;
    const subject = lead
      ? `Application submitted — ${who}`
      : `Application submitted — ${who} (no matching lead)`;
    await resend.emails.send({
      from: FROM, to: [NOTIFY], subject,
      html: `
        <div style="font-family:-apple-system,sans-serif;max-width:600px;line-height:1.6;color:#0B1724;">
          <p>The credit application on <strong>/apply</strong> was just submitted.</p>
          <ul style="line-height:1.8;">
            <li><strong>Who:</strong> ${esc(who)}</li>
            ${emails.length ? `<li><strong>Email(s) on the application:</strong> ${esc(emails.join(', '))}</li>` : ''}
            <li><strong>Tracking:</strong> ${lead
              ? (promoted
                  ? 'Lead auto-promoted to <strong>Application Submitted</strong> ✓'
                  : `Lead matched — already at <strong>${esc(lead.status)}</strong>, left as-is`)
              : '<strong>No matching lead</strong> — add them via /admin (Interactions tab) so the pipeline stays complete'}</li>
            <li><strong>Jotform submission:</strong> ${esc(submissionId)}</li>
          </ul>
        </div>`
    });
  } catch (e) {
    console.warn('jotform-webhook notify failed:', e.message);
  }

  return res.status(200).json({ ok: true, matched: !!lead, promoted });
}

// ---- helpers ----

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// Minimal multipart parser for TEXT fields only (Jotform sends no binaries
// on webhook posts). Returns { fieldName: value }.
function parseMultipartText(raw, contentType) {
  const m = contentType.match(/boundary=("?)([^";]+)\1/);
  if (!m) return {};
  const boundary = '--' + m[2];
  const out = {};
  for (const part of raw.split(boundary)) {
    const nameMatch = part.match(/name="([^"]+)"/);
    if (!nameMatch) continue;
    const idx = part.indexOf('\r\n\r\n');
    if (idx === -1) continue;
    // Strip the trailing \r\n that precedes the next boundary.
    out[nameMatch[1]] = part.slice(idx + 4).replace(/\r\n$/, '');
  }
  return out;
}

// Best-effort name extraction from Jotform's rawRequest JSON — looks for a
// field whose key mentions "name" with {first,last} or string values.
function extractName(rawRequest) {
  try {
    const obj = JSON.parse(rawRequest);
    for (const [k, v] of Object.entries(obj)) {
      if (!/name/i.test(k)) continue;
      if (v && typeof v === 'object' && (v.first || v.last)) {
        return `${v.first || ''} ${v.last || ''}`.trim() || null;
      }
      if (typeof v === 'string' && v.trim() && !EMAIL_RE.test(v)) return v.trim().slice(0, 80);
    }
  } catch { /* rawRequest not JSON — fine */ }
  return null;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
