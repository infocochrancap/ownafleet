// POST /api/send-nudge
// Admin-only. Called from admin.html lead detail modal.
// Sends a warm "24-hour follow-up" email to a lead who hasn't booked a call yet,
// then bumps their status to 'contacted'.
// Body: { lead_id: string }

import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const FROM = 'OwnaFleet <leads@ownafleet.com>';
const CALENDLY_URL = 'https://calendly.com/drjoshcochran/connect-about-fleet-ownership';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { lead_id } = req.body || {};
  if (!lead_id) return res.status(400).json({ error: 'Missing lead_id' });

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

  // Load the lead
  const { data: lead, error: leadErr } = await supabase
    .from('leads')
    .select('*')
    .eq('id', lead_id)
    .maybeSingle();

  if (leadErr || !lead) return res.status(404).json({ error: 'Lead not found' });

  // Bump status to 'contacted' (the SECURITY DEFINER trigger logs to history)
  const { error: updateErr } = await supabase
    .from('leads')
    .update({ status: 'contacted', status_updated_by: user.id })
    .eq('id', lead_id);

  if (updateErr) {
    console.error('Status update error:', updateErr);
    return res.status(500).json({ error: 'Failed to update lead status' });
  }

  // Send nudge email
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: FROM,
      to: [lead.email],
      subject: 'Following up — equipment overview',
      html: nudgeEmailHtml(lead)
    });
  } catch (emailErr) {
    console.error('Email send error:', emailErr);
    return res.status(500).json({ error: 'Status updated but email failed to send' });
  }

  return res.status(200).json({ ok: true });
}

function nudgeEmailHtml(lead) {
  return `
    <div style="font-family: -apple-system, sans-serif; max-width: 600px; line-height: 1.6; color: #0B1724;">
      <p>Hi ${escape(lead.first_name)},</p>
      <p>Wanted to make sure the equipment overview I sent yesterday came through ok. No rush at all — just don't want it to get lost in the shuffle.</p>
      <p>Whenever you have time, the 20-minute window link is here:</p>
      <p style="margin: 24px 0;">
        <a href="${CALENDLY_URL}" style="display: inline-block; background: #0B1724; color: white; padding: 14px 28px; text-decoration: none; font-size: 13px; letter-spacing: 0.15em; text-transform: uppercase; font-weight: 500;">Schedule a 20-min call →</a>
      </p>
      <p>Reply anytime with questions, or text me directly at <strong>(206) 755-6436</strong>.</p>
      <p style="margin-top: 32px;">— Josh Cochran<br><span style="color: #6B7280; font-size: 13px;">OwnaFleet · Cochran Management LLC</span></p>
    </div>
  `;
}

function escape(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
