// POST /api/notify-status-change
// Called from admin.html after a lead status changes.
// Verifies the caller is an admin, then emails the referring partner (if any).
// Body: { lead_id: string, new_status: string }

import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const FROM = 'OwnaFleet <leads@ownafleet.com>';

const STATUS_LABEL = {
  new: 'New',
  contacted: 'Contacted',
  application_started: 'Application Started',
  documents_uploaded: 'Documents Uploaded',
  approved: 'Approved',
  funded: 'Funded',
  closed_won: 'Closed Won',
  dead: 'Dead'
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { lead_id, new_status } = req.body || {};
  if (!lead_id || !new_status) return res.status(400).json({ error: 'Missing lead_id or new_status' });

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

  // Load the lead + its partner (if any)
  const { data: lead, error: leadErr } = await supabase
    .from('leads')
    .select('*, referral_partners(first_name, email, commission_split_pct)')
    .eq('id', lead_id)
    .maybeSingle();

  if (leadErr || !lead) return res.status(404).json({ error: 'Lead not found' });

  // No partner attached → no notification needed
  if (!lead.referral_partners) return res.status(200).json({ ok: true, notified: false });

  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: FROM,
      to: [lead.referral_partners.email],
      subject: `Status update: ${lead.first_name} ${lead.last_name} → ${STATUS_LABEL[new_status]}`,
      html: statusEmailHtml(lead, new_status)
    });
  } catch (emailErr) {
    console.error('Email send error:', emailErr);
    return res.status(500).json({ error: 'Failed to send notification' });
  }

  return res.status(200).json({ ok: true, notified: true });
}

function statusEmailHtml(lead, newStatus) {
  const partner = lead.referral_partners;
  return `
    <div style="font-family: -apple-system, sans-serif; max-width: 600px; line-height: 1.6; color: #0B1724;">
      <p>${escape(partner.first_name)},</p>
      <p>Quick update on one of your referrals:</p>
      <div style="background: #F8F7F4; padding: 20px 24px; margin: 20px 0; border-left: 3px solid #8B6F3F;">
        <div style="font-size: 11px; letter-spacing: 0.2em; color: #6B7280; text-transform: uppercase; margin-bottom: 6px;">${escape(lead.first_name)} ${escape(lead.last_name)}</div>
        <div style="font-family: 'Times New Roman', serif; font-size: 22px; color: #0B1724;">Status: <strong style="color: #8B6F3F;">${escape(STATUS_LABEL[newStatus] || newStatus)}</strong></div>
      </div>
      <p style="font-size: 13px; color: #6B7280;">View full details and pipeline on your dashboard:</p>
      <p><a href="https://ownafleet.com/dashboard" style="color: #8B6F3F;">ownafleet.com/dashboard</a></p>
      <p style="margin-top: 32px;">— Josh Cochran<br><span style="color: #6B7280; font-size: 13px;">OwnaFleet · Cochran Management LLC</span></p>
    </div>
  `;
}

function escape(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
