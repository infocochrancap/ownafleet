// POST /api/notify-partner-approved
// Admin-only. Called from admin.html when a partner's status changes pending -> active.
// Sends the "approved — sign your agreement" email. The referral link and the
// full welcome email are withheld until the partner e-signs at /agreement
// (sent by /api/sign-agreement). If the partner already signed the current
// agreement version, this falls through to the full welcome email instead.
// Body: { partner_id: string }

import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const FROM = 'OwnaFleet <leads@ownafleet.com>';

// Josh's affiliate share is 2.1% of equipment purchase.
// Partner's slice = JOSH_BASE_PCT * partner.commission_split_pct / 100.
// e.g., 2.1% * 40% = 0.84%
const JOSH_BASE_PCT = 2.1;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { partner_id } = req.body || {};
  if (!partner_id) return res.status(400).json({ error: 'Missing partner_id' });

  const authHeader = req.headers.authorization || '';
  const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!accessToken) return res.status(401).json({ error: 'Missing auth token' });

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
  );

  // Verify caller is an admin
  const { data: { user } } = await supabase.auth.getUser(accessToken);
  if (!user) return res.status(401).json({ error: 'Invalid session' });

  const { data: adminCheck } = await supabase
    .from('admins')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!adminCheck) return res.status(403).json({ error: 'Not an admin' });

  // Load the partner
  const { data: partner, error: partnerErr } = await supabase
    .from('referral_partners')
    .select('*')
    .eq('id', partner_id)
    .maybeSingle();

  if (partnerErr || !partner) return res.status(404).json({ error: 'Partner not found' });

  // Compute partner's typical-deal payout in dollars (no underlying % exposed
  // to the partner — per Josh's positioning to avoid split-negotiation anchoring).
  // partner.commission_split_pct is the partner's % of Josh's 2.1% affiliate fee.
  // e.g., 40 -> 0.84% of equipment purchase. Default for new partners is 40.
  const splitPct = parseFloat(partner.commission_split_pct ?? 40);
  const partnerEffectivePct = (JOSH_BASE_PCT * splitPct / 100); // for internal use only
  // Use a $1M example deal for consistency with the rest of the site (fee scales with size).
  const typicalPayout = Math.round(1000000 * partnerEffectivePct / 100);

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: FROM,
      to: [partner.email],
      subject: 'You\'re approved — one step left: sign your partner agreement',
      html: signFirstEmailHtml(partner, typicalPayout)
    });
  } catch (emailErr) {
    console.error('Email send error:', emailErr);
    return res.status(500).json({ error: 'Failed to send approval email' });
  }

  return res.status(200).json({ ok: true });
}

function signFirstEmailHtml(partner, typicalPayout) {
  return `
    <div style="font-family: -apple-system, sans-serif; max-width: 600px; line-height: 1.6; color: #0B1724;">
      <p>Hi ${escape(partner.first_name)},</p>
      <p>Welcome — your partner application is approved. One step left before your referral link goes live: review and sign the referral partner agreement. It takes about two minutes.</p>
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
