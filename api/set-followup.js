// POST /api/set-followup
// Admin-only. Sets / clears a follow-up track on a lead and schedules the
// next touch. Called from the lead modal and the Follow-ups queue (Snooze).
//
// Body:
// {
//   lead_id:          string (required),
//   track:            'none' | 'interested_no_app' | 'with_accountant'
//                     | 'too_early' | 'past_customer'   (required),
//   next_followup_at: ISO string | null   (optional — if omitted and track
//                                            != none, a calendar-aware default
//                                            is computed),
//   paused:           boolean              (optional),
//   note:             string               (optional — added as a lead comment)
// }

import { createClient } from '@supabase/supabase-js';
import { nextFollowupDate } from './_lib/followup-cadence.js';

const TRACKS = new Set(['none', 'interested_no_app', 'with_accountant', 'too_early', 'past_customer']);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { lead_id, track, next_followup_at, paused, note } = req.body || {};
  if (!lead_id) return res.status(400).json({ error: 'Missing lead_id' });
  if (!TRACKS.has(track)) return res.status(400).json({ error: 'Invalid track' });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);

  // ----- AUTH (admin session) -----
  const authHeader = req.headers.authorization || '';
  const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!accessToken) return res.status(401).json({ error: 'Missing auth' });
  const { data: { user } } = await supabase.auth.getUser(accessToken);
  if (!user) return res.status(401).json({ error: 'Invalid session' });
  const { data: adminCheck } = await supabase
    .from('admins').select('user_id').eq('user_id', user.id).maybeSingle();
  if (!adminCheck) return res.status(403).json({ error: 'Not an admin' });

  // ----- BUILD UPDATE -----
  const update = {
    followup_track: track,
    followup_paused: paused === true
  };

  if (track === 'none') {
    update.next_followup_at = null;
    update.followup_paused = false;
  } else if (next_followup_at !== undefined) {
    // Explicit date from the picker (may be null to clear).
    update.next_followup_at = next_followup_at;
  } else {
    // No date supplied — compute a calendar-aware default.
    const { data: existing } = await supabase
      .from('leads').select('followup_count').eq('id', lead_id).maybeSingle();
    update.next_followup_at = nextFollowupDate(track, new Date(), existing?.followup_count || 0).toISOString();
  }

  const { data: lead, error } = await supabase
    .from('leads').update(update).eq('id', lead_id).select().single();

  if (error) {
    console.error('set-followup update error:', error);
    return res.status(500).json({ error: error.message });
  }

  // Optional note → lead comment (attributed to the admin).
  if (note && String(note).trim()) {
    try {
      await supabase.from('lead_comments').insert({
        lead_id, author_id: user.id, comment: String(note).trim()
      });
    } catch (e) {
      console.warn('set-followup note insert failed (non-fatal):', e.message);
    }
  }

  return res.status(200).json({ ok: true, lead });
}
