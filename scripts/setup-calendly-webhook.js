#!/usr/bin/env node
// Run this once to register the Calendly webhook subscription with Calendly's API.
// Usage:
//   CALENDLY_API_TOKEN=eyJ... node web/scripts/setup-calendly-webhook.js
//
// Steps:
// 1. Fetches your Calendly user URI from /users/me.
// 2. Creates a webhook subscription for invitee.created events,
//    pointing at https://ownafleet.com/api/calendly-webhook.
// 3. Generates a random signing key and prints it. Add this to Vercel
//    as CALENDLY_WEBHOOK_SIGNING_KEY (Production + Preview scope).
//
// Idempotent-ish: if you re-run, Calendly may either reject (duplicate URL)
// or create a second subscription. Check the Calendly dashboard if uncertain.

import crypto from 'crypto';

const TOKEN = process.env.CALENDLY_API_TOKEN;
if (!TOKEN) {
  console.error('Missing CALENDLY_API_TOKEN env var.');
  process.exit(1);
}

const WEBHOOK_URL = process.env.WEBHOOK_URL || 'https://ownafleet.com/api/calendly-webhook';
const SIGNING_KEY = process.env.SIGNING_KEY || crypto.randomBytes(32).toString('hex');

async function api(path, opts = {}) {
  const url = path.startsWith('https://') ? path : `https://api.calendly.com${path}`;
  const res = await fetch(url, {
    ...opts,
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {})
    }
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!res.ok) {
    throw new Error(`Calendly ${path} returned ${res.status}: ${text}`);
  }
  return body;
}

async function main() {
  // 1. Get user URI + organization URI
  console.log('Fetching Calendly user info...');
  const userData = await api('/users/me');
  const userUri = userData?.resource?.uri;
  const orgUri = userData?.resource?.current_organization;
  if (!userUri || !orgUri) {
    throw new Error('Could not extract user or org URI from /users/me');
  }
  console.log(`  user:         ${userUri}`);
  console.log(`  organization: ${orgUri}`);

  // 2. List existing subscriptions to check for duplicates
  console.log('Checking existing subscriptions...');
  const subs = await api(`/webhook_subscriptions?organization=${encodeURIComponent(orgUri)}&user=${encodeURIComponent(userUri)}&scope=user`);
  const existing = (subs.collection || []).find(s => s.callback_url === WEBHOOK_URL);
  if (existing) {
    console.log(`⚠ A subscription already exists for ${WEBHOOK_URL}:`);
    console.log(`   ${existing.uri}`);
    console.log('   To recreate, delete it first via the Calendly dashboard or API.');
    process.exit(0);
  }

  // 3. Create the subscription
  console.log(`Creating webhook subscription for ${WEBHOOK_URL}...`);
  const created = await api('/webhook_subscriptions', {
    method: 'POST',
    body: JSON.stringify({
      url: WEBHOOK_URL,
      events: ['invitee.created'],
      organization: orgUri,
      user: userUri,
      scope: 'user',
      signing_key: SIGNING_KEY
    })
  });

  console.log('\n✅ Webhook subscription created.');
  console.log(`   ${created?.resource?.uri || '(uri not returned)'}`);
  console.log('\n=========================================================');
  console.log('NEXT STEP — add this to Vercel as an env var:');
  console.log('=========================================================');
  console.log(`Name:  CALENDLY_WEBHOOK_SIGNING_KEY`);
  console.log(`Value: ${SIGNING_KEY}`);
  console.log('Scope: Production + Preview');
  console.log('=========================================================\n');
  console.log('After saving the env var, redeploy:');
  console.log('  cd web && npx vercel --prod --yes');
  console.log('\nThen test by booking yourself a Calendly slot using an email not yet in deck_requests.');
}

main().catch(err => {
  console.error('Setup failed:', err.message);
  process.exit(1);
});
