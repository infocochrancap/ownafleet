// POST /api/submit-lead
// Validates form input, writes to Supabase, sends internal notification + lead-facing email.
// Branching: leads with net_worth >= $1M AND liquidity >= $300K get the deck link.
// Below-threshold leads get a respectful decline email instead.

import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

// Required fields after the homepage form was simplified (no state/liquidity).
// state and liquidity remain in the schema (nullable per migration 012) and
// are still validated against the enum when present — they're just optional.
const REQUIRED = ['first_name', 'last_name', 'email', 'phone', 'equipment_range', 'net_worth'];

const ALLOWED = {
  equipment_range: ['$250K – $500K','$500K – $1M','$1M – $2M','$2M – $5M','Over $5M — consultation','Not sure yet'],
  net_worth: ['Under $1M','$1M – $3M','$3M – $10M','$10M – $30M','$30M+','$30M – $75M','$75M – $150M','$150M+'],
  liquidity: ['Under $200K','$200K – $1M','$1M – $3M','$3M – $10M','$10M – $25M','$25M+']
};

const FROM = 'OwnaFleet <leads@ownafleet.com>';
const DECK_URL = 'https://ownafleet.com/deck/view';
const CALENDLY_URL = 'https://calendly.com/ownafleet/intro';

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

  // Validate enum fields — but only if a value was provided (state/liquidity
  // are now optional, so we accept missing values; we just won't auto-decline
  // below threshold without complete picture).
  for (const [field, allowed] of Object.entries(ALLOWED)) {
    const v = body[field];
    if (v == null || v === '') continue; // optional
    if (!allowed.includes(v)) {
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
  if (body.referral_code) {
    const { data: partner } = await supabase
      .from('referral_partners')
      .select('id, status')
      .eq('referral_code', body.referral_code.trim())
      .eq('status', 'active')
      .maybeSingle();
    if (partner) {
      referral_partner_id = partner.id;
    }
  }

  // Insert the lead. Status starts at 'submitted_homepage' — the first
  // step in the new pipeline. Auto-bumps to 'booked_call' when the
  // Calendly webhook fires, then 'call_completed_app_sent' when the
  // admin clicks "Send Armada application".
  const submissionText = (body.notes || '').trim();
  // Sanitize import_source if client provided one (UTM attribution string).
  // Fall back to 'website_form' when nothing was supplied. Cap length to
  // prevent abuse since this field is also exposed in admin views.
  let importSource = 'website_form';
  if (typeof body.import_source === 'string' && body.import_source.trim()) {
    importSource = body.import_source.trim().slice(0, 200);
  }

  const { data: lead, error } = await supabase
    .from('leads')
    .insert({
      first_name: body.first_name.trim(),
      last_name: body.last_name.trim(),
      email: body.email.trim().toLowerCase(),
      phone: body.phone.trim(),
      state: (body.state || '').trim() || null,
      equipment_range: body.equipment_range,
      net_worth: body.net_worth,
      liquidity: body.liquidity || null,
      referral_partner_id,
      import_source: importSource,
      status: 'submitted_homepage'
    })
    .select()
    .single();

  if (error) {
    console.error('Supabase insert error:', error);
    return res.status(500).json({ error: 'Failed to save lead' });
  }

  // If the lead wrote anything in the "What you'd like to discuss" textarea,
  // capture it as the first comment on the lead. author_id is null because
  // the submission is from the public form, not from an authenticated admin.
  if (submissionText) {
    try {
      await supabase.from('lead_comments').insert({
        lead_id: lead.id,
        author_id: null,
        comment: '[From their form submission]' + '\n\n' + submissionText
      });
    } catch (commentErr) {
      console.warn('Comment insert failed (non-fatal):', commentErr);
    }
  }

  // Hard-decline ONLY the truly stuck — folks where even a right-sized smaller
  // deal won't pencil out. Per Josh: anyone above this floor can still be
  // worth a conversation, because they can adjust their equipment purchase
  // down to fit their financial picture.
  //
  // When liquidity isn't collected (simplified homepage form), we can't run
  // the full check — fall back to "qualified for review" so Josh can decide
  // manually. The hard auto-decline only fires when BOTH signals point down.
  const isBelowThreshold =
    lead.net_worth === 'Under $1M' &&
    lead.liquidity === 'Under $200K';

  // Send notification + lead-facing email — don't fail the request if email fails
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);

    // 1. Internal notification — Josh only.
    // Workflow design: website form submissions stay with Josh. Brian and Alondra
    // see qualified leads later, once the lead has booked a call AND submitted the
    // credit application on the Armada Fleet Management site — which is the trigger
    // for them to engage. Notifying them at form-submission time would be noise.
    const notifyTo = ['josh@ownafleet.com'];

    const subject = isBelowThreshold
      ? `New OwnaFleet lead [BELOW THRESHOLD]: ${lead.first_name} ${lead.last_name}`
      : `New OwnaFleet lead: ${lead.first_name} ${lead.last_name}`;

    await resend.emails.send({
      from: FROM,
      to: notifyTo,
      subject,
      html: internalNotifyHtml(lead, isBelowThreshold, submissionText)
    });

    // 2. Lead-facing email — branch on qualification
    if (isBelowThreshold) {
      await resend.emails.send({
        from: FROM,
        to: [lead.email],
        subject: 'A note on fit — equipment ownership program',
        html: declineEmailHtml(lead)
      });
    } else {
      await resend.emails.send({
        from: FROM,
        to: [lead.email],
        subject: 'Thanks for your interest — your equipment overview inside',
        html: deckDeliveryEmailHtml(lead)
      });
    }
  } catch (emailErr) {
    console.error('Email send error:', emailErr);
    // Don't fail — lead is saved
  }

  return res.status(200).json({ ok: true, lead_id: lead.id });
}

