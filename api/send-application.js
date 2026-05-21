// POST /api/send-application
// Admin-only. Called from admin.html lead detail modal.
// Sends the Armada application link to the lead and bumps status to 'application_sent'.
// Body: { lead_id: string }

import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const FROM = 'OwnaFleet <leads@ownafleet.com>';

// The Armada Commercial Credit Application now lives on ownafleet.com,
// embedded inside an OwnaFleet-branded wrapper page that keeps the
// applicant inside our experience while Bevel Financial processes
// the underlying form. Override via env var if the URL ever moves.
const ARMADA_APPLICATION_URL = process.env.ARMADA_APPLICATION_URL ||
  'https://ownafleet.com/apply';

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

  // Bump status to 'call_completed_app_sent' (the trigger logs to lead_status_history)
  const { error: updateErr } = await supabase
    .from('leads')
    .update({ status: 'call_completed_app_sent', status_updated_by: user.id })
    .eq('id', lead_id);

  if (updateErr) {
    console.error('Status update error:', updateErr);
    return res.status(500).json({ error: 'Failed to update lead status' });
  }

  // Send application email
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: FROM,
      to: [lead.email],
      subject: 'Your next step — application link inside',
      html: applicationEmailHtml(lead)
    });
  } catch (emailErr) {
    console.error('Email send error:', emailErr);
    return res.status(500).json({ error: 'Status updated but email failed to send' });
  }

  return res.status(200).json({ ok: true });
}

function applicationEmailHtml(lead) {
  return `
    <div style="font-family: -apple-system, sans-serif; max-width: 600px; line-height: 1.6; color: #0B1724;">
      <p>Hi ${escape(lead.first_name)},</p>
      <p>Great talking. As promised, here's the Armada Commercial Credit Application — powered by Bevel Financial, the program's lending partner:</p>
      <p style="margin: 24px 0;">
        <a href="${ARMADA_APPLICATION_URL}" style="display: inline-block; background: #0B1724; color: white; padding: 14px 28px; text-decoration: none; font-size: 13px; letter-spacing: 0.15em; text-transform: uppercase; font-weight: 500;">Open the application →</a>
      </p>

      <p><strong>A few things to know before you start:</strong></p>
      <ul style="line-height: 1.8;">
        <li>Under <strong>"How will you utilize this financed equipment?"</strong>, select <strong>Asset Management Program — Armada</strong>.</li>
        <li><strong>Purchase Amount</strong> is your target equipment dollar amount. If unsure on the final number, give your best estimate.</li>
        <li><strong>Active business entity?</strong> Select <strong>Yes</strong> if you already have an LLC ready to take title. Select <strong>No</strong> if you'd like us to walk you through setting one up.</li>
        <li><strong>Home Address</strong> must be a street address — no PO Boxes.</li>
        <li><strong>Supporting documents</strong> are not required upfront. You'll get a secure portal link from Bevel after submission to upload tax returns, financial statement, and entity documents at your own pace.</li>
      </ul>

      <p><strong>What to have on hand:</strong></p>
      <ul style="line-height: 1.8;">
        <li>Last two years of personal tax returns (uploaded later, not at submission)</li>
        <li>A current personal financial statement (also later)</li>
        <li>SSN, home address, ownership %</li>
      </ul>

      <p>There's no fee to apply, and applying doesn't commit you to anything. The full enrollment cycle — application through funded equipment — typically runs <strong>4–6 weeks</strong>. We'll be in touch shortly after you submit with next steps.</p>

      <p>Reach me anytime — <a href="mailto:josh@ownafleet.com" style="color:#8B6F3F;">josh@ownafleet.com</a> or <strong>(206) 755-6436</strong>.</p>
      <p style="margin-top: 32px;">— Josh Cochran<br><span style="color: #6B7280; font-size: 13px;">OwnaFleet · Cochran Management LLC</span></p>
      <hr style="border: none; border-top: 1px solid #D9DDE3; margin: 32px 0 16px;">
      <p style="font-size: 11px; color: #6B7280; font-style: italic; line-height: 1.5;">
        This communication is informational only and does not constitute financial, tax, legal, investment, or accounting advice. This is not an offer to sell or solicit any security.
      </p>
    </div>
  `;
}

function escape(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
