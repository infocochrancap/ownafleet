// POST /api/send-followup
// Admin-only. Acts on a pending Outbox draft from /admin?view=followups.
//
// Body:
// {
//   draft_id:  string (required),
//   action:    'send' | 'skip'   (required),
//   subject?:  string,   // edited subject (send only) — falls back to draft's
//   body_html?: string   // edited body   (send only) — falls back to draft's
// }
//
// 'send' — emails the (possibly edited) draft, marks it sent, logs the touch
//          to the activity feed, and advances the lead's next_followup_at.
// 'skip' — marks the draft skipped and pushes the lead's next_followup_at out
//          so it resurfaces on the normal cadence instead of nagging today.

import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { nextFollowupDate, CONVERSATION_TRACKS } from './_lib/followup-cadence.js';

const FROM = 'OwnaFleet <leads@ownafleet.com>';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { draft_id, action, subject, body_html } = req.body || {};
  if (!draft_id) return res.status(400).json({ error: 'Missing draft_id' });
  if (!['send', 'skip'].includes(action)) return res.status(400).json({ error: 'Invalid action' });

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

  // ----- LOAD DRAFT -----
  const { data: draft, error: draftErr } = await supabase
    .from('followup_drafts').select('*').eq('id', draft_id).maybeSingle();
  if (draftErr || !draft) return res.status(404).json({ error: 'Draft not found' });
  if (draft.status !== 'pending') return res.status(409).json({ error: 'Draft already actioned' });

  // ----- LOAD LEAD (for cadence advance + interaction logging) -----
  const { data: lead } = await supabase
    .from('leads').select('id, first_name, followup_track, followup_count').eq('id', draft.lead_id).maybeSingle();
  const type = draft.followup_type;
  const isTrack = CONVERSATION_TRACKS.has(type);   // conversation track (recurring) vs funnel one-shot
  const nowIso = new Date().toISOString();

  if (action === 'skip') {
    await supabase.from('followup_drafts')
      .update({ status: 'skipped', skipped_at: nowIso, skipped_by: user.id })
      .eq('id', draft_id);
    // Conversation tracks: push the next touch out so it isn't due today.
    // Funnel one-shots: nothing to advance (their stamp already prevents re-send).
    if (isTrack && lead) {
      const next = nextFollowupDate(type, new Date(), lead.followup_count || 0);
      await supabase.from('leads').update({ next_followup_at: next.toISOString() }).eq('id', lead.id);
    }
    return res.status(200).json({ ok: true, action: 'skip' });
  }

  // ----- SEND -----
  const finalSubject = (subject && String(subject).trim()) || draft.subject;
  const finalHtml = (body_html && String(body_html).trim()) || draft.body_html;
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({ from: FROM, to: [draft.to_email], subject: finalSubject, html: finalHtml });
  } catch (e) {
    console.error('send-followup email error:', e);
    return res.status(500).json({ error: 'Email failed to send' });
  }

  await supabase.from('followup_drafts')
    .update({ status: 'sent', sent_at: nowIso, sent_by: user.id, subject: finalSubject, body_html: finalHtml })
    .eq('id', draft_id);

  // Log to the activity feed.
  try {
    await supabase.from('prospect_interactions').insert({
      first_name: lead?.first_name,
      email: draft.to_email,
      direction: 'outbound',
      method: 'email',
      subject: finalSubject,
      notes: `Follow-up email (${type})`,
      source: 'followup'
    });
  } catch (e) {
    console.warn('send-followup interaction log failed (non-fatal):', e.message);
  }

  // Conversation tracks advance to the next touch; funnel one-shots don't recur.
  if (isTrack && lead) {
    const next = nextFollowupDate(type, new Date(), (lead.followup_count || 0) + 1);
    await supabase.from('leads').update({
      last_followup_at: nowIso,
      next_followup_at: next.toISOString(),
      followup_count: (lead.followup_count || 0) + 1
    }).eq('id', lead.id);
  }

  return res.status(200).json({ ok: true, action: 'send' });
}
