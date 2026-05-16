// POST /api/link-partner
// Called by /dashboard when a signed-in user's auth.users row isn't yet
// linked to a referral_partners row (i.e. user_id is NULL on the partner).
//
// First sign-in flow: partner applies → admin approves → partner receives
// magic-link email → partner clicks → Supabase creates auth.users row with
// a fresh UUID. There's no DB trigger linking that new UUID back to the
// existing referral_partners row, so the dashboard sees "no partner found."
//
// This endpoint closes that gap by matching on email (service-role bypass
// of RLS) and stamping user_id onto the row. Idempotent — subsequent calls
// no-op once linked.

import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization || '';
  const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!accessToken) return res.status(401).json({ error: 'Missing auth token' });

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
  );

  // Identify the caller
  const { data: { user }, error: userErr } = await supabase.auth.getUser(accessToken);
  if (userErr || !user) return res.status(401).json({ error: 'Invalid session' });

  const userEmail = (user.email || '').trim().toLowerCase();
  if (!userEmail) return res.status(400).json({ error: 'No email on auth user' });

  // Is there already a partner row linked to this user_id? Return it.
  const { data: alreadyLinked } = await supabase
    .from('referral_partners')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();

  if (alreadyLinked) {
    return res.status(200).json({ ok: true, partner: alreadyLinked, action: 'already_linked' });
  }

  // Try to find a partner row by email with no user_id yet.
  const { data: byEmail } = await supabase
    .from('referral_partners')
    .select('*')
    .eq('email', userEmail)
    .maybeSingle();

  if (!byEmail) {
    return res.status(404).json({ error: 'No partner record matches this email' });
  }

  // If a different auth user has already claimed this row, bail. Shouldn't happen
  // (one email = one auth user) but guard against accidental conflicts.
  if (byEmail.user_id && byEmail.user_id !== user.id) {
    return res.status(409).json({ error: 'Partner record is linked to a different account' });
  }

  // Stamp user_id and return the linked row.
  const { data: linked, error: updErr } = await supabase
    .from('referral_partners')
    .update({ user_id: user.id })
    .eq('id', byEmail.id)
    .select()
    .single();

  if (updErr) {
    console.error('link-partner update error:', updErr);
    return res.status(500).json({ error: 'Failed to link partner record' });
  }

  return res.status(200).json({ ok: true, partner: linked, action: 'linked' });
}
