// POST /api/submit-lead
// Validates form input, writes to Supabase, emails Brian + Alondra + Josh.

import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const REQUIRED = ['first_name', 'last_name', 'email', 'phone', 'state', 'equipment_range', 'net_worth', 'liquidity'];

const ALLOWED = {
  equipment_range: ['$250K – $500K','$500K – $1M','$1M – $2M','$2M – $5M','$5M – $10M','$10M – $25M','$25M – $50M','$50M+','Not sure yet'],
  net_worth: ['Under $1M','$1M – $3M','$3M – $10M','$10M – $30M','$30M – $75M','$75M – $150M','$150M+'],
  liquidity: ['Under $300K','$300K – $1M','$1M – $3M','$3M – $10M','$10M – $25M','$25M+']
};

const FROM = 'OwnaFleet <leads@ownafleet.com>';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body || {};

  // Validate required fields
  for (const f of REQUIRED) {
    if (!body[f] || typeof body[f] !== 'string' || !body[f].trim()) {
      return res.status(400).json({ error: `Missing field: ${f}` });
    }
  }

  // Validate enum fields
  for (const [field, allowed] of Object.entries(ALLOWED)) {
    if (!allowed.includes(body[field])) {
      return res.status(400).json({ error: `Invalid value for ${field}` });
    }
  }

  // Basic email sanity
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
    return res.status(400).json({ error: 'Invalid email' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
  );

  // Look up referral partner if a code was provided
  let referral_partner_id = null;
  let referral_source = 'direct';
  if (body.referral_code) {
    const { data: partner } = await supabase
      .from('referral_partners')
      .select('id, status')
      .eq('referral_code', body.referral_code.trim())
      .eq('status', 'active')
      .maybeSingle();
    if (partner) {
      referral_partner_id = partner.id;
      referral_source = `partner:${body.referral_code.trim()}`;
    }
  }

  // Insert the lead
  const { data: lead, error } = await supabase
    .from('leads')
    .insert({
      first_name: body.first_name.trim(),
      last_name: body.last_name.trim(),
      email: body.email.trim().toLowerCase(),
      phone: body.phone.trim(),
      state: body.state.trim(),
      equipment_range: body.equipment_range,
      net_worth: body.net_worth,
      liquidity: body.liquidity,
      notes: (body.notes || '').trim() || null,
      referral_partner_id,
      referral_source
    })
    .select()
    .single();

  if (error) {
    console.error('Supabase insert error:', error);
    return res.status(500).json({ error: 'Failed to save lead' });
  }

  // Send notification emails — don't fail the request if email fails
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const to = (process.env.LEAD_NOTIFY_EMAILS || '').split(',').map(s => s.trim()).filter(Boolean);

    const tierEmoji = { hot: '🔥', warm: '⚡', needs_review: '👀', unqualified: '⚪' };
    const subject = `New OwnaFleet lead: ${lead.first_name} ${lead.last_name} [${lead.qualification}]`;

    if (to.length > 0) {
      await resend.emails.send({
        from: FROM,
        to,
        subject,
        html: leadEmailHtml(lead)
      });
    }

    // Confirmation email to the lead themselves
    await resend.emails.send({
      from: FROM,
      to: [lead.email],
      subject: 'Thanks for your interest — next steps',
      html: confirmationEmailHtml(lead)
    });
  } catch (emailErr) {
    console.error('Email send error:', emailErr);
    // Don't fail the response — lead is saved, that's what matters
  }

  return res.status(200).json({ ok: true, lead_id: lead.id });
}

function leadEmailHtml(lead) {
  return `
    <div style="font-family: -apple-system, sans-serif; max-width: 600px; line-height: 1.5; color: #0B1724;">
      <h2 style="color: #0B1724; margin-bottom: 8px;">New lead — ${escape(lead.first_name)} ${escape(lead.last_name)}</h2>
      <p style="color: #6B7280; font-size: 13px; margin-top: 0;">Qualification: <strong style="color: #8B6F3F;">${lead.qualification.toUpperCase()}</strong></p>
      <table style="border-collapse: collapse; width: 100%; margin-top: 16px;">
        <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-size: 12px; color: #6B7280; width: 40%;">EMAIL</td><td style="padding: 8px 0; border-bottom: 1px solid #eee;">${escape(lead.email)}</td></tr>
        <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-size: 12px; color: #6B7280;">PHONE</td><td style="padding: 8px 0; border-bottom: 1px solid #eee;">${escape(lead.phone)}</td></tr>
        <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-size: 12px; color: #6B7280;">STATE</td><td style="padding: 8px 0; border-bottom: 1px solid #eee;">${escape(lead.state)}</td></tr>
        <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-size: 12px; color: #6B7280;">EQUIPMENT TARGET</td><td style="padding: 8px 0; border-bottom: 1px solid #eee;">${escape(lead.equipment_range)}</td></tr>
        <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-size: 12px; color: #6B7280;">NET WORTH</td><td style="padding: 8px 0; border-bottom: 1px solid #eee;">${escape(lead.net_worth)}</td></tr>
        <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-size: 12px; color: #6B7280;">LIQUIDITY</td><td style="padding: 8px 0; border-bottom: 1px solid #eee;">${escape(lead.liquidity)}</td></tr>
        ${lead.notes ? `<tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-size: 12px; color: #6B7280;">NOTES</td><td style="padding: 8px 0; border-bottom: 1px solid #eee;">${escape(lead.notes)}</td></tr>` : ''}
        ${lead.referral_source && lead.referral_source !== 'direct' ? `<tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-size: 12px; color: #6B7280;">SOURCE</td><td style="padding: 8px 0; border-bottom: 1px solid #eee;">${escape(lead.referral_source)}</td></tr>` : ''}
      </table>
      <p style="margin-top: 24px; font-size: 13px; color: #6B7280;">View in admin: <a href="https://ownafleet.com/admin">ownafleet.com/admin</a></p>
    </div>
  `;
}

function confirmationEmailHtml(lead) {
  return `
    <div style="font-family: -apple-system, sans-serif; max-width: 600px; line-height: 1.6; color: #0B1724;">
      <p>${escape(lead.first_name)},</p>
      <p>Thanks for your interest in equipment ownership through OwnaFleet. Quick rundown of what happens next:</p>
      <ol style="line-height: 1.8;">
        <li>I'll review your info within 24 hours and confirm fit.</li>
        <li>Bevel Financial will email you a secure portal to start the credit application.</li>
        <li>You'll upload tax returns and supporting documents through Bevel's portal.</li>
        <li>We'll schedule a call to walk through the deal in detail.</li>
      </ol>
      <p>If you'd rather talk first, grab 20 minutes on my calendar: <a href="https://calendly.com/drjoshcochran/connect-about-fleet-ownership">calendly.com/drjoshcochran/connect-about-fleet-ownership</a></p>
      <p>Or text/call me directly: <strong>(206) 755-6436</strong></p>
      <p style="margin-top: 32px;">— Josh Cochran<br><span style="color: #6B7280; font-size: 13px;">OwnaFleet · Cochran Management LLC</span></p>
    </div>
  `;
}

function escape(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