// ============== Internal notification (Brian/Alondra/Josh) ==============
function internalNotifyHtml(lead, isBelowThreshold, submissionText) {
  return `
    <div style="font-family: -apple-system, sans-serif; max-width: 600px; line-height: 1.5; color: #0B1724;">
      <h2 style="color: #0B1724; margin-bottom: 8px;">New lead — ${escape(lead.first_name)} ${escape(lead.last_name)}</h2>
      ${isBelowThreshold ? '<p style="color: #B85C3A; font-size: 13px; margin-top: 0;"><strong>BELOW THRESHOLD — auto-decline sent</strong></p>' : ''}
      <table style="border-collapse: collapse; width: 100%; margin-top: 16px;">
        <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-size: 12px; color: #6B7280; width: 40%;">EMAIL</td><td style="padding: 8px 0; border-bottom: 1px solid #eee;">${escape(lead.email)}</td></tr>
        <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-size: 12px; color: #6B7280;">PHONE</td><td style="padding: 8px 0; border-bottom: 1px solid #eee;">${escape(lead.phone)}</td></tr>
        ${lead.state ? `<tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-size: 12px; color: #6B7280;">STATE</td><td style="padding: 8px 0; border-bottom: 1px solid #eee;">${escape(lead.state)}</td></tr>` : ''}
        <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-size: 12px; color: #6B7280;">EQUIPMENT TARGET</td><td style="padding: 8px 0; border-bottom: 1px solid #eee;">${escape(lead.equipment_range)}</td></tr>
        <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-size: 12px; color: #6B7280;">NET WORTH</td><td style="padding: 8px 0; border-bottom: 1px solid #eee;">${escape(lead.net_worth)}</td></tr>
        ${lead.liquidity ? `<tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-size: 12px; color: #6B7280;">LIQUIDITY</td><td style="padding: 8px 0; border-bottom: 1px solid #eee;">${escape(lead.liquidity)}</td></tr>` : ''}
        ${submissionText ? `<tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-size: 12px; color: #6B7280; vertical-align: top;">THEY SAID</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; white-space: pre-wrap;">${escape(submissionText)}</td></tr>` : ''}
        <tr><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-size: 12px; color: #6B7280;">SOURCE</td><td style="padding: 8px 0; border-bottom: 1px solid #eee; font-family: ui-monospace, monospace; font-size: 12px;">${escape(lead.import_source || 'unknown')}</td></tr>
      </table>
      <p style="margin-top: 24px; font-size: 13px; color: #6B7280;">View in admin: <a href="https://ownafleet.com/admin">ownafleet.com/admin</a></p>
    </div>
  `;
}

// ============== Deck delivery (qualifying lead) ==============
// Sequencing: book first, then the overview unlocks. The /welcome page
// embeds Calendly and only reveals the deck once a booking confirms,
// so this email mirrors that flow rather than handing them the deck
// up front (which would short-circuit the call).
//
// The /welcome link carries prefill params so the Calendly widget on
// that page lands pre-filled — saves the lead from re-typing.
function deckDeliveryEmailHtml(lead) {
  const fullName = `${lead.first_name} ${lead.last_name}`.trim();
  const welcomeUrl =
    'https://ownafleet.com/welcome?' +
    new URLSearchParams({
      name: fullName,
      email: lead.email,
      phone: lead.phone || '',
      lead_id: lead.id
    }).toString();

  return `
    <div style="font-family: -apple-system, sans-serif; max-width: 600px; line-height: 1.6; color: #0B1724;">
      <p>Hi ${escape(lead.first_name)},</p>
      <p>Thanks for submitting your interest. Based on what you shared, this program looks like a potential fit — and I want to make sure you have everything to evaluate it carefully.</p>
      <p><strong>How it works from here:</strong></p>
      <p style="margin: 8px 0 4px;">→ Step 1: Pick a 20-minute window with me.</p>
      <p style="margin: 0 0 4px;">→ Step 2: The full 21-slide overview unlocks on that same page the moment you book — designed so our call can focus on your situation, not on the basics.</p>
      <p style="margin: 24px 0;">
        <a href="${welcomeUrl}" style="display: inline-block; background: #0B1724; color: white; padding: 14px 28px; text-decoration: none; font-size: 13px; letter-spacing: 0.15em; text-transform: uppercase; font-weight: 500;">Book your call →</a>
      </p>
      <p>No obligation, no hard pitch. If you'd rather pick a time over text, I'm at <strong>(206) 755-6436</strong> — or just reply to this email with a few windows.</p>
      <p>Looking forward to it.</p>
      <p style="margin-top: 32px;">— Josh Cochran<br><span style="color: #6B7280; font-size: 13px;">OwnaFleet · Cochran Management LLC</span></p>
      <hr style="border: none; border-top: 1px solid #D9DDE3; margin: 32px 0 16px;">
      <p style="font-size: 11px; color: #6B7280; font-style: italic; line-height: 1.5;">
        This material is provided for informational purposes only and does not constitute an offer to sell or a solicitation of an offer to buy any security. OwnaFleet does not offer or sell securities. Participants in the program take direct title to specific equipment through their own LLC. This communication does not constitute financial, tax, legal, investment, or accounting advice. Consult your CPA and legal advisor before participating.
      </p>
    </div>
  `;
}

// ============== Respectful decline (below threshold) ==============
function declineEmailHtml(lead) {
  return `
    <div style="font-family: -apple-system, sans-serif; max-width: 600px; line-height: 1.6; color: #0B1724;">
      <p>Hi ${escape(lead.first_name)},</p>
      <p>Thanks for the interest in the equipment ownership program.</p>
      <p>Based on what you shared, this program likely isn't the right fit right now — the lender's minimum financing thresholds are challenging to clear from the financial picture you described, even with a smaller starting deal.</p>
      <p>If your situation shifts in the next year or so — a strong income year, a liquidity event, an asset sale — you're welcome to circle back.</p>
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
