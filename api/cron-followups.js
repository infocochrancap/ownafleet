// GET /api/cron-followups
//
// The SINGLE follow-up engine (replaces the old cron-nudges auto-drip).
// Scheduled daily in vercel.json. Two passes, both flowing into ONE Outbox
// (followup_drafts) with per-type send-mode control (followup_settings):
//
//   PASS 1 — CONVERSATION TRACKS (Josh-set, recurring, calendar-aware):
//     interested_no_app · with_accountant · too_early · past_customer
//     Fires when a lead's next_followup_at comes due.
//
//   PASS 2 — FUNNEL-STAGE NUDGES (auto-detected from website actions, one-shot;
//     these are the three the old cron-nudges sent, same copy):
//       no_book     — got the deck 3+ days ago, never booked
//       no_app      — booked 2+ days ago, no application
//       stalled_app — application started/incomplete 5+ days, no progress
//     Only fires for leads NOT on a conversation track (followup_track='none')
//     — the moment Josh puts someone on a track, the new system owns them, so
//     no prospect ever gets both a funnel nudge and a track email.
//
// SEND MODE per type: 'draft' → insert into the Outbox for Josh to approve;
// 'auto' → send now + log + (conversation tracks) advance the next touch.
// Funnel nudges are one-shot: their migration-009 stamp is set when the draft
// is created (or auto-sent), so they're produced at most once per prospect.
//
// Auth: Vercel injects `Authorization: Bearer <CRON_SECRET>` on scheduled runs.

import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { buildFollowupEmail, nextFollowupDate, calendarContext, CONVERSATION_TRACKS } from './_lib/followup-cadence.js';

const FROM = 'OwnaFleet <leads@ownafleet.com>';
const SKIP_STATUSES = new Set(['dead', 'archived']);

// Statuses meaning the lead has already moved past the deck/booking/app phase
// (so they shouldn't get no_book / no_app nudges). Current + legacy.
const PAST_APP_STATUSES = new Set([
  'call_completed_app_sent', 'application_submitted', 'incomplete_application',
  'credit_review', 'in_progress', 'prelim_approved', 'bank_approved',
  'closing', 'funded_enrolled',
  'application_sent', 'mini_app_submitted', 'full_app_submitted',
  'approved', 'terms_accepted', 'funded', 'operating',
  'application_started', 'documents_uploaded', 'closed_won'
]);

