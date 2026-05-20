// POST /api/send-application
// Admin-only. Called from admin.html lead detail modal.
// Sends the Armada application link to the lead and bumps status to 'application_sent'.
// Body: { lead_id: string }

import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const FROM = 'OwnaFleet <leads@ownafleet.com>';

// The Bevel Financial application is the credit-application form leads fill out.
// Bevel is the lending partner Armada works with; the same URL is used today for
// all OwnaFleet-program applicants. Override via env var if the URL ever changes
// without a deploy.
const ARMADA_APPLICATION_URL = process.env.ARMADA_APPLICATION_URL ||
  'https://bevelfinancial.com/apply-now/';
const WALKTHROUGH_PDF_URL = 'https://ownafleet.com/docs/bevel-walkthrough.pdf';

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

  // Bump status to 'application_sent' (the trigger logs to lead_status_history)
  const { error: updateErr } = await supabase
    .from('leads')
    .update({ status: 'application_sent', status_updated_by: user.id })
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
      <p>Great talking. As promised, here's the credit application with our lending partner, Bevel Financial:</p>
      <p style="margin: 24px 0;">
        <a href="${ARMADA_APPLICATION_URL}" style="display: inline-block; background: #0B1724; color: white; padding: 14px 28px; text-decoration: none; font-size: 13px; letter-spacing: 0.15em; text-transform: uppercase; font-weight: 500;">Open the application →</a>
      </p>

      <p><strong>A few things that trip people up — read these before you start:</strong></p>
      <ul style="line-height: 1.8;">
        <li><strong>Program to select:</strong> "<em>Asset Management Program — Armada</em>" in the "How will you utilize this financed equipment?" dropdown.</li>
        <li><strong>Don't have the invoice yet?</strong> Type "<em>Invoice pending from Vendor</em>" in the equipment description. We'll handle the invoice on the back end.</li>
        <li><strong>Financing Type:</strong> select <strong>Loan</strong>.</li>
        <li><strong>Equipment Cost:</strong> the dollar amount you're applying for (i.e., your target deal size).</li>
        <li><strong>Down Payment:</strong> if unsure, calculate <strong>10%</strong> of the equipment cost.</li>
        <li><strong>Home address:</strong> must be a street address — <strong>no PO Box</strong>.</li>
        <li><strong>Bank & Lending References:</strong> not required. Skip if you'd rather.</li>
      </ul>

      <p>If you want screenshots for each step, the full visual walk-through is here:</p>
      <p style="margin: 16px 0;">
        <a href="${WALKTHROUGH_PDF_URL}" style="color: #8B6F3F; border-bottom: 1px solid #8B6F3F; text-decoration: none; font-weight: 500;">Application walk-through (PDF) →</a>
      </p>

      <p><strong>What to have on hand:</strong></p>
      <ul style="line-height: 1.8;">
        <li>Last two years of personal tax returns</li>
        <li>A current personal financial statement</li>
        <li>Entity preference (existing LLC, or we can walk through setting one up)</li>
        <li>SSN and home address (you'll be asked for these)</li>
      </ul>

      <p>You'll receive a secure portal link from Bevel right after you submit, where you can upload any supporting documents. <strong>You do <em>not</em> need to upload them with the initial application.</strong></p>

      <p>There's no fee to apply, and applying doesn't commit you to anything. The lender will confirm eligibility within a few business days; once that's back, we move to deal structure.</p>

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
