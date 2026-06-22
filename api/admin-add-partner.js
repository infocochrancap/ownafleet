// POST /api/admin-add-partner
// Owner-only fast path for onboarding friends-as-referrers.
// Skips the public /partners apply flow + pending review entirely:
//   - Creates the partner row with status='active' immediately
//   - Stamps approved_at + approved_by with the admin who clicked the button
//   - Fires the same welcome email that the manual approve-from-admin flow uses
//
// Body: { first_name, last_name, email, phone?, company?, notes? }

import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const FROM = 'OwnaFleet <leads@ownafleet.com>';
const JOSH_BASE_PCT = 2.1; // mirrors notify-partner-approved.js
const DEFAULT_SPLIT_PCT = 40;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization || '';
  const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!accessToken) return res.status(401).json({ error: 'Missing auth token' });

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
  );

  // Verify caller is an OWNER (operators can't onboard partners)
  const { data: { user } } = await supabase.auth.getUser(accessToken);
  if (!user) return res.status(401).json({ error: 'Invalid session' });
  const { data: adminRow } = await supabase
    .from('admins')
    .select('user_id, role')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!adminRow) return res.status(403).json({ error: 'Not an admin' });
  if (adminRow.role && adminRow.role !== 'owner') {
    return res.status(403).json({ error: 'Owner role required' });
  }

  const body = req.body || {};
  const first_name = (body.first_name || '').trim();
  const last_name  = (body.last_name  || '').trim();
  const email      = (body.email      || '').trim().toLowerCase();
  const phone      = (body.phone      || '').trim();
  const company    = (body.company    || '').trim() || null;
  const notes      = (body.notes      || '').trim() || null;

  if (!first_name) return res.status(400).json({ error: 'Missing first_name' });
  if (!last_name)  return res.status(400).json({ error: 'Missing last_name' });
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email' });
  }

  // Generate a referral code (name slug + 4-char random suffix)
  const baseCode = (first_name + last_name).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12);
  const suffix = Math.random().toString(36).slice(2, 6);
  const referralCode = `${baseCode}${suffix}`;

  const { data: partner, error: insertErr } = await supabase
    .from('referral_partners')
    .insert({
      first_name,
      last_name,
      email,
      phone,
      company,
      notes,
      referral_code: referralCode,
      status: 'active',
      commission_split_pct: DEFAULT_SPLIT_PCT,
      approved_at: new Date().toISOString(),
      approved_by: user.id
    })
    .select()
    .single();

  if (insertErr) {
    if (insertErr.code === '23505') {
      return res.status(400).json({ error: 'A partner with that email already exists.' });
    }
    console.error('Insert error:', insertErr);
    return res.status(500).json({ error: 'Failed to create partner' });
  }

  // Fire welcome email — sign-first, same body as notify-partner-approved.js.
  // The referral link is withheld until they e-sign at /agreement.
  const splitPct = parseFloat(partner.commission_split_pct ?? DEFAULT_SPLIT_PCT);
  const partnerEffectivePct = (JOSH_BASE_PCT * splitPct / 100);
  const typicalPayout = Math.round(1000000 * partnerEffectivePct / 100); // $1M example deal (fee scales with size)

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: FROM,
      to: [partner.email],
      subject: 'You\'re approved — one step left: sign your partner agreement',
      html: approvalEmailHtml(partner, typicalPayout)
    });
  } catch (emailErr) {
    console.error('Welcome email failed:', emailErr);
    // Partner is created; just flag the email failure to the caller
    return res.status(200).json({
      ok: true,
      partner,
      email_sent: false,
      warning: 'Partner created but welcome email failed to send.'
    });
  }

  return res.status(200).json({ ok: true, partner, email_sent: true });
}

function approvalEmailHtml(partner, typicalPayout) {
  return `
    <div style="font-family: -apple-system, sans-serif; max-width: 600px; line-height: 1.6; color: #0B1724;">
      <p>Hi ${escape(partner.first_name)},</p>
      <p>Welcome — you're set up in the OwnaFleet partner program. One step left before your referral link goes live: review and sign the referral partner agreement. It takes about two minutes.</p>
      <p style="margin: 20px 0;">
        <a href="https://ownafleet.com/agreement" style="display: inline-block; background: #0B1724; color: white; padding: 14px 28px; text-decoration: none; font-size: 13px; letter-spacing: 0.15em; text-transform: uppercase; font-weight: 500;">Review &amp; sign the agreement →</a>
      </p>
      <p>Sign in at <a href="https://ownafleet.com/login" style="color: #8B6F3F;">ownafleet.com/login</a> with this email — magic link, no password. You'll sign electronically (typed name) and get a copy for your records. The moment you sign, your unique referral link and dashboard unlock automatically.</p>

      <h3 style="font-family: 'Times New Roman', serif; font-weight: 400; font-size: 18px; margin: 32px 0 8px; color: #0B1724;">What's waiting on the other side</h3>
      <p><strong>Approximately $${typicalPayout.toLocaleString()}</strong> on a $1M deal, paid on funding (your fee scales with the deal size) — plus a dashboard that tracks every referral from intro through funding.</p>

      <p>Any questions, reply here.</p>
      <p style="margin-top: 32px;">— Josh Cochran<br><span style="color: #6B7280; font-size: 13px;">OwnaFleet · Cochran Management LLC</span></p>
      <hr style="border: none; border-top: 1px solid #D9DDE3; margin: 32px 0 16px;">
      <p style="font-size: 11px; color: #6B7280; font-style: italic; line-height: 1.5;">
        This communication is informational only and does not constitute financial, tax, legal, investment, or accounting advice.
      </p>
    </div>
  `;
}

function escape(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
