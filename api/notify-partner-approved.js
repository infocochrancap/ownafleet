// POST /api/notify-partner-approved
// Admin-only. Called from admin.html when a partner's status changes pending -> active.
// Sends the partner their referral link, dashboard link, and commission summary.
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
  // Typical deal in the program = $1.2M of equipment.
  const typicalPayout = Math.round(1200000 * partnerEffectivePct / 100);

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: FROM,
      to: [partner.email],
      subject: 'You\'re approved — your OwnaFleet referral link',
      html: approvalEmailHtml(partner, typicalPayout)
    });
  } catch (emailErr) {
    console.error('Email send error:', emailErr);
    return res.status(500).json({ error: 'Failed to send approval email' });
  }

  return res.status(200).json({ ok: true });
}

function approvalEmailHtml(partner, typicalPayout) {
  const referralUrl = `https://ownafleet.com?ref=${encodeURIComponent(partner.referral_code)}`;
  return `
    <div style="font-family: -apple-system, sans-serif; max-width: 600px; line-height: 1.6; color: #0B1724;">
      <p>Hi ${escape(partner.first_name)},</p>
      <p>Welcome. Your partner application is approved, and your unique referral link is live:</p>
      <p style="margin: 24px 0; padding: 20px; background: #F8F7F4; border-left: 3px solid #8B6F3F;">
        <code style="font-family: 'Courier New', monospace; font-size: 14px; color: #0B1724; word-break: break-all;">${escape(referralUrl)}</code>
      </p>
      <p>Anyone who lands on the site through this link is automatically attributed to you — straight through to funding. You can see live status on your dashboard:</p>
      <p style="margin: 20px 0;">
        <a href="https://ownafleet.com/dashboard" style="display: inline-block; background: #0B1724; color: white; padding: 14px 28px; text-decoration: none; font-size: 13px; letter-spacing: 0.15em; text-transform: uppercase; font-weight: 500;">Open dashboard →</a>
      </p>
      <p>Sign in at <a href="https://ownafleet.com/login" style="color: #8B6F3F;">ownafleet.com/login</a> with this email — magic link, no password.</p>

      <h3 style="font-family: 'Times New Roman', serif; font-weight: 400; font-size: 18px; margin: 32px 0 8px; color: #0B1724;">The qualified-lead profile</h3>
      <p>Individuals with a meaningful windfall — capital gain, business sale, strong income year, or other liquidity event.</p>
      <p><strong>Lender thresholds:</strong> net worth ≥ $1M, liquid assets ≥ $200K. Anything below those usually can't be financed, so pre-filtering saves everyone time.</p>

      <h3 style="font-family: 'Times New Roman', serif; font-weight: 400; font-size: 18px; margin: 32px 0 8px; color: #0B1724;">Your referral fee</h3>
      <p><strong>Approximately $${typicalPayout.toLocaleString()}</strong> per closed deal at the program's average size ($1.2M of equipment), paid on funding.</p>
      <p style="font-size: 13px; color: #6B7280;">Larger or smaller deals scale proportionally. Your dashboard shows estimated payout per lead from day one.</p>

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
