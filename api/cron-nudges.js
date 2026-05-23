// GET /api/cron-nudges
// Vercel cron handler. Scheduled in vercel.json (16:00 UTC daily =
// 9am Pacific in daylight time / 8am in standard time). Runs three
// independent drip nudges:
//
//   1. NO_BOOK   — Deck requested 3+ days ago, never booked a call
//   2. NO_APP    — Booked 2+ days ago, no application submitted
//   3. STALLED   — Mini-app submitted 5+ days ago, no full app
//
// Each nudge stamps its own column (migration 009) so the same prospect
// never gets the same nudge twice. Per-row try/catch — one failure
// doesn't block the rest of the batch. Returns a JSON summary for the
// Vercel cron logs.
//
// Auth: Vercel cron requests include `Authorization: Bearer <CRON_SECRET>`
// when CRON_SECRET is set as an env var. We reject anything else.

import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const FROM = 'OwnaFleet <leads@ownafleet.com>';
const CALENDLY_URL = 'https://calendly.com/ownafleet/intro';

// Statuses that mean the lead has already moved past the deck/booking
// phase — i.e., they shouldn't get the NO_BOOK or NO_APP nudges.
// Covers the post-migration-013 statuses + their legacy equivalents in case
// any unmigrated rows exist.
const PAST_APP_STATUSES = new Set([
  // current
  'call_completed_app_sent', 'application_submitted', 'incomplete_application',
  'credit_review', 'in_progress', 'prelim_approved', 'bank_approved',
  'closing', 'funded_enrolled',
  // legacy (pre-013)
  'application_sent', 'mini_app_submitted', 'full_app_submitted',
  'approved', 'terms_accepted', 'funded', 'operating',
  // even older
  'application_started', 'documents_uploaded', 'closed_won'
]);

export default async function handler(req, res) {
  // Auth — Vercel injects this header automatically for scheduled cron calls.
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    console.error('CRON_SECRET not set — refusing to run.');
    return res.status(500).json({ error: 'CRON_SECRET not configured' });
  }
  const got = (req.headers.authorization || '').replace(/^Bearer\s+/, '');
  if (got !== expected) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
  );
  const resend = new Resend(process.env.RESEND_API_KEY);

  // Pull all leads once — we use these to filter out prospects who have
  // already moved further down the funnel than the nudge's target stage.
  const { data: allLeads, error: leadsErr } = await supabase
    .from('leads')
    .select('id, email, status, status_updated_at, first_name, nudge_stalled_sent_at');
  if (leadsErr) {
    console.error('Failed to load leads:', leadsErr);
    return res.status(500).json({ error: 'Failed to load leads' });
  }

  const leadsByEmail = new Map();
  for (const l of allLeads) {
    // If multiple leads share an email (shouldn't happen but defensive), keep the
    // one furthest along the funnel for filtering purposes.
    const existing = leadsByEmail.get(l.email);
    if (!existing || statusRank(l.status) > statusRank(existing.status)) {
      leadsByEmail.set(l.email, l);
    }
  }

  const summary = {
    no_book: { eligible: 0, sent: 0, errors: 0 },
    no_app:  { eligible: 0, sent: 0, errors: 0 },
    stalled: { eligible: 0, sent: 0, errors: 0 }
  };

  // ============================================================
  // NUDGE 1 — NO_BOOK
  //   Deck requested 3+ days ago, no booked_at, no application
  //   started anywhere.
  // ============================================================
  {
    const cutoff = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const { data: candidates, error } = await supabase
      .from('deck_requests')
      .select('id, email, first_name')
      .lt('created_at', cutoff)
      .is('booked_at', null)
      .is('nudge_no_book_sent_at', null);

    if (error) {
      console.error('NO_BOOK fetch error:', error);
    } else {
      for (const c of candidates) {
        const lead = leadsByEmail.get(c.email);
        // Skip if they already moved past 'new' — they're being worked.
        if (lead && lead.status !== 'new' && lead.status !== 'dead') continue;
        // Skip dead leads too.
        if (lead && ['dead', 'archived', 'not_now'].includes(lead.status)) continue;
        summary.no_book.eligible += 1;
        try {
          await resend.emails.send({
            from: FROM,
            to: [c.email],
            subject: 'Quick check on the OwnaFleet overview',
            html: noBookEmailHtml(c.first_name || 'there')
          });
          await supabase
            .from('deck_requests')
            .update({ nudge_no_book_sent_at: new Date().toISOString() })
            .eq('id', c.id);
          summary.no_book.sent += 1;
        } catch (e) {
          console.error('NO_BOOK send error:', c.email, e);
          summary.no_book.errors += 1;
        }
      }
    }
  }

  // ============================================================
  // NUDGE 2 — NO_APP
  //   Booked 2+ days ago, no application submitted yet.
  //   Frames neutrally so it works whether the call has happened
  //   yet or not (we don't store meeting start_time today).
  // ============================================================
  {
    const cutoff = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const { data: candidates, error } = await supabase
      .from('deck_requests')
      .select('id, email, first_name')
      .not('booked_at', 'is', null)
      .lt('booked_at', cutoff)
      .is('nudge_no_app_sent_at', null);

    if (error) {
      console.error('NO_APP fetch error:', error);
    } else {
      for (const c of candidates) {
        const lead = leadsByEmail.get(c.email);
        // Skip if they're past the application stage in the lead pipeline.
        if (lead && PAST_APP_STATUSES.has(lead.status)) continue;
        // Skip dead leads.
        if (lead && ['dead', 'archived', 'not_now'].includes(lead.status)) continue;
        summary.no_app.eligible += 1;
        try {
          await resend.emails.send({
            from: FROM,
            to: [c.email],
            subject: 'Following up on our scheduled call',
            html: noAppEmailHtml(c.first_name || 'there')
          });
          await supabase
            .from('deck_requests')
            .update({ nudge_no_app_sent_at: new Date().toISOString() })
            .eq('id', c.id);
          summary.no_app.sent += 1;
        } catch (e) {
          console.error('NO_APP send error:', c.email, e);
          summary.no_app.errors += 1;
        }
      }
    }
  }

  // ============================================================
  // NUDGE 3 — STALLED
  //   Lead at application_submitted (or legacy mini_app_submitted) for
  //   5+ days. status_updated_at is refreshed by the trigger on every
  //   status change.
  // ============================================================
  {
    const cutoff = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const { data: candidates, error } = await supabase
      .from('leads')
      .select('id, email, first_name, status')
      .in('status', ['application_submitted', 'mini_app_submitted'])
      .lt('status_updated_at', cutoff)
      .is('nudge_stalled_sent_at', null);

    if (error) {
      console.error('STALLED fetch error:', error);
    } else {
      for (const c of candidates) {
        summary.stalled.eligible += 1;
        try {
          await resend.emails.send({
            from: FROM,
            to: [c.email],
            subject: 'Quick check-in on the application',
            html: stalledEmailHtml(c.first_name || 'there')
          });
          await supabase
            .from('leads')
            .update({ nudge_stalled_sent_at: new Date().toISOString() })
            .eq('id', c.id);
          summary.stalled.sent += 1;
        } catch (e) {
          console.error('STALLED send error:', c.email, e);
          summary.stalled.errors += 1;
        }
      }
    }
  }

  console.log('cron-nudges summary:', JSON.stringify(summary));
  return res.status(200).json({ ok: true, summary });
}

