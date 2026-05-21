// POST /api/send-nudge
// Admin-only. Called from admin.html lead detail modal.
// Sends a warm "24-hour follow-up" email to a lead who hasn't booked a call yet,
// then bumps their status to 'contacted'.
//
// BEFORE sending, queries Calendly to see if the lead has already booked an
// event. If yes, returns { requires_confirmation: true, event: {...} } so the
// frontend can prompt "they already booked — send anyway?" If admin retries
// with body.force=true, the Calendly check is skipped.
//
// If Calendly is unreachable / not configured, the check fails open (nudge
// proceeds normally) so a Calendly outage never blocks admin actions.
//
// Body: { lead_id: string, force?: boolean }

import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

const FROM = 'OwnaFleet <leads@ownafleet.com>';
const CALENDLY_URL = 'https://calendly.com/drjoshcochran/connect-about-fleet-ownership';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { lead_id, force } = req.body || {};
  if (!lead_id) return res.status(400).json({ error: 'Missing lead_id' });

  const authHeader = req.headers.authorization || '';
  const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!accessToken) return res.status(401).json({ error: 'Missing auth token' });

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET_KEY
  );

  // Verify caller is an admin
  const { data: { user } } = await supabase.auth.getUser(accessToken);
  if (!user) return res.status(401).json({ error: 'Invalid session' });

  const { data: adminCheck } = await supabase
    .from('admins')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!adminCheck) return res.status(403).json({ error: 'Not an admin' });

  // Load the lead
  const { data: lead, error: leadErr } = await supabase
    .from('leads')
    .select('*')
    .eq('id', lead_id)
    .maybeSingle();

  if (leadErr || !lead) return res.status(404).json({ error: 'Lead not found' });

  // Calendly pre-check (skipped if admin already confirmed via force=true)
  if (!force) {
    const calendlyCheck = await checkCalendlyBooking(lead.email);
    if (calendlyCheck.booked) {
      return res.status(200).json({
        ok: false,
        requires_confirmation: true,
        event: calendlyCheck.event,
        lead_name: `${lead.first_name} ${lead.last_name}`
      });
    }
  }

  // Note: post-migration-013, the manual nudge no longer bumps lead status.
  // Status changes happen only on real actions: Calendly booking
  // (→ booked_call) and admin clicking "Send application" (→ call_completed_app_sent).
  // The nudge is just an email reminder; no state change.

  // Send nudge email
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: FROM,
      to: [lead.email],
      subject: 'Following up — equipment overview',
      html: nudgeEmailHtml(lead)
    });
  } catch (emailErr) {
    console.error('Email send error:', emailErr);
    return res.status(500).json({ error: 'Email failed to send' });
  }

  return res.status(200).json({ ok: true });
}

function nudgeEmailHtml(lead) {
  return `
    <div style="font-family: -apple-system, sans-serif; max-width: 600px; line-height: 1.6; color: #0B1724;">
      <p>Hi ${escape(lead.first_name)},</p>
      <p>Wanted to make sure the equipment overview I sent yesterday came through ok. No rush at all — just don't want it to get lost in the shuffle.</p>
      <p>Whenever you have time, the 20-minute window link is here:</p>
      <p style="margin: 24px 0;">
        <a href="${CALENDLY_URL}" style="display: inline-block; background: #0B1724; color: white; padding: 14px 28px; text-decoration: none; font-size: 13px; letter-spacing: 0.15em; text-transform: uppercase; font-weight: 500;">Schedule a 20-min call →</a>
      </p>
      <p>Reply anytime with questions, or text me directly at <strong>(206) 755-6436</strong>.</p>
      <p style="margin-top: 32px;">— Josh Cochran<br><span style="color: #6B7280; font-size: 13px;">OwnaFleet · Cochran Management LLC</span></p>
    </div>
  `;
}

function escape(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ============================================================
// Calendly pre-check
// Queries Calendly's API to see if `leadEmail` has any scheduled
// events with the OwnaFleet Calendly account. Fails open: if the
// API is unreachable or the token isn't configured, returns
// { booked: false } so the nudge proceeds without blocking.
// ============================================================
async function checkCalendlyBooking(leadEmail) {
  const token = process.env.CALENDLY_API_TOKEN;
  if (!token) {
    console.warn('CALENDLY_API_TOKEN not set; skipping Calendly pre-check.');
    return { booked: false };
  }

  try {
    // 1. Get the authenticated user's URI (small overhead per call; acceptable)
    const userRes = await fetch('https://api.calendly.com/users/me', {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!userRes.ok) {
      console.warn('Calendly /users/me failed:', userRes.status, await userRes.text());
      return { booked: false };
    }
    const userData = await userRes.json();
    const userUri = userData?.resource?.uri;
    if (!userUri) {
      console.warn('Calendly /users/me returned no URI');
      return { booked: false };
    }

    // 2. List scheduled events for this invitee email
    const url = new URL('https://api.calendly.com/scheduled_events');
    url.searchParams.set('user', userUri);
    url.searchParams.set('invitee_email', leadEmail);
    // Calendly API requires sort+count for some endpoints; default to recent first
    url.searchParams.set('count', '20');

    const eventsRes = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!eventsRes.ok) {
      console.warn('Calendly /scheduled_events failed:', eventsRes.status, await eventsRes.text());
      return { booked: false };
    }
    const eventsData = await eventsRes.json();
    const allEvents = eventsData?.collection || [];
    if (allEvents.length === 0) return { booked: false };

    // Canceled bookings mean the slot was freed up — treat as "not booked"
    // (otherwise a lead who once booked + canceled would forever block nudges).
    const events = allEvents.filter(e => e.status === 'active');
    if (events.length === 0) return { booked: false };

    // Prefer a future booking; otherwise the most recent past one
    const now = Date.now();
    const future = events
      .filter(e => new Date(e.start_time).getTime() > now)
      .sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
    const past = events
      .filter(e => new Date(e.start_time).getTime() <= now)
      .sort((a, b) => new Date(b.start_time) - new Date(a.start_time));
    const relevant = future[0] || past[0];

    // Return raw ISO timestamp — frontend formats with browser timezone for
    // local-time display in the confirmation prompt.
    return {
      booked: true,
      event: {
        name: relevant.name || 'Calendly meeting',
        status: relevant.status || 'active',  // 'active' or 'canceled'
        start_time: relevant.start_time
      }
    };
  } catch (err) {
    console.warn('Calendly pre-check threw, failing open:', err.message);
    return { booked: false };
  }
}