export default async function handler(req, res) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.error('CRON_SECRET not set — refusing to run.');
    return res.status(500).json({ error: 'CRON_SECRET not configured' });
  }
  const got = (req.headers.authorization || '').replace(/^Bearer\s+/, '');
  if (got !== expected) return res.status(401).json({ error: 'Unauthorized' });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
  const resend = new Resend(process.env.RESEND_API_KEY);

  const { data: settingsRows } = await supabase.from('followup_settings').select('followup_type, send_mode');
  const sendMode = new Map((settingsRows || []).map(s => [s.followup_type, s.send_mode]));
  const modeFor = (t) => sendMode.get(t) || 'draft';

  const ctx = calendarContext().context;
  const now = Date.now();
  const summary = {
    tracks:  { drafted: 0, auto_sent: 0, skipped: 0, errors: 0 },
    no_book: { drafted: 0, auto_sent: 0, errors: 0 },
    no_app:  { drafted: 0, auto_sent: 0, errors: 0 },
    stalled: { drafted: 0, auto_sent: 0, errors: 0 }
  };

  // Emit one follow-up: draft → Outbox, or auto → send + log.
  // Returns 'drafted' | 'sent' | 'exists' | 'error'.
  async function emit(type, lead, toEmail) {
    const { subject, html } = buildFollowupEmail(type, { first_name: lead.first_name });
    const mode = modeFor(type);
    try {
      if (mode === 'auto') {
        await resend.emails.send({ from: FROM, to: [toEmail], subject, html });
        await logInteraction(supabase, toEmail, lead.first_name, type);
        return 'sent';
      }
      const { error } = await supabase.from('followup_drafts').insert({
        lead_id: lead.id, followup_type: type, to_email: toEmail,
        subject, body_html: html, calendar_context: ctx
      });
      if (error) { if (error.code === '23505') return 'exists'; throw error; }
      return 'drafted';
    } catch (e) {
      console.error(`emit ${type} failed for`, lead.id, e.message);
      return 'error';
    }
  }

  // ============================================================
  // PASS 1 — Conversation tracks
  // ============================================================
  {
    const { data: due } = await supabase
      .from('leads')
      .select('id, first_name, email, status, followup_track, followup_count')
      .neq('followup_track', 'none')
      .eq('followup_paused', false)
      .not('next_followup_at', 'is', null)
      .lte('next_followup_at', new Date().toISOString());

    for (const lead of (due || [])) {
      if (!lead.email || SKIP_STATUSES.has(lead.status)) { summary.tracks.skipped += 1; continue; }
      const r = await emit(lead.followup_track, lead, lead.email);
      if (r === 'sent') {
        summary.tracks.auto_sent += 1;
        await advanceLead(supabase, lead);          // recurring cadence
      } else if (r === 'drafted') {
        summary.tracks.drafted += 1;                // date advances when Josh sends/skips
      } else if (r === 'error') {
        summary.tracks.errors += 1;
      } else {
        summary.tracks.skipped += 1;                // 'exists' — draft already pending
      }
    }
  }

  // ============================================================
  // PASS 2 — Funnel-stage one-shot nudges (leads NOT on a track)
  // ============================================================
  const { data: allLeads } = await supabase
    .from('leads')
    .select('id, email, status, first_name, followup_track');
  const leadByEmail = new Map();
  for (const l of (allLeads || [])) {
    if (!l.email) continue;
    leadByEmail.set(l.email.toLowerCase(), l);
  }
  const onTrack = (lead) => lead && lead.followup_track && lead.followup_track !== 'none';

  // ---- NO_BOOK: deck requested 3+ days ago, never booked ----
  {
    const cutoff = new Date(now - 3 * 86400000).toISOString();
    const { data: cands } = await supabase
      .from('deck_requests')
      .select('id, email, first_name')
      .lt('created_at', cutoff).is('booked_at', null).is('nudge_no_book_sent_at', null);
    for (const c of (cands || [])) {
      const lead = leadByEmail.get((c.email || '').toLowerCase());
      if (onTrack(lead)) continue;
      if (lead && (PAST_APP_STATUSES.has(lead.status) || SKIP_STATUSES.has(lead.status))) continue;
      if (lead && lead.status === 'booked_call') continue;
      const r = await emit('no_book', lead || { id: lead?.id, first_name: c.first_name }, c.email);
      if (r === 'sent') summary.no_book.auto_sent += 1;
      else if (r === 'drafted') summary.no_book.drafted += 1;
      else if (r === 'error') { summary.no_book.errors += 1; continue; }
      // stamp one-shot (created or sent or already-exists)
      await supabase.from('deck_requests').update({ nudge_no_book_sent_at: new Date().toISOString() }).eq('id', c.id);
    }
  }

  // ---- NO_APP: booked 2+ days ago, no application ----
  {
    const cutoff = new Date(now - 2 * 86400000).toISOString();
    const { data: cands } = await supabase
      .from('deck_requests')
      .select('id, email, first_name')
      .not('booked_at', 'is', null).lt('booked_at', cutoff).is('nudge_no_app_sent_at', null);
    for (const c of (cands || [])) {
      const lead = leadByEmail.get((c.email || '').toLowerCase());
      if (onTrack(lead)) continue;
      if (lead && (PAST_APP_STATUSES.has(lead.status) || SKIP_STATUSES.has(lead.status))) continue;
      const r = await emit('no_app', lead || { id: lead?.id, first_name: c.first_name }, c.email);
      if (r === 'sent') summary.no_app.auto_sent += 1;
      else if (r === 'drafted') summary.no_app.drafted += 1;
      else if (r === 'error') { summary.no_app.errors += 1; continue; }
      await supabase.from('deck_requests').update({ nudge_no_app_sent_at: new Date().toISOString() }).eq('id', c.id);
    }
  }

  // ---- STALLED_APP: application started/incomplete 5+ days, no progress ----
  {
    const cutoff = new Date(now - 5 * 86400000).toISOString();
    const { data: cands } = await supabase
      .from('leads')
      .select('id, email, first_name, status, followup_track')
      .in('status', ['application_submitted', 'incomplete_application', 'mini_app_submitted'])
      .lt('status_updated_at', cutoff).is('nudge_stalled_sent_at', null);
    for (const lead of (cands || [])) {
      if (onTrack(lead) || !lead.email) continue;
      const r = await emit('stalled_app', lead, lead.email);
      if (r === 'sent') summary.stalled.auto_sent += 1;
      else if (r === 'drafted') summary.stalled.drafted += 1;
      else if (r === 'error') { summary.stalled.errors += 1; continue; }
      await supabase.from('leads').update({ nudge_stalled_sent_at: new Date().toISOString() }).eq('id', lead.id);
    }
  }

  console.log('cron-followups summary:', JSON.stringify(summary));
  return res.status(200).json({ ok: true, summary });
}

async function logInteraction(supabase, email, firstName, type) {
  try {
    await supabase.from('prospect_interactions').insert({
      first_name: firstName, email,
      direction: 'outbound', method: 'email',
      subject: `Follow-up (${type})`, notes: `Automated follow-up (${type})`,
      source: 'followup'
    });
  } catch (e) { console.warn('logInteraction failed (non-fatal):', e.message); }
}

async function advanceLead(supabase, lead) {
  const track = lead.followup_track;
  if (!CONVERSATION_TRACKS.has(track)) return;
  const next = nextFollowupDate(track, new Date(), (lead.followup_count || 0) + 1);
  await supabase.from('leads').update({
    last_followup_at: new Date().toISOString(),
    next_followup_at: next.toISOString(),
    followup_count: (lead.followup_count || 0) + 1
  }).eq('id', lead.id);
}
