// api/_lib/followup-cadence.js
//
// The calendar-aware brain of the follow-up system. Shared by
// cron-followups.js (decides who's due, builds the email) and
// send-followup.js / set-followup.js (computes the NEXT touch date).
//
// ORGANIZING PRINCIPLE (per Josh, 2026-06):
//   - Avoid Q4 starts. Small (<= $1.5M) deals get deprioritized and
//     rev-share economics constrict when the partner fleet is busy.
//   - Close everything possible before the END OF Q3 (Sep 30).
//   - Q2 (Apr–Jun) is the prime window to START as many people as
//     possible; Q3 absorbs latecomers.
//   - Start→funded takes ~8–12 weeks, so to fund by Sep 30 a prospect
//     should START by ~early July (the "start-by" line below).
//
// Customer-facing copy NEVER reveals the internal reasons or names the
// operating partner. Urgency is framed as "demand peaks in Q4 — earlier
// means priority and smoother terms."  All cadence numbers are centralized
// here so they're one-line tunable.

// ----- Tunable cadence knobs (days) -----
const CADENCE = {
  interested_no_app: { normal: 6, urgent: 3, approachWindowDays: 42 },
  with_accountant:   { steps: [7, 14, 30], approachCap: 7 },
  too_early:         { defaultOut: 30 },   // suggested gap if Josh doesn't set a date
  past_customer:     { anchorMonth: 3, anchorDay: 15 } // ~Apr 15 (month is 0-indexed)
};

// ----- Calendar anchors for a given tax year -----
function anchorsForYear(year) {
  return {
    closeBy:        new Date(Date.UTC(year, 8, 30, 23, 59, 59)), // Sep 30
    startBy:        new Date(Date.UTC(year, 6, 11, 23, 59, 59)), // ~Jul 11
    primeOpen:      new Date(Date.UTC(year, 3, 1)),              // Apr 1
    primeClose:     new Date(Date.UTC(year, 5, 30, 23, 59, 59)), // Jun 30
    reBuyAnchor:    new Date(Date.UTC(year, CADENCE.past_customer.anchorMonth, CADENCE.past_customer.anchorDay))
  };
}

const DAY = 24 * 60 * 60 * 1000;
const addDays = (d, n) => new Date(d.getTime() + n * DAY);

// Where are we in the seasonal cycle right now?
//   'pre_season' — before the prime window opens (Jan–Mar)
//   'prime'      — prime start window through the start-by line (Apr–early Jul)
//   'q3_urgent'  — past start-by but before close-by (mid Jul–Sep): last chance
//   'q4_defer'   — past close-by (Oct–Dec): don't start small deals; defer
export function calendarContext(now = new Date()) {
  const y = now.getUTCFullYear();
  const a = anchorsForYear(y);
  let context;
  if (now < a.primeOpen) context = 'pre_season';
  else if (now <= a.startBy) context = 'prime';
  else if (now <= a.closeBy) context = 'q3_urgent';
  else context = 'q4_defer';
  return { context, ...a, year: y };
}

// The next prime-start window opening. If we haven't reached this year's
// window yet (pre_season), that's this April; once the window is open or
// past, the next opening is next April. Used to park prospects who can no
// longer comfortably close this year — never returns a near-term date, so it
// can't create a daily re-nudge loop.
function nextPrimeStart(now) {
  const { context, primeOpen, year } = calendarContext(now);
  if (context === 'pre_season') return primeOpen;   // this year's Apr 1 still ahead
  return new Date(Date.UTC(year + 1, 3, 1));         // window open/passed → next year
}

