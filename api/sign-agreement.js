// POST /api/sign-agreement
// Click-wrap e-sign of the referral-partner agreement (ESIGN/UETA record:
// typed name + assent + timestamp + IP + user-agent + version + doc hash).
// Server renders + hashes the text itself, so the stored record reflects
// exactly what was presented — the client can't tamper with it.
//
// On success:
//  - inserts the partner_agreements audit row (unique per partner+version)
//  - stamps referral_partners.agreement_signed_at / agreement_version
//  - emails the partner a full copy of the signed agreement (durable record)
//  - sends the welcome email (referral link, lead profile, fee) — activation
//    deliverables are withheld until this moment
//  - notifies Josh
//
// Body: { signed_name (req), assent: true (req) }

import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { AGREEMENT_VERSION, JOSH_BASE_PCT, effectiveFeePct, renderAgreementHtml, agreementHash } from './_lib/agreement-text.js';

const FROM = 'OwnaFleet <leads@ownafleet.com>';
const NOTIFY = 'josh@ownafleet.com';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

  // ----- AUTH: logged-in partner -----
  const authHeader = req.headers.authorization || '';
  const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!accessToken) return res.status(401).json({ error: 'Missing auth' });
  const { data: { user } } = await supabase.auth.getUser(accessToken);
  if (!user) return res.status(401).json({ error: 'Invalid session' });

  const { data: partner } = await supabase
    .from('referral_partners')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!partner) return res.status(403).json({ error: 'Not a referral partner' });
  if (partner.status === 'rejected') return res.status(403).json({ error: 'Account not eligible' });

  // ----- VALIDATE assent -----
  const body = req.body || {};
  const signed_name = String(body.signed_name || '').trim().slice(0, 200);
  if (!signed_name || signed_name.length < 3) {
    return res.status(400).json({ error: 'Type your full legal name to sign.' });
  }
  if (body.assent !== true) {
    return res.status(400).json({ error: 'You must check the acceptance box to sign.' });
  }

  // ----- Render + hash server-side -----
  const feePct = effectiveFeePct(partner.commission_split_pct);
  const html = renderAgreementHtml(partner, feePct);
  const doc_hash = agreementHash(html);

  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
  const user_agent = String(req.headers['user-agent'] || '').slice(0, 500);

  // ----- Insert audit record (idempotent per partner+version) -----
  const { data: existing } = await supabase
    .from('partner_agreements')
    .select('id, signed_at')
    .eq('partner_id', partner.id)
    .eq('agreement_version', AGREEMENT_VERSION)
    .maybeSingle();
  if (existing) {
    return res.status(200).json({ ok: true, already_signed: true, signed_at: existing.signed_at });
  }

  const signed_at = new Date().toISOString();
  const { error: insertErr } = await supabase.from('partner_agreements').insert({
    partner_id: partner.id,
    user_id: user.id,
    agreement_version: AGREEMENT_VERSION,
    signed_name,
    signed_entity: partner.company || null,
    fee_pct: feePct,
    assent: true,
    signed_at,
    ip,
    user_agent,
    doc_hash
  });
  if (insertErr) {
    console.error('partner_agreements insert error:', insertErr);
    return res.status(500).json({ error: 'Could not record signature — try again.' });
  }

  // Stamp the partner row for cheap gating lookups
  await supabase
    .from('referral_partners')
    .update({ agreement_signed_at: signed_at, agreement_version: AGREEMENT_VERSION })
    .eq('id', partner.id);

  // ----- Emails (signature stands even if email fails) -----
  const splitPct = parseFloat(partner.commission_split_pct ?? 40);
  const typicalPayout = Math.round(1000000 * (JOSH_BASE_PCT * splitPct / 100) / 100);
  const resend = new Resend(process.env.RESEND_API_KEY);

  let email_sent = true;
  try {
    // 1. Signed copy to the partner (durable ESIGN record copy)
    await resend.emails.send({
      from: FROM,
      to: [partner.email],
      subject: 'Your signed OwnaFleet partner agreement (copy for your records)',
      html: signedCopyEmailHtml(partner, signed_name, signed_at, doc_hash, html)
    });
    // 2. Welcome email — referral link unlocks now
    await resend.emails.send({
      from: FROM,
      to: [partner.email],
      subject: 'You’re live — your OwnaFleet referral link',
      html: welcomeEmailHtml(partner, typicalPayout)
    });
  } catch (e) {
    console.error('Partner email failed:', e);
    email_sent = false;
  }

  try {
    // 3. Notify Josh
    await resend.emails.send({
      from: FROM,
      to: [NOTIFY],
      subject: `Partner agreement signed — ${partner.first_name} ${partner.last_name}`,
      html: `
        <div style="font-family: -apple-system, sans-serif; line-height: 1.6;">
          <p><strong>${esc(partner.first_name)} ${esc(partner.last_name)}</strong>${partner.company ? ' (' + esc(partner.company) + ')' : ''} signed the referral-partner agreement.</p>
          <p>Typed name: <strong>${esc(signed_name)}</strong><br>
          Version: ${AGREEMENT_VERSION}<br>
          Fee: ${feePct.toFixed(2)}% (split ${splitPct}%)<br>
          Signed: ${signed_at}<br>
          IP: ${esc(ip)}<br>
          Hash: <code style="font-size:11px;">${doc_hash}</code></p>
          <p>Their referral link + dashboard tools are now unlocked.</p>
        </div>`
    });
  } catch (e) {
    console.error('Josh notify failed:', e);
  }

  return res.status(200).json({ ok: true, signed_at, version: AGREEMENT_VERSION, email_sent });
}

