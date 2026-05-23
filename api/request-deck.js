// POST /api/request-deck
// Public endpoint — anyone can request the deck.
// Saves to deck_requests, emails the link, then the frontend sets a cookie
// so the requester doesn't re-gate for 30 days.

import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { checkAbuse } from './_lib/abuse-check.js';

const FROM = 'OwnaFleet <leads@ownafleet.com>';
const DECK_URL = 'https://ownafleet.com/deck/view';
const CALENDLY_URL = 'https://calendly.com/ownafleet/intro';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body || {};

  // Honeypot + per-IP rate limit
  const abuse = checkAbuse(req, body);
  if (!abuse.ok) {
    if (abuse.silent) {
      console.warn('request-deck abuse-check:', abuse.reason);
      return res.status(abuse.status).json({ ok: true });
    }
    return res.status(abuse.status).json({ error: abuse.error });
  }

  const first_name = (body.first_name || '').trim();
  const email = (body.email || '').trim().toLowerCase();
  const disclaimer_accepted = body.disclaimer_accepted === true;
  const referral_code = (body.referral_code || '').trim() || null;

  if (!first_name) return res.status(400).json({ error: 'Missing first_name' });
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email' });
  }
  if (!disclaimer_accepted) {
    return res.status(400).json({ error: 'Please accept the disclaimer to continue' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
  );

  // Look up the referring partner if a code was provided
  let referral_partner_id = null;
  if (referral_code) {
    const { data: partner } = await supabase
      .from('referral_partners')
      .select('id, status')
      .eq('referral_code', referral_code)
      .eq('status', 'active')
      .maybeSingle();
    if (partner) referral_partner_id = partner.id;
  }

  // Capture audit trail
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
             req.headers['x-real-ip'] || null;
  const user_agent = req.headers['user-agent'] || null;

  const { error: insertErr } = await supabase
    .from('deck_requests')
    .insert({
      first_name,
      email,
      ip,
      user_agent,
      disclaimer_accepted: true,
      referral_partner_id,
      source: 'gate'
    });

  if (insertErr) {
    console.error('Supabase insert error:', insertErr);
    // Continue anyway — don't fail the request over a logging issue
  }

  // Send the deck link via Resend
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: FROM,
      to: [email],
      subject: 'Your equipment overview — as requested',
      html: deckEmailHtml(first_name)
    });
  } catch (emailErr) {
    console.error('Resend send error:', emailErr);
    return res.status(500).json({ error: 'Failed to send email. Please try again.' });
  }

  return res.status(200).json({ ok: true });
}

function deckEmailHtml(first_name) {
  return `
    <div style="font-family: -apple-system, sans-serif; max-width: 600px; line-height: 1.6; color: #0B1724;">
      <p>Hi ${escape(first_name)},</p>
      <p>Thanks for the interest. The 21-slide overview is here:</p>
      <p style="margin: 24px 0;">
        <a href="${DECK_URL}" style="display: inline-block; background: #0B1724; color: white; padding: 14px 28px; text-decoration: none; font-size: 13px; letter-spacing: 0.15em; text-transform: uppercase; font-weight: 500;">View the overview →</a>
      </p>
      <p>It walks through the structure, year-by-year economics on a representative $1M deal, what the Year-1 tax overlay can look like, and the questions I get most often before a first call.</p>
      <p>It's designed to handle the standard questions in advance, so the intro call can focus on your situation: income picture, tax position, what you're trying to accomplish.</p>
      <p>When you've had a chance to read through, grab a 20-minute window here:</p>
      <p style="margin: 20px 0;">
        <a href="${CALENDLY_URL}" style="color: #8B6F3F; border-bottom: 1px solid #8B6F3F; text-decoration: none;">${CALENDLY_URL}</a>
      </p>
      <p>No obligation, no hard pitch. If you'd rather pick a time over text, I'm at <strong>(206) 755-6436</strong> — or just reply to this email with a few windows that work for you.</p>
      <p>Looking forward to it.</p>
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