// Compute the next follow-up date for a track, given today + how many times
// we've already touched them. Returns a Date. Callers may override with a
// date Josh entered manually.
export function nextFollowupDate(track, now = new Date(), followupCount = 0) {
  const cal = calendarContext(now);
  const { context, startBy, closeBy, primeOpen } = cal;

  if (context === 'q4_defer' && track !== 'with_accountant' && track !== 'past_customer') {
    // In Q4 we stop pushing new/small deals — re-anchor to next prime window.
    // (with_accountant keeps its own slow cadence; past_customer has its own
    //  annual logic below.)
    return nextPrimeStart(now);
  }

  switch (track) {
    case 'interested_no_app': {
      const k = CADENCE.interested_no_app;
      const daysToStartBy = (startBy - now) / DAY;
      const urgent = context === 'q3_urgent' || (daysToStartBy > 0 && daysToStartBy <= k.approachWindowDays);
      const next = addDays(now, urgent ? k.urgent : k.normal);
      // If a normal-cadence touch would land past the close-by line with no
      // runway, park to the next prime window instead of nudging into Q4.
      return next > closeBy ? nextPrimeStart(now) : next;
    }
    case 'with_accountant': {
      const k = CADENCE.with_accountant;
      let gap = k.steps[Math.min(followupCount, k.steps.length - 1)];
      const daysToStartBy = (startBy - now) / DAY;
      if (daysToStartBy > 0 && daysToStartBy <= CADENCE.interested_no_app.approachWindowDays) {
        gap = Math.min(gap, k.approachCap); // tighten as the start-by line nears
      }
      return addDays(now, gap);
    }
    case 'too_early': {
      // Respect their timing but never let it drift into Q4.
      //  - Before the prime window opens → wait for it (Apr 1).
      //  - In-season with runway → check back ~30 days out, but no later than
      //    the start-by line, so there's still time to close this year.
      //  - Past the start-by line → park to the next prime window (next year).
      // (Josh usually overrides with the real date the prospect gave him.)
      if (context === 'pre_season') return primeOpen;
      if (now < startBy) {
        const suggested = addDays(now, CADENCE.too_early.defaultOut);
        return suggested > startBy ? startBy : suggested;
      }
      return nextPrimeStart(now);
    }
    case 'past_customer': {
      // Annual re-buy anchored to early Q2 (~Apr 15) so they start early and
      // close by Q3 — never pushed into Q4.
      const y = now.getUTCFullYear();
      const aprThis = new Date(Date.UTC(y, 3, 15));
      const aprNext = new Date(Date.UTC(y + 1, 3, 15));
      if (followupCount >= 1) return now < aprThis ? aprThis : aprNext; // recurring: annual
      // First re-engagement of the cycle:
      if (now < aprThis) return aprThis;          // before the Q2 kickoff → wait for it
      if (now <= startBy) return addDays(now, 1);  // in-season, not yet contacted → reach out now
      return aprNext;                              // past the window → aim for next year's Q2
    }
    default:
      return addDays(now, 30);
  }
}

// ============================================================
// Email templates — one builder per track, calendar-aware.
// Voice mirrors the existing nudges: warm, low-pressure, signed Josh,
// (206) 755-6436, NO partner names, disclosure footer on every send.
// Returns { subject, html }.
// ============================================================
const CALENDLY_URL = 'https://calendly.com/ownafleet/intro';
const PHONE = '(206) 755-6436';

// The four conversation tracks (Josh-set, recurring). Everything else is a
// one-shot funnel-stage nudge. Used by the cron + send endpoint to decide
// whether to advance a recurring cadence or treat the send as one-shot.
export const CONVERSATION_TRACKS = new Set([
  'interested_no_app', 'with_accountant', 'too_early', 'past_customer'
]);

export function buildFollowupEmail(type, { first_name, now = new Date() } = {}) {
  const name = first_name || 'there';
  const { context } = calendarContext(now);
  switch (type) {
    // Conversation tracks (calendar-aware)
    case 'interested_no_app': return interestedNoApp(name, context);
    case 'with_accountant':   return withAccountant(name, context);
    case 'too_early':         return tooEarly(name, context);
    case 'past_customer':     return pastCustomer(name, context);
    // Funnel-stage nudges (ported from the old cron-nudges; one-shot)
    case 'no_book':           return noBook(name);
    case 'no_app':            return noApp(name);
    case 'stalled_app':       return stalledApp(name);
    default:                  return interestedNoApp(name, context);
  }
}

