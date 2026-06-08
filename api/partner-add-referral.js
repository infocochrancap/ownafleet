// POST /api/partner-add-referral
// Lets a logged-in, ACTIVE referral partner add a referral themselves from
// their dashboard. The lead is auto-attributed to that partner.
//
// Why a server endpoint (not a direct Supabase insert): RLS only lets partners
// READ their own leads — they can't insert. This route verifies the caller is
// an active partner (via their session) and inserts with the service key,
// stamping referral_partner_id so attribution is automatic and tamper-proof
// (the partner can't attribute a lead to someone else).
//
// Side effects: notifies Josh. Does NOT email the prospect — a partner add is
// a warm, manual registration; the prospect-facing outreach stays Josh's call
// (send from /admin) so nobody gets a surprise "book a call" blast.
//
// Body: { first_name (req), last_name?, email?, phone?, equipment_range?, note? }
// Requires first_name AND at least one of email/phone.

import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const FROM = 'OwnaFleet <leads@ownafleet.com>';
const NOTIFY = 'josh@ownafleet.com';
const EQUIPMENT_RANGES = [
  '$250K – $500K', '$500K – $1M', '$1M – $2M', '$2M – $5M',
  'Over $5M — consultation', 'Not sure yet'
];

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

  // ----- AUTH: must be a logged-in, ACTIVE partner -----
  const authHeader = req.headers.authorization || '';
  const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!accessToken) return res.status(401).json({ error: 'Missing auth' });
  const { data: { user } } = await supabase.auth.getUser(accessToken);
  if (!user) return res.status(401).json({ error: 'Invalid session' });

  const { data: partner } = await supabase
    .from('referral_partners')
    .select('id, first_name, last_name, email, referral_code, status')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!partner) return res.status(403).json({ error: 'Not a referral partner' });
  if (partner.status !== 'active') return res.status(403).json({ error: 'Partner account is not active' });

  // ----- VALIDATE -----
  const body = req.body || {};
  const first_name = trim(body.first_name);
  const last_name = trim(body.last_name);
  const email = body.email ? String(body.email).trim().toLowerCase() : null;
  const phone = body.phone ? String(body.phone).trim() : null;
  const equipment_range = trim(body.equipment_range);
  const note = trim(body.note, 2000);

  if (!first_name) return res.status(400).json({ error: 'First name is required' });
  if (!email && !phone) return res.status(400).json({ error: 'Add an email or a phone number' });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'That email doesn’t look valid' });
  if (equipment_range && !EQUIPMENT_RANGES.includes(equipment_range)) {
    return res.status(400).json({ error: 'Invalid equipment range' });
  }

  // ----- DEDUPE: don't create a second row for an email already in the system -----
  if (email) {
    const { data: existing } = await supabase
      .from('leads').select('id, referral_partner_id').ilike('email', email).maybeSingle();
    if (existing) {
      const mine = existing.referral_partner_id === partner.id;
      return res.status(200).json({
        ok: true, duplicate: true,
        message: mine
          ? 'This person is already one of your referrals.'
          : 'This person is already in our system, so we didn’t add a duplicate. Reach out to Josh if you believe it should be credited to you.'
      });
    }
  }

  // ----- INSERT (attributed to this partner) -----
  const { data: lead, error } = await supabase
    .from('leads')
    .insert({
      first_name, last_name: last_name || '',
      email, phone,
      equipment_range: equipment_range || null,
      notes: note || null,
      referral_partner_id: partner.id,
      import_source: 'partner_manual',
      status: 'submitted_homepage'
    })
    .select('id')
    .single();

  if (error) {
    console.error('partner-add-referral insert error:', error);
    return res.status(500).json({ error: 'Could not save the referral' });
  }

  // ----- NOTIFY Josh (best-effort) -----
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const who = `${first_name} ${last_name || ''}`.trim();
    const partnerName = `${partner.first_name} ${partner.last_name || ''}`.trim();
    await resend.emails.send({
      from: FROM,
      to: [NOTIFY],
      subject: `New partner referral — ${who}`,
      html: `
        <div style="font-family:-apple-system,sans-serif;max-width:600px;line-height:1.6;color:#0B1724;">
          <p><strong>${esc(partnerName)}</strong> (partner code <strong>${esc(partner.referral_code)}</strong>) just added a referral from their dashboard:</p>
          <ul style="line-height:1.8;">
            <li><strong>Name:</strong> ${esc(who)}</li>
            ${email ? `<li><strong>Email:</strong> ${esc(email)}</li>` : ''}
            ${phone ? `<li><strong>Phone:</strong> ${esc(phone)}</li>` : ''}
            ${equipment_range ? `<li><strong>Equipment:</strong> ${esc(equipment_range)}</li>` : ''}
            ${note ? `<li><strong>Note:</strong> ${esc(note)}</li>` : ''}
          </ul>
          <p style="font-size:13px;color:#6B7280;">Lead created at status “Submitted on Homepage.” No email was sent to the prospect — outreach is yours to start from /admin.</p>
        </div>`
    });
  } catch (e) {
    console.warn('partner-add-referral notify failed (non-fatal):', e.message);
  }

  return res.status(200).json({ ok: true, lead_id: lead.id });
}

function trim(v, max = 200) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.slice(0, max);
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
