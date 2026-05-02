// Shared Supabase client for browser-side pages.
// Uses ESM import via CDN — no build step required.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// These two values are safe to expose client-side.
// The publishable key is enforced via Row-Level Security policies on the database.
const SUPABASE_URL = 'https://lkfaemhhdxjaqggvlotv.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_-ts6_XNXV4pYchHKxnFvXw_IhMuBAPC';

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});

// Returns 'admin' | 'partner' | null based on user's role.
// Checks the admins table first, then looks for an active partner record.
export async function getUserRole(userId) {
  if (!userId) return null;

  const { data: adminRow } = await supabase
    .from('admins')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle();
  if (adminRow) return 'admin';

  const { data: partnerRow } = await supabase
    .from('referral_partners')
    .select('id, status')
    .eq('user_id', userId)
    .maybeSingle();
  if (partnerRow && partnerRow.status === 'active') return 'partner';
  if (partnerRow) return 'partner_' + partnerRow.status;  // pending / paused / rejected

  return null;
}

// Redirects user to the right dashboard based on role.
// Returns true if redirected, false if user has no role (treat as not signed up).
export async function routeByRole() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;

  const role = await getUserRole(user.id);
  if (role === 'admin') {
    window.location.href = '/admin';
    return true;
  }
  if (role === 'partner') {
    window.location.href = '/dashboard';
    return true;
  }
  return false;
}
