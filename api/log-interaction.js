// POST /api/log-interaction
//
// Single entry point for writing rows into prospect_interactions.
// Accepts two auth modes so both UI clicks and external integrations can use it:
//
//   1. Authorization: Bearer <admin session token>
//      — used by /admin?view=interactions manual form
//   2. X-API-Key: <INTERACTION_LOG_API_KEY>
//      — used by Cloudflare Email Worker (and later GHL / Fathom webhooks)
//
// Body shape:
// {
//   first_name?:    string,
//   last_name?:     string,
//   email?:         string,           // either email or phone required
//   phone?:         string,
//   direction:      'inbound' | 'outbound',
//   method:         'email' | 'text' | 'phone' | 'video_call'
//                   | 'linkedin' | 'in_person' | 'other',
//   subject?:       string,           // e.g. email subject, meeting title
//   notes?:         string,           // body excerpt or free-form
//   external_id?:   string,           // dedupe key for external sources
//   external_url?:  string,           // link back (fathom recording, ghl convo)
//   source?:        string,           // see migration 010 check constraint
//   referral_source?: string
// }
//
// Idempotency: a unique index on (source, external_id) makes retries safe —
// duplicate inserts return 200 with the existing row.

import { createClient } from '@supabase/supabase-js';

const DIRECTIONS = new Set(['inbound', 'outbound']);
const METHODS = new Set(['email','text','phone','video_call','linkedin','in_person','other']);
const SOURCES = new Set(['manual','email_bcc','ghl_sms','fathom','ios_shortcut','other']);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
  );

  // ----- AUTH -----
  let loggedBy = null;
  const apiKey = req.headers['x-api-key'];
  const expectedKey = process.env.INTERACTION_LOG_API_KEY;

  if (apiKey && expectedKey && apiKey === expectedKey) {
    // Authenticated as external integration; loggedBy stays null
  } else {
    const authHeader = req.headers.authorization || '';
    const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!accessToken) return res.status(401).json({ error: 'Missing auth' });
    const { data: { user } } = await supabase.auth.getUser(accessToken);
    if (!user) return res.status(401).json({ error: 'Invalid session' });
    const { data: adminCheck } = await supabase
      .from('admins')
      .select('user_id')
      .eq('user_id', user.id)
      .maybeSingle();
    if (!adminCheck) return res.status(403).json({ error: 'Not an admin' });
    loggedBy = user.id;
  }

  // ----- VALIDATE -----
  const body = req.body || {};
  const direction = (body.direction || '').toLowerCase();
  const method = (body.method || '').toLowerCase();
  const source = (body.source || 'manual').toLowerCase();
  const email = body.email ? String(body.email).trim().toLowerCase() : null;
  const phone = body.phone ? String(body.phone).trim() : null;

  if (!DIRECTIONS.has(direction)) return res.status(400).json({ error: 'Invalid direction' });
  if (!METHODS.has(method)) return res.status(400).json({ error: 'Invalid method' });
  if (!SOURCES.has(source)) return res.status(400).json({ error: 'Invalid source' });
  if (!email && !phone) return res.status(400).json({ error: 'Need email or phone' });

  // ----- DEDUPE (when external_id is present) -----
  const externalId = body.external_id ? String(body.external_id).trim() : null;
  if (externalId) {
    const { data: existing } = await supabase
      .from('prospect_interactions')
      .select('*')
      .eq('source', source)
      .eq('external_id', externalId)
      .maybeSingle();
    if (existing) {
      return res.status(200).json({ ok: true, deduped: true, interaction: existing });
    }
  }

  // ----- INSERT -----
  const row = {
    first_name: trimOrNull(body.first_name),
    last_name:  trimOrNull(body.last_name),
    email,
    phone,
    direction,
    method,
    subject: trimOrNull(body.subject, 500),
    notes:   trimOrNull(body.notes, 5000),
    external_id: externalId,
    external_url: trimOrNull(body.external_url, 500),
    source,
    referral_source: trimOrNull(body.referral_source, 200),
    logged_by: loggedBy
  };

  const { data, error } = await supabase
    .from('prospect_interactions')
    .insert(row)
    .select()
    .single();

  if (error) {
    // 23505 = unique violation. If we lost a race on the unique (source,external_id)
    // index, re-fetch the winning row and return success.
    if (error.code === '23505' && externalId) {
      const { data: winner } = await supabase
        .from('prospect_interactions')
        .select('*')
        .eq('source', source)
        .eq('external_id', externalId)
        .maybeSingle();
      if (winner) return res.status(200).json({ ok: true, deduped: true, interaction: winner });
    }
    console.error('Insert error:', error);
    return res.status(500).json({ error: error.message });
  }

  // ----- AUTO-CREATE LEAD (when this is a new prospect) -----
  // If the interaction has an email and no matching leads row exists, create
  // a lead at the earliest funnel stage so the prospect surfaces on the
  // Leads tab. Skip when source is anything other than 'manual' (Calendly
  // webhook handles its own lead lookup/promotion; we don't want to create
  // shadow lead rows for system-generated interactions).
  let createdLead = null;
  if (email && source === 'manual') {
    try {
      const { data: existingLead } = await supabase
        .from('leads')
        .select('id')
        .ilike('email', email)
        .maybeSingle();

      if (!existingLead) {
        const { data: newLead, error: leadErr } = await supabase
          .from('leads')
          .insert({
            first_name: trimOrNull(body.first_name) || 'Unknown',
            last_name:  trimOrNull(body.last_name)  || '',
            email,
            phone: phone || '',
            import_source: 'manual_interaction',
            status: 'submitted_homepage'
          })
          .select('id')
          .single();
        if (!leadErr) createdLead = newLead;
        else console.warn('Auto-create lead failed (non-fatal):', leadErr);
      }
    } catch (e) {
      console.warn('Lead auto-create threw (non-fatal):', e);
    }
  }

  return res.status(200).json({ ok: true, interaction: data, created_lead: createdLead });
}

function trimOrNull(v, maxLen) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return maxLen ? s.slice(0, maxLen) : s;
}
