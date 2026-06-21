// POST /api/calendly-webhook
// Calendly webhook receiver. Subscribed to `invitee.created` — fires when
// someone books a call. If the invitee has NOT previously requested the
// deck, we auto-send the deck-delivery email so they have prep material
// in their inbox before the call.
//
// Idempotent: a deck_requests row is created the first time; subsequent
// retries for the same email are no-ops.
//
// Setup:
// 1. Run scripts/setup-calendly-webhook.js once to create the subscription
//    and capture the signing key.
// 2. Add the signing key to Vercel as CALENDLY_WEBHOOK_SIGNING_KEY
//    (scope: Production + Preview).

import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import crypto from 'crypto';

const FROM = 'OwnaFleet <leads@ownafleet.com>';
const DECK_URL = 'https://ownafleet.com/deck/view';

export const config = {
  api: {
    // Disable Vercel's body parser — we need the raw body to verify the signature
    bodyParser: false
  }
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // 1. Read raw body
  const rawBody = await new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });

  // 2. Verify signature (Calendly sends t=...,v1=...)
  const signingKey = process.env.CALENDLY_WEBHOOK_SIGNING_KEY;
  if (!signingKey) {
    console.error('CALENDLY_WEBHOOK_SIGNING_KEY not set — rejecting webhook.');
    return res.status(500).json({ error: 'Webhook signing key not configured' });
  }

  const sigHeader = req.headers['calendly-webhook-signature'] || '';
  const parts = Object.fromEntries(sigHeader.split(',').map(p => p.split('=')));
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) {
    return res.status(400).json({ error: 'Missing or malformed Calendly-Webhook-Signature header' });
  }

  // Replay protection: reject events older than 5 minutes
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - parseInt(t, 10)) > 300) {
    return res.status(400).json({ error: 'Signature timestamp out of tolerance' });
  }

  const expected = crypto
    .createHmac('sha256', signingKey)
    .update(`${t}.${rawBody}`)
    .digest('hex');

  const valid = (() => {
    try {
      return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(v1, 'hex'));
    } catch { return false; }
  })();

  if (!valid) {
    console.warn('Invalid Calendly webhook signature.');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // 3. Parse the event
  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  // We only care about invitee.created (when someone books)
  if (event?.event !== 'invitee.created') {
    return res.status(200).json({ ok: true, ignored: event?.event });
  }

  const payload = event?.payload || {};
  const inviteeEmail = (payload.email || '').trim().toLowerCase();
  const inviteeName = (payload.name || '').trim();
  // Try first name from the payload, falling back to splitting name
  const firstName = (payload.first_name || inviteeName.split(/\s+/)[0] || 'there').trim();

  if (!inviteeEmail) {
    console.warn('invitee.created with no email — skipping.');
    return res.status(200).json({ ok: true, skipped: 'no_email' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
  );

  const nowIso = new Date().toISOString();

  // 4. Check if we've already sent the deck to this email. Either way, stamp
  //    booked_at so the funnel's "Bookings" metric counts this booking.
  const { data: existing } = await supabase
    .from('deck_requests')
    .select('id, booked_at')
    .eq('email', inviteeEmail)
    .limit(1)
    .maybeSingle();

  // 4b. Always log a prospect_interactions row so the booking surfaces on
  //     /admin?view=interactions alongside the funnel view. Idempotent via
  //     the unique (source, external_id) index when the same invitee URI
  //     fires twice (Calendly retries occasionally).
  const inviteeUri = payload.uri || null;
  const eventName  = payload.scheduled_event?.name || 'Calendly meeting';
  const startTime  = payload.scheduled_event?.start_time || null;
  const eventUri   = payload.scheduled_event?.uri || null;

  const interactionNotes = [
    `Booked: ${eventName}`,
    startTime
      ? `Start: ${new Date(startTime).toLocaleString('en-US', {
          timeZone: 'America/Los_Angeles',
          dateStyle: 'medium',
          timeStyle: 'short'
        })} PT`
      : null
  ].filter(Boolean).join('\n');

  // Fire-and-forget — interaction logging shouldn't fail the webhook.
  try {
    const { error: ixErr } = await supabase
      .from('prospect_interactions')
      .insert({
        first_name: firstName,
        email: inviteeEmail,
        direction: 'inbound',           // they reached out by scheduling
        method: 'phone',                // the booked meeting type
        subject: `Calendly booking — ${eventName}`,
        notes: interactionNotes,
        external_id: inviteeUri,
        external_url: eventUri,
        source: 'calendly'
      });
    if (ixErr && ixErr.code !== '23505') {
      console.warn('prospect_interactions insert error:', ixErr);
    }
  } catch (e) {
    console.warn('prospect_interactions threw:', e);
  }

  // 4c. Lead handling.
  //     - If a lead exists and is still on the first step ('submitted_homepage'),
  //       advance it to 'booked_call' (forward-only — never roll a lead back).
  //     - If NO lead exists, the person booked cold (a deck link, the FAQ page,
  //       a partner referral) and would otherwise never enter the main lead
  //       pipeline — only prospect_interactions/deck_requests. Create a lead at
  //       'booked_call' so the booking is tracked end to end.
  try {
    const { data: existingLead } = await supabase
      .from('leads')
      .select('id, status')
      .ilike('email', inviteeEmail)
      .maybeSingle();
    if (existingLead) {
      if (existingLead.status === 'submitted_homepage') {
        await supabase
          .from('leads')
          .update({ status: 'booked_call' })
          .eq('id', existingLead.id);
      }
    } else {
      const leadFirst = inviteeName.split(/\s+/)[0] || inviteeEmail.split('@')[0] || 'Unknown';
      const leadLast = inviteeName.split(/\s+/).slice(1).join(' ');
      const { error: leadErr } = await supabase.from('leads').insert({
        first_name: leadFirst,
        last_name: leadLast || '',
        email: inviteeEmail,
        phone: extractCalendlyPhone(payload),
        status: 'booked_call',
        import_source: 'calendly_booking'
      });
      if (leadErr) console.warn('calendly lead auto-create failed (non-fatal):', leadErr.message);
    }
  } catch (e) {
    console.warn('lead create/bump failed:', e);
  }

  if (existing) {
    // Already had the deck — just record that they booked (or re-booked).
    // Don't re-send the prep email; they have it already.
    await supabase
      .from('deck_requests')
      .update({ booked_at: nowIso })
      .eq('id', existing.id);
    return res.status(200).json({ ok: true, action: 'booking_recorded', invitee: inviteeEmail });
  }

  // 5. Record + send the deck email. This branch only fires when the booker
  //    has never seen the deck, so booked_at = created_at effectively.
  await supabase.from('deck_requests').insert({
    first_name: firstName,
    email: inviteeEmail,
    disclaimer_accepted: true,  // Booking implies engagement consent
    source: 'calendly_book',
    user_agent: 'calendly-webhook',
    booked_at: nowIso
  });

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: FROM,
      to: [inviteeEmail],
      subject: 'Quick prep for our call — the overview deck',
      html: prepEmailHtml(firstName)
    });
  } catch (emailErr) {
    console.error('Resend send error:', emailErr);
    return res.status(500).json({ error: 'Failed to send prep email' });
  }

  return res.status(200).json({ ok: true, action: 'deck_sent', invitee: inviteeEmail });
}