// ============================================================
// Email templates
// Voice: warm, low-pressure, signed Josh. Mirrors the manual nudge
// and application emails already in production.
// ============================================================

function noBookEmailHtml(first_name) {
  return wrap(`
    <p>Hi ${escape(first_name)},</p>
    <p>I sent over the 21-slide OwnaFleet overview a few days ago and wanted to make sure it didn't get lost in the shuffle.</p>
    <p>If you've had a chance to look through it, happy to set up a 20-minute call to talk through your specific situation:</p>
    <p style="margin: 24px 0;">
      <a href="${CALENDLY_URL}" style="display: inline-block; background: #0B1724; color: white; padding: 14px 28px; text-decoration: none; font-size: 13px; letter-spacing: 0.15em; text-transform: uppercase; font-weight: 500;">Schedule a 20-min call →</a>
    </p>
    <p>If the timing isn't right, no problem at all — just reply and let me know.</p>
    <p>Either way, you can reach me at <strong>(206) 755-6436</strong> any time.</p>
    <p style="margin-top: 32px;">— Josh Cochran<br><span style="color: #6B7280; font-size: 13px;">OwnaFleet · Cochran Management LLC</span></p>
  `);
}

function noAppEmailHtml(first_name) {
  return wrap(`
    <p>Hi ${escape(first_name)},</p>
    <p>Following up on the call you've got booked — looking forward to walking through your specific situation.</p>
    <p>A few things that sometimes come up beforehand:</p>
    <ul style="line-height: 1.7;">
      <li>If you'd like to <strong>reschedule</strong>, the Calendly link works the same way — pick a new slot and the old one auto-cancels.</li>
      <li>If you've already had time to read the deck and want to <strong>start lining things up in advance</strong>, just reply and I'll send over the 5-minute mini-application. That's what gets preliminary lending terms back before we hop on.</li>
      <li>If you'd rather <strong>wait until after we talk</strong>, that's the default — no rush.</li>
    </ul>
    <p>Either way, hit reply with any questions, or text me at <strong>(206) 755-6436</strong>.</p>
    <p style="margin-top: 32px;">— Josh Cochran<br><span style="color: #6B7280; font-size: 13px;">OwnaFleet · Cochran Management LLC</span></p>
  `);
}

function stalledEmailHtml(first_name) {
  return wrap(`
    <p>Hi ${escape(first_name)},</p>
    <p>We have your mini-application on file — thanks for getting that over.</p>
    <p>The next step is the full application, which is what the lender uses to issue final terms. Anything standing in the way? Common ones:</p>
    <ul style="line-height: 1.7;">
      <li>Still pulling together tax returns or the personal financial statement</li>
      <li>Want to think through entity structure (existing LLC vs. setting one up)</li>
      <li>Want a second conversation before committing the time</li>
    </ul>
    <p>Any of those — just reply and I'll help work through it. Or text me at <strong>(206) 755-6436</strong>.</p>
    <p style="margin-top: 32px;">— Josh Cochran<br><span style="color: #6B7280; font-size: 13px;">OwnaFleet · Cochran Management LLC</span></p>
  `);
}

function wrap(inner) {
  return `
    <div style="font-family: -apple-system, sans-serif; max-width: 600px; line-height: 1.6; color: #0B1724;">
      ${inner}
      <hr style="border: none; border-top: 1px solid #D9DDE3; margin: 32px 0 16px;">
      <p style="font-size: 11px; color: #6B7280; font-style: italic; line-height: 1.5;">
        This communication is informational only and does not constitute financial, tax, legal, investment, or accounting advice. This is not an offer to sell or solicit any security.
      </p>
    </div>
  `;
}

function escape(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function statusRank(status) {
  const RANKS = {
    new: 0, contacted: 1, application_sent: 2, mini_app_submitted: 3,
    full_app_submitted: 4, approved: 5, terms_accepted: 6, funded: 7,
    operating: 8, dead: -1,
    application_started: 3, documents_uploaded: 4, closed_won: 7
  };
  return RANKS[status] ?? 0;
}