// ----- Funnel-stage nudges (the three the old auto-drip sent) -----
function noBook(name) {
  return {
    subject: 'Quick check on the overview',
    html: wrap(`
      <p>Hi ${esc(name)},</p>
      <p>I sent over the OwnaFleet overview a few days ago and wanted to make sure it didn't get lost in the shuffle.</p>
      <p>If you've had a chance to look through it, I'd be glad to set up a quick 20-minute call to talk through your specific situation:</p>
      <p style="margin: 24px 0;">
        <a href="${CALENDLY_URL}" style="display:inline-block;background:#0B1724;color:white;padding:14px 28px;text-decoration:none;font-size:13px;letter-spacing:0.15em;text-transform:uppercase;font-weight:500;">Schedule a 20-min call →</a>
      </p>
      <p>If the timing isn't right, no problem at all — just reply and let me know.</p>
      <p>Either way, you can reach me at <strong>${PHONE}</strong> any time.</p>
      ${sig()}
    `)
  };
}

function noApp(name) {
  return {
    subject: 'Following up on our call',
    html: wrap(`
      <p>Hi ${esc(name)},</p>
      <p>Following up on the call you've got booked — looking forward to walking through your specific situation.</p>
      <p>A few things that sometimes come up beforehand:</p>
      <ul style="line-height: 1.7;">
        <li>If you'd like to <strong>reschedule</strong>, the Calendly link works the same way — pick a new slot and the old one auto-cancels.</li>
        <li>If you'd like to <strong>start lining things up in advance</strong>, just reply and I'll send over the application — that's what gets preliminary lending terms back before we hop on.</li>
        <li>If you'd rather <strong>wait until after we talk</strong>, that's the default — no rush.</li>
      </ul>
      <p>Either way, hit reply with any questions, or text me at <strong>${PHONE}</strong>.</p>
      ${sig()}
    `)
  };
}

function stalledApp(name) {
  return {
    subject: 'Quick check-in on the application',
    html: wrap(`
      <p>Hi ${esc(name)},</p>
      <p>We've got your application started — thanks for getting that going.</p>
      <p>The next step is the supporting documentation the lender needs to issue final terms. Anything standing in the way? Common ones:</p>
      <ul style="line-height: 1.7;">
        <li>Still pulling together tax returns or the personal financial statement</li>
        <li>Want to think through entity structure (existing LLC vs. setting one up)</li>
        <li>Want another conversation before committing the time</li>
      </ul>
      <p>Any of those — just reply and I'll help work through it. Or text me at <strong>${PHONE}</strong>.</p>
      ${sig()}
    `)
  };
}

// Shared urgency line used across tracks when the start-by line is near/past.
function timingLine(context) {
  if (context === 'q3_urgent') {
    return `<p>One timing note: demand on the fleet peaks heading into the fourth quarter, and earlier starts get priority and smoother terms. To comfortably have everything funded before the year-end rush, this is about the last stretch to get going for this year — so if you're leaning yes, now's the moment.</p>`;
  }
  if (context === 'prime') {
    return `<p>One timing note: the back half of the year gets congested, and earlier starts get priority and the smoothest terms. Right now is the ideal window to get the pieces in place with plenty of runway.</p>`;
  }
  return '';
}

function interestedNoApp(name, context) {
  const subject = context === 'q3_urgent'
    ? 'The window to get started this year'
    : 'Anything I can help line up?';
  return {
    subject,
    html: wrap(`
      <p>Hi ${esc(name)},</p>
      <p>Just circling back on the equipment program — I know life gets busy, so no pressure at all. Whenever you're ready, the next step is simply a quick application that gets preliminary lending terms back, and I'm happy to walk you through any of it first.</p>
      ${timingLine(context)}
      <p style="margin: 24px 0;">
        <a href="${CALENDLY_URL}" style="display:inline-block;background:#0B1724;color:white;padding:14px 28px;text-decoration:none;font-size:13px;letter-spacing:0.15em;text-transform:uppercase;font-weight:500;">Grab a 20-min window →</a>
      </p>
      <p>Or just reply here, or text me at <strong>${PHONE}</strong> — happy to answer anything.</p>
      ${sig()}
    `)
  };
}

