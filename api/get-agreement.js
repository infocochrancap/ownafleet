// GET /api/get-agreement
// Returns the current referral-partner agreement rendered for the logged-in
// partner (their name/entity + their effective fee %), plus signing status.
// Internal surface (auth required) — partner names in the text are OK here.

import { createClient } from '@supabase/supabase-js';
import { AGREEMENT_VERSION, effectiveFeePct, renderAgreementHtml, agreementHash } from './_lib/agreement-text.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization || '';
  const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!accessToken) return res.status(401).json({ error: 'Missing auth' });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY);
  const { data: { user } } = await supabase.auth.getUser(accessToken);
  if (!user) return res.status(401).json({ error: 'Invalid session' });

  const { data: partner } = await supabase
    .from('referral_partners')
    .select('id, first_name, last_name, company, email, commission_split_pct, status, agreement_signed_at, agreement_version')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!partner) return res.status(403).json({ error: 'Not a referral partner' });

  const feePct = effectiveFeePct(partner.commission_split_pct);
  const html = renderAgreementHtml(partner, feePct);

  const { data: signature } = await supabase
    .from('partner_agreements')
    .select('agreement_version, signed_name, signed_at')
    .eq('partner_id', partner.id)
    .eq('agreement_version', AGREEMENT_VERSION)
    .maybeSingle();

  return res.status(200).json({
    version: AGREEMENT_VERSION,
    fee_pct: feePct,
    html,
    doc_hash: agreementHash(html),
    partner: { first_name: partner.first_name, last_name: partner.last_name, company: partner.company, status: partner.status },
    signed: !!signature,
    signed_at: signature?.signed_at || null,
    signed_name: signature?.signed_name || null
  });
}