function signedCopyEmailHtml(partner, signedName, signedAt, docHash, agreementHtml) {
  return `
    <div style="font-family: -apple-system, sans-serif; max-width: 680px; line-height: 1.6; color: #0B1724;">
      <p>Hi ${esc(partner.first_name)},</p>
      <p>This is your copy of the OwnaFleet referral-partner agreement you signed electronically. Keep it for your records.</p>
      <p style="margin: 20px 0; padding: 16px 20px; background: #F8F7F4; border-left: 3px solid #8B6F3F; font-size: 13px;">
        Signed by (typed): <strong>${esc(signedName)}</strong><br>
        Date &amp; time: ${esc(signedAt)} (UTC)<br>
        Agreement version: ${AGREEMENT_VERSION}<br>
        Document hash (SHA-256): <code style="font-size: 11px; word-break: break-all;">${docHash}</code>
      </p>
      <hr style="border: none; border-top: 1px solid #D9DDE3; margin: 24px 0;">
      <div style="font-size: 13px;">
        ${agreementHtml}
      </div>
      <hr style="border: none; border-top: 1px solid #D9DDE3; margin: 24px 0 12px;">
      <p style="font-size: 11px; color: #6B7280;">Questions? Reply to this email. You may request a paper copy at any time.</p>
    </div>
  `;
}

function welcomeEmailHtml(partner, typicalPayout) {
  const referralUrl = `https://ownafleet.com?ref=${encodeURIComponent(partner.referral_code)}`;
  return `
    <div style="font-family: -apple-system, sans-serif; max-width: 600px; line-height: 1.6; color: #0B1724;">
      <p>Hi ${esc(partner.first_name)},</p>
      <p>Agreement signed — you're live. Here's your unique referral link:</p>
      <p style="margin: 24px 0; padding: 20px; background: #F8F7F4; border-left: 3px solid #8B6F3F;">
        <code style="font-family: 'Courier New', monospace; font-size: 14px; color: #0B1724; word-break: break-all;">${esc(referralUrl)}</code>
      </p>
      <p>Anyone who lands on the site through this link is automatically attributed to you — straight through to funding. You can see live status on your dashboard:</p>
      <p style="margin: 20px 0;">
        <a href="https://ownafleet.com/dashboard" style="display: inline-block; background: #0B1724; color: white; padding: 14px 28px; text-decoration: none; font-size: 13px; letter-spacing: 0.15em; text-transform: uppercase; font-weight: 500;">Open dashboard →</a>
      </p>

      <h3 style="font-family: 'Times New Roman', serif; font-weight: 400; font-size: 18px; margin: 32px 0 8px; color: #0B1724;">The qualified-lead profile</h3>
      <p>Individuals with a meaningful windfall — capital gain, business sale, strong income year, or other liquidity event.</p>
      <p><strong>Lender thresholds:</strong> net worth ≥ $1M, liquid assets ≥ $200K. Anything below those usually can't be financed, so pre-filtering saves everyone time.</p>

      <h3 style="font-family: 'Times New Roman', serif; font-weight: 400; font-size: 18px; margin: 32px 0 8px; color: #0B1724;">Your referral fee</h3>
      <p><strong>Approximately $${typicalPayout.toLocaleString()}</strong> on a $1M deal, paid on funding. Your fee scales with the deal size.</p>
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

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