function prepEmailHtml(first_name) {
  return `
    <div style="font-family: -apple-system, sans-serif; max-width: 600px; line-height: 1.6; color: #0B1724;">
      <p>Hi ${escape(first_name)},</p>
      <p>Thanks for booking. <strong>If you haven't already gone through it, here's the 21-slide overview</strong> — about 10 minutes, walks through structure, year-by-year economics on a representative deal, and the questions most people ask before a first call:</p>
      <p style="margin: 24px 0;">
        <a href="${DECK_URL}" style="display: inline-block; background: #0B1724; color: white; padding: 14px 28px; text-decoration: none; font-size: 13px; letter-spacing: 0.15em; text-transform: uppercase; font-weight: 500;">View the overview →</a>
      </p>
      <p>If you've already read it, just hit reply with a quick note on what you'd like to focus on so I can come prepared. Either way, our 20-minute call will focus on your specific situation — income picture, tax position, what you're trying to accomplish.</p>
      <p>If anything urgent comes up before then, text me at <strong>(206) 755-6436</strong>.</p>
      <p style="margin-top: 32px;">— Josh Cochran<br><span style="color: #6B7280; font-size: 13px;">OwnaFleet · Cochran Management LLC</span></p>
      <hr style="border: none; border-top: 1px solid #D9DDE3; margin: 32px 0 16px;">
      <p style="font-size: 11px; color: #6B7280; font-style: italic; line-height: 1.5;">
        This material is provided for informational purposes only and does not constitute an offer to sell or a solicitation of an offer to buy any security. OwnaFleet does not offer or sell securities. Participants in the program take direct title to specific equipment through their own LLC. This communication does not constitute financial, tax, legal, investment, or accounting advice. Consult your CPA and legal advisor before participating.
      </p>
    </div>
  `;
}

// Best-effort phone from a Calendly payload: the SMS-reminder number, a custom
// "phone" question, or any answer that looks like a phone number. Returns null.
function extractCalendlyPhone(payload) {
  if (payload?.text_reminder_number) return String(payload.text_reminder_number).trim().slice(0, 40);
  const phoneRe = /(?:\+?1[\s.\-]?)?\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}/;
  for (const item of (payload?.questions_and_answers || [])) {
    const q = (item.question || '').toLowerCase();
    const a = (item.answer || '').trim();
    if (!a) continue;
    if (/phone|cell|mobile|number/.test(q) || phoneRe.test(a)) return a.slice(0, 40);
  }
  return null;
}

function escape(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
