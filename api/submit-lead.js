// POST /api/submit-lead
// Validates form input, writes to Supabase, sends internal notification + lead-facing email.
// Branching: leads with net_worth >= $1M AND liquidity >= $300K get the deck link.
// Below-threshold leads get a respectful decline email instead.

import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const REQUIRED = ['first_name', 'last_name', 'email', 'phone', 'state', 'equipment_range', 'net_worth', 'liquidity'];

const ALLOWED = {
  equipment_range: ['$250K – $500K','$500K – $1M','$1M – $2M','$2M – $5M','Over $5M — consultation','Not sure yet'],
  net_worth: ['Under $1M','$1M – $3M','$3M – $10M','$10M – $30M','$30M – $75M','$75M – $150M','$150M+'],
  liquidity: ['Under $300K','$300K – $1M','$1M – $3M','$3M – $10M','$10M – $25M','$25M+']
};

const FROM = 'OwnaFleet <leads@ownafleet.com>';
const DECK_URL = 'https://ownafleet.com/deck/view';
const CALENDLY_URL = 'https://calendly.com/drjoshcochran/connect-about-fleet-ownership';

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

  // Qualification check — scales with deal size.
  // Lender rule: ~3x net worth and ~30% liquidity of the equipment purchase price.
  // We use the LOW end of the lead's equipment range (most charitable interpretation
  // of deal size) and the HIGH end of their net-worth + liquidity ranges
  // (most charitable interpretation of their financial picture).
  const isBelowThreshold = !meetsQualification(lead.equipment_range, lead.net_worth, lead.liquidity);

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
      : `New OwnaFleet lead: ${lead.first_name} ${lead.last_name} [${lead.qualification}]`;

    await resend.emails.send({
      from: FROM,
      to: notifyTo,
      subject,
      html: internalNotifyHtml(lead, isBelowThreshold)
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
function internalNotifyHtml(lead, isBelowThreshold) {
  return `
    <div style="font-family: -apple-system, sans-serif; max-width: 600px; line-height: 1.5; color: #0B1724;">
      <h2 style="color: #0B1724; margin-bottom: 8px;">New lead — ${escape(lead.first_name)} ${escape(lead.last_name)}</h2>
      <p style="color: #6B7280; font-size: 13px; margin-top: 0;">
        Qualification tier: <strong style="color: #8B6F3F;">${lead.qualification.toUpperCase()}</strong>
        ${isBelowThreshold ? ' &nbsp;·&nbsp; <strong style="color: #B85C3A;">BELOW THRESHOLD — auto-decline sent</strong>' : ''}
      </p>
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

// ============== Deck delivery (qualifying lead) ==============
function deckDeliveryEmailHtml(lead) {
  return `
    <div style="font-family: -apple-system, sans-serif; max-width: 600px; line-height: 1.6; color: #0B1724;">
      <p>Hi ${escape(lead.first_name)},</p>
      <p>Thanks for submitting your interest. Based on what you shared, this program looks like a potential fit — and I want to make sure you have everything to evaluate it carefully.</p>
      <p>The 21-slide overview is here:</p>
      <p style="margin: 24px 0;">
        <a href="${DECK_URL}" style="display: inline-block; background: #0B1724; color: white; padding: 14px 28px; text-decoration: none; font-size: 13px; letter-spacing: 0.15em; text-transform: uppercase; font-weight: 500;">View the overview →</a>
      </p>
      <p>It walks through structure, year-by-year economics on a representative $1M deal, what the Year-1 tax overlay can look like, and the questions I get most often before a first call.</p>
      <p>It's designed to handle the standard questions in advance, so our intro call can focus on your situation: income picture, tax position, what you're trying to accomplish.</p>
      <p>When you've had a chance to read through, grab a 20-minute window here:</p>
      <p style="margin: 20px 0;">
        <a href="${CALENDLY_URL}" style="color: #8B6F3F; border-bottom: 1px solid #8B6F3F; text-decoration: none;">${CALENDLY_URL}</a>
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
      <p>Based on what you shared, the equipment purchase amount you indicated may not pencil out against the lender's qualification thresholds (roughly 3x net worth and 30% liquidity of the purchase price). It's possible a smaller starting deal would fit — or that your picture shifts in the next quarter or two with a strong income year, a liquidity event, or an asset sale.</p>
      <p>If either of those is in view, just reply — happy to talk through what a right-sized starting deal would look like.</p>
      <p style="margin-top: 32px;">— Josh Cochran<br><span style="color: #6B7280; font-size: 13px;">OwnaFleet · Cochran Management LLC</span></p>
      <hr style="border: none; border-top: 1px solid #D9DDE3; margin: 32px 0 16px;">
      <p style="font-size: 11px; color: #6B7280; font-style: italic; line-height: 1.5;">
        This communication is informational only and does not constitute financial, tax, legal, investment, or accounting advice.
      </p>
    </div>
  `;
}

// ============== Qualification logic ==============
// Lender requires roughly 3x net worth and 30% liquidity of the equipment purchase.
// We use the LOW end of equipment range and HIGH end of NW + liquidity ranges
// (most charitable interpretation) to decide auto-disqualify.
function meetsQualification(equipment_range, net_worth, liquidity) {
  // Special-case: "Not sure yet" and "Over $5M — consultation" — assume qualifying
  // (Josh handles these manually; not an auto-decline)
  if (equipment_range === 'Not sure yet' || equipment_range === 'Over $5M — consultation') {
    return true;
  }

  // LOW end of equipment-purchase range
  const EQUIPMENT_LOW = {
    '$250K – $500K': 250000,
    '$500K – $1M':   500000,
    '$1M – $2M':     1000000,
    '$2M – $5M':     2000000
  };

  // HIGH end of net-worth range (top of stated range; Infinity for the top bracket)
  const NW_HIGH = {
    'Under $1M':       1000000,
    '$1M – $3M':       3000000,
    '$3M – $10M':      10000000,
    '$10M – $30M':     30000000,
    '$30M – $75M':     75000000,
    '$75M – $150M':    150000000,
    '$150M+':          Infinity
  };

  // HIGH end of liquidity range
  const LIQ_HIGH = {
    'Under $300K':    300000,
    '$300K – $1M':    1000000,
    '$1M – $3M':      3000000,
    '$3M – $10M':     10000000,
    '$10M – $25M':    25000000,
    '$25M+':          Infinity
  };

  const eqLow = EQUIPMENT_LOW[equipment_range];
  const nwHigh = NW_HIGH[net_worth];
  const liqHigh = LIQ_HIGH[liquidity];

  if (eqLow === undefined || nwHigh === undefined || liqHigh === undefined) {
    // Unknown bucket — don't auto-disqualify; let Josh review
    return true;
  }

  const requiredNW = eqLow * 3;
  const requiredLiq = eqLow * 0.30;

  return nwHigh >= requiredNW && liqHigh >= requiredLiq;
}

function escape(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
