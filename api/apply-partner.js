// POST /api/apply-partner
// Public endpoint — anyone can apply. Creates a referral_partners row in 'pending' status.
// Notifies Josh of the application. Partner gets approved manually via /admin.

import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { checkAbuse } from './_lib/abuse-check.js';

const REQUIRED = ['first_name', 'last_name', 'email', 'phone', 'notes'];
const FROM = 'OwnaFleet <leads@ownafleet.com>';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body || {};

  // Honeypot + per-IP rate limit
  const abuse = checkAbuse(req, body);
  if (!abuse.ok) {
    if (abuse.silent) {
      console.warn('apply-partner abuse-check:', abuse.reason);
      return res.status(abuse.status).json({ ok: true });
    }
    return res.status(abuse.status).json({ error: abuse.error });
  }

  for (const f of REQUIRED) {
    if (!body[f] || typeof body[f] !== 'string' || !body[f].trim()) {
      return res.status(400).json({ error: `Missing field: ${f}` });
    }
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
    return res.status(400).json({ error: 'Invalid email' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
  );

  // Generate a referral code from first+last name + random suffix
  const baseCode = (body.first_name + body.last_name).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12);
  const suffix = Math.random().toString(36).slice(2, 6);
  const referralCode = `${baseCode}${suffix}`;

  const { data: partner, error } = await supabase
    .from('referral_partners')
    .insert({
      email: body.email.trim().toLowerCase(),
      first_name: body.first_name.trim(),
      last_name: body.last_name.trim(),
      phone: body.phone.trim(),
      company: (body.company || '').trim() || null,
      notes: body.notes.trim(),
      referral_code: referralCode,
      status: 'pending',
      commission_split_pct: 40.00
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      return res.status(400).json({ error: 'An application already exists for that email. Check your inbox or contact josh@ownafleet.com.' });
    }
    console.error('Supabase insert error:', error);
    return res.status(500).json({ error: 'Failed to submit application' });
  }

  // Notify Josh of the new application
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const adminEmails = (process.env.ADMIN_NOTIFY_EMAILS || 'josh@ownafleet.com').split(',').map(s => s.trim()).filter(Boolean);

    await resend.emails.send({
      from: FROM,
      to: adminEmails,
      subject: `New partner application: ${partner.first_name} ${partner.last_name}`,
      html: applicationEmailHtml(partner)
    });

    // Confirmation to applicant
    await resend.emails.send({
      from: FROM,
      to: [partner.email],
      subject: 'Your OwnaFleet partner application — received',
      html: applicantEmailHtml(partner)
    });
  } catch (emailErr) {
    console.error('Email send error:', emailErr);
    // Don't fail — record is saved
  }

  return res.status(200).json({ ok: true, partner_id: partner.id });
}

function applicationEmailHtml(p) {
  return `
    <div style="font-family: -apple-system, sans-serif; max-width: 600px; line-height: 1.5; color: #0B1724;">
      <h2 style="color: #0B1724; margin-bottom: 8px;">New partner application — ${escape(p.first_name)} ${escape(p.last_name)}</h2>
      <p style="color: #6B7280; font-size: 13px; margin-top: 0;">Status: <strong>PENDING REVIEW</strong></p>
      <table style="border-collapse: collapse; width: 100%; margin-top: 16px;">
        <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-size: 12px; color: #6B7280; width: 40%;">EMAIL</td><td style="padding: 8px 0; border-bottom: 1px solid #eee;">${escape(p.email)}</td></tr>
        <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-size: 12px; color: #6B7280;">PHONE</td><td style="padding: 8px 0; border-bottom: 1px solid #eee;">${escape(p.phone)}</td></tr>
        <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-size: 12px; color: #6B7280;">COMPANY</td><td style="padding: 8px 0; border-bottom: 1px solid #eee;">${escape(p.company || '—')}</td></tr>
        <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-size: 12px; color: #6B7280; vertical-align: top;">ABOUT</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; white-space: pre-wrap;">${escape(p.notes)}</td></tr>
        <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-size: 12px; color: #6B7280;">REFERRAL CODE</td><td style="padding: 8px 0; border-bottom: 1px solid #eee;"><code>${escape(p.referral_code)}</code></td></tr>
      </table>
      <p style="margin-top: 24px; font-size: 13px;"><a href="https://ownafleet.com/admin?view=partners">Review & approve in admin →</a></p>
    </div>
  `;
}

function applicantEmailHtml(p) {
  return `
    <div style="font-family: -apple-system, sans-serif; max-width: 600px; line-height: 1.6; color: #0B1724;">
      <p>${escape(p.first_name)},</p>
      <p>Thanks for applying to the OwnaFleet partner program. Your application is under review — we typically respond within 1–2 business days.</p>
      <p>Once approved, you'll receive a separate email with a sign-in link and access to your partner dashboard, where you can:</p>
      <ul>
        <li>Get your unique referral link to share</li>
        <li>Submit referrals manually</li>
        <li>Track each referral through the pipeline in real-time</li>
        <li>See estimated and earned commission per deal</li>
      </ul>
      <p>Questions in the meantime? Just reply to this email or reach me at <strong>(206) 755-6436</strong>.</p>
      <p style="margin-top: 32px;">— Josh Cochran<br><span style="color: #6B7280; font-size: 13px;">OwnaFleet · Cochran Management LLC</span></p>
    </div>
  `;
}

function escape(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