function withAccountant(name, context) {
  return {
    subject: 'For you and your accountant',
    html: wrap(`
      <p>Hi ${esc(name)},</p>
      <p>Checking in — last we spoke you were planning to run the equipment program by your accountant, which is exactly the right move. I want to make that as easy as possible.</p>
      <p>The two things CPAs usually want to confirm: the depreciation treatment (it's structured so the first-year deduction offsets active income, with material participation), and how the cash flow and personal guarantee work. I'm glad to <strong>hop on a quick call with you and your accountant together</strong> so any questions get answered in real time — that tends to be far faster than passing notes back and forth.</p>
      ${timingLine(context)}
      <p style="margin: 24px 0;">
        <a href="${CALENDLY_URL}" style="display:inline-block;background:#0B1724;color:white;padding:14px 28px;text-decoration:none;font-size:13px;letter-spacing:0.15em;text-transform:uppercase;font-weight:500;">Set up a call →</a>
      </p>
      <p>Or reply with a couple of times that work, or text me at <strong>${PHONE}</strong>.</p>
      ${sig()}
    `)
  };
}

function tooEarly(name, context) {
  return {
    subject: 'Circling back — timing on the equipment program',
    html: wrap(`
      <p>Hi ${esc(name)},</p>
      <p>When we last talked, the timing wasn't quite right yet on your end — totally understood. I wanted to reconnect now because of how the calendar works on this program.</p>
      <p>From a started application to equipment funded and earning is roughly a couple of months, and demand on the fleet peaks late in the year — so the earlier in the year we begin, the better the priority and terms. If this is something you'd like to do for this tax year, getting the pieces in motion over the next stretch is the comfortable path.</p>
      <p>No rush if the timing still isn't there — I'm happy to aim for whenever makes sense for you. Just wanted to make sure the window didn't slip by without a heads-up.</p>
      <p style="margin: 24px 0;">
        <a href="${CALENDLY_URL}" style="display:inline-block;background:#0B1724;color:white;padding:14px 28px;text-decoration:none;font-size:13px;letter-spacing:0.15em;text-transform:uppercase;font-weight:500;">Grab a 20-min window →</a>
      </p>
      <p>Or just reply and tell me when's better — or text me at <strong>${PHONE}</strong>.</p>
      ${sig()}
    `)
  };
}

function pastCustomer(name) {
  return {
    subject: 'Planning this year’s equipment purchases?',
    html: wrap(`
      <p>Hi ${esc(name)},</p>
      <p>Hope the equipment from last round is running well. As you start thinking about purchases for this year, I wanted to reach out early — a fresh purchase means a fresh first-year depreciation deduction, and the smoothest time to get it placed is earlier in the year, well ahead of the year-end rush when the fleet gets busy.</p>
      <p>If you're considering adding this year, let's get you positioned now so it's funded with plenty of room before the fourth quarter. Same process you already know.</p>
      <p style="margin: 24px 0;">
        <a href="${CALENDLY_URL}" style="display:inline-block;background:#0B1724;color:white;padding:14px 28px;text-decoration:none;font-size:13px;letter-spacing:0.15em;text-transform:uppercase;font-weight:500;">Grab a 20-min window →</a>
      </p>
      <p>Or just reply, or text me at <strong>${PHONE}</strong> — always good to hear from you.</p>
      ${sig()}
    `)
  };
}

function sig() {
  return `<p style="margin-top: 32px;">— Josh Cochran<br><span style="color:#6B7280;font-size:13px;">OwnaFleet · Cochran Management LLC</span></p>`;
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

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
