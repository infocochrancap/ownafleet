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
const CALENDLY_URL = 'https://calendly.com/drjoshcochran/connect-about-fleet-ownership';

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

  // 4. Check if we've already sent the deck to this email
  const { data: existing } = await supabase
    .from('deck_requests')
    .select('id')
    .eq('email', inviteeEmail)
    .limit(1)
    .maybeSingle();

  if (existing) {
    // They've already gotten the deck — no need to spam them
    return res.status(200).json({ ok: true, action: 'deck_already_sent', invitee: inviteeEmail });
  }

  // 5. Record + send the deck email
  await supabase.from('deck_requests').insert({
    first_name: firstName,
    email: inviteeEmail,
    disclaimer_accepted: true,  // Booking implies engagement consent
    source: 'calendly_book',
    user_agent: 'calendly-webhook'
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

function escape(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
