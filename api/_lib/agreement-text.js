// Single source of truth for the OWNAFLEET referral-partner agreement.
//
// v2026-06-10.4 changes from .1 (all Josh-approved 2026-06-10; Codex-review
// fixes applied in .3 and .4):
//  1. Non-circumvention → objective fee-survival rule (§6.1): if referred
//     purchaser closes within Tail Period and Josh gets paid → partner gets
//     paid, no intent test required.
//  2. Partner confidentiality tightened (§9.3): partners may not hand
//     provider names or identities to referred purchasers.
//  3. Tail Period unified to 36 months everywhere (§2.15 def + §4.6 + §6.2).
//  4. Fee rate moved to Schedule 1; body references Schedule 1 dynamically.
//  5. Mutual limitation of liability added (§11.4): both sides capped at
//     12-month fees paid, mutual no-consequential-damages waiver.
//  6. Fee survival expressly survives termination (§12.4).
//  7. Minor adds: §5.12 CAN-SPAM/TCPA, §10.3 privacy rep, §16.2 assignee
//     fee-assumption language.
//
// PENDING: Brett Siglin review and sign-off.
//
// NOTE: this file is partner-facing only behind login (internal surface per
// the anti-bypass rules) — naming Armada / Bevel / EquipmentShare here is OK
// and legally necessary; never import this text into public pages or emails
// to unvetted prospects.

import crypto from 'crypto';

export const AGREEMENT_VERSION = '2026-06-10.4';

// Josh's affiliate share of equipment purchase price; partner's effective fee
// = JOSH_BASE_PCT * commission_split_pct / 100 (e.g. 2.1% * 40% = 0.84%).
export const JOSH_BASE_PCT = 2.1;

export function effectiveFeePct(splitPct) {
  const split = parseFloat(splitPct ?? 40);
  return Math.round(JOSH_BASE_PCT * split) / 100; // numeric, e.g. 0.84
}

// sha256 of the exact rendered agreement HTML the partner assented to.
export function agreementHash(html) {
  return crypto.createHash('sha256').update(html, 'utf8').digest('hex');
}

// Renders the full agreement HTML for a given partner.
// Deterministic for (partner identity, feePct, version) so the hash shown at
// review time matches the hash stored at signing time.
export function renderAgreementHtml(partner, feePct) {
  const fee = `${feePct.toFixed(2)}%`;
  const fullName = esc(`${partner.first_name || ''} ${partner.last_name || ''}`.trim());
  const referrerLine = partner.company
    ? `${esc(partner.company)} (by and through ${fullName})`
    : `${fullName}, an individual`;

  return `
<h1>OWNAFLEET Referral, Non-Solicitation, Non-Circumvention, Confidentiality and Fee Agreement</h1>

<p><strong>Version ${AGREEMENT_VERSION}</strong></p>

<p>This OWNAFLEET Referral, Non-Solicitation, Non-Circumvention, Confidentiality and Fee Agreement (this &ldquo;Agreement&rdquo;) is entered into as of the date of Referrer&rsquo;s electronic acceptance recorded under Section 17 (the &ldquo;Effective Date&rdquo;), by and between:</p>

<p><strong>Cochran Management, LLC</strong>, a Wyoming limited liability company (&ldquo;Company,&rdquo; &ldquo;CM,&rdquo; &ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;), and</p>

<p><strong>${referrerLine}</strong> (&ldquo;Referrer,&rdquo; &ldquo;you,&rdquo; or &ldquo;your&rdquo;).</p>

<p>Company and Referrer may be referred to individually as a &ldquo;Party&rdquo; and collectively as the &ldquo;Parties.&rdquo;</p>

<h2>1. Purpose and Background</h2>

<p>1.1 <strong>OWNAFLEET Program; Brand Names.</strong> Company is involved in sourcing, coordinating, introducing, or otherwise supporting commercial heavy-equipment ownership, acquisition, financing, fleet-management, and related program opportunities under the brand name OWNAFLEET and related program, website, slide-deck, email, and marketing names, including Cochran Capital, OWNAFLEET, cochrancap.com, and related trade names, brand names, or domains used by Company from time to time (collectively, the &ldquo;Program Brands&rdquo;). The legal contracting party under this Agreement is Company, even if websites, slide decks, emails, invoices, landing pages, portal screens, or other communications use one or more Program Brands. The OWNAFLEET Program includes relationships with Armada Fleet Management, LLC, Bevel Financial, Inc., EquipmentShare.com Inc, and other fleet managers, equipment providers, financing sources, vendors, program administrators, asset managers, service providers, or related counterparties (collectively, the &ldquo;OWNAFLEET Program&rdquo;). Company may register or use trade names, assumed names, or DBAs as required or appropriate.</p>

<p>1.2 <strong>Commercial Purchaser Referral Arrangement.</strong> Referrer may identify and refer potential commercial equipment buyers, participants, or purchaser entities to Company for evaluation in connection with the OWNAFLEET Program. The Parties intend this Agreement to govern commercial equipment-purchaser referrals only. This Agreement does not appoint Referrer to raise capital, sell securities, solicit investors, provide investment advice, provide tax advice, provide legal advice, act as a broker-dealer, act as an investment adviser, or act as an agent or representative of Company.</p>

<p>1.3 <strong>Mutual Protection.</strong> The Parties desire to protect documented referral relationships, confidential information, OWNAFLEET Program relationships, fee rights, and business opportunities from circumvention, improper solicitation, or misuse.</p>

<h2>2. Definitions</h2>

<p>2.1 &ldquo;<strong>Active Discussion</strong>&rdquo; means that, before the Documentation Date, Company or a Company Affiliate had a documented call, email exchange, meeting, CRM entry, portal submission, provider submission, proposal, term discussion, underwriting discussion, or other written record showing substantive discussion with the prospective purchaser or its Affiliate regarding the OWNAFLEET Program or a substantially similar commercial equipment transaction within the prior twelve (12) months.</p>

<p>2.2 &ldquo;<strong>Affiliate</strong>&rdquo; means, with respect to a person or entity, any person or entity directly or indirectly controlling, controlled by, under common control with, owned by, managed by, advised by, or otherwise affiliated with such person or entity, including any entity used by a Referred Purchaser to acquire, finance, own, lease, manage, or participate in the acquisition of Equipment.</p>

<p>2.3 &ldquo;<strong>Applicable Law</strong>&rdquo; means all applicable federal, state, and local laws, rules, regulations, orders, professional standards, licensing requirements, securities laws, broker-dealer laws, investment adviser laws, tax laws, privacy laws, marketing laws, anti-spam laws, unfair trade practice laws, and fiduciary or professional obligations applicable to a Party or its activities.</p>

<p>2.4 &ldquo;<strong>Approved Transaction</strong>&rdquo; means a transaction in which a Referred Purchaser or its Affiliate purchases Equipment through, with, or in connection with the OWNAFLEET Program and Company or a Company Affiliate actually receives a corresponding upstream fee, referral fee, aggregation fee, management fee, origination fee, program fee, revenue share, or other compensation attributable to such purchase.</p>

<p>2.5 &ldquo;<strong>Company Affiliate</strong>&rdquo; means any entity controlled by, under common control with, owned by, managed by, or affiliated with Company or Josh Cochran, including any entity used to receive, process, allocate, invoice, assign, or pay fees related to the OWNAFLEET Program. For clarity, Company may perform or process certain activities through affiliates, but Referrer&rsquo;s payment rights remain governed by this Agreement.</p>

<p>2.6 &ldquo;<strong>Confidential Information</strong>&rdquo; means all non-public information disclosed by either Party or learned in connection with this Agreement or the OWNAFLEET Program, including program economics, fee structures, purchaser lists, referral lists, lender contacts, vendor contacts, fleet-manager contacts, provider contacts, transaction terms, operating methods, documents, models, forms, pitch materials, workflows, deal terms, pricing, business plans, relationship information, and information concerning Armada Fleet Management, LLC, Bevel Financial, Inc., EquipmentShare.com Inc, or any other OWNAFLEET Program provider or counterparty.</p>

<p>2.7 &ldquo;<strong>Documentation Date</strong>&rdquo; means the date and time on which a Referral is first submitted through Company&rsquo;s website, online referral portal, CRM-connected referral form, approved tracking link, or other Company-approved electronic submission method. If the online portal is unavailable or Company expressly approves another method, the Documentation Date may be established by written email introduction, mutually acknowledged written submission, Company CRM entry, or other written record reasonably acceptable to Company.</p>

<p>2.8 &ldquo;<strong>Eligible Equipment Purchase Price</strong>&rdquo; means the gross purchase price of Equipment acquired by a Referred Purchaser or its Affiliate in an Approved Transaction, but only to the extent such purchase price is included in the fee base on which Company or a Company Affiliate actually receives its corresponding upstream fee or revenue. Unless Company agrees otherwise in writing, Eligible Equipment Purchase Price excludes sales tax, use tax, excise tax, delivery charges, freight, installation charges, insurance, financing costs, interest, late fees, penalties, warranties, service plans, repairs, maintenance costs, registration fees, licensing fees, governmental charges, reserves, deposits, refundable amounts, and other amounts that are not included in Company&rsquo;s actual upstream fee base.</p>

<p>2.9 &ldquo;<strong>Equipment</strong>&rdquo; means commercial equipment, heavy equipment, fleet assets, vehicles, machinery, attachments, or related assets acquired, financed, owned, leased, managed, or enrolled through or in connection with the OWNAFLEET Program.</p>

<p>2.10 &ldquo;<strong>Pre-Existing Relationship</strong>&rdquo; means a person or entity that, with respect to the same or a substantially similar OWNAFLEET-type commercial equipment opportunity and before the Documentation Date, was already known to Company, had already contacted Company, had already been contacted by Company, was already in Company&rsquo;s database or CRM, had already been introduced to Company by another source, or was already in Active Discussion with Company, a Company Affiliate, or a Program Provider, in each case as documented in Company&rsquo;s written records as of or before the Documentation Date. Company bears the burden of establishing Pre-Existing Relationship status as provided in Sections 3.6 and 6.1.</p>

<p>2.11 &ldquo;<strong>Program Provider</strong>&rdquo; means Armada Fleet Management, LLC, Bevel Financial, Inc., EquipmentShare.com Inc, and any other lender, lessor, vendor, equipment provider, fleet manager, rental manager, asset manager, service provider, program administrator, financing source, or similar counterparty introduced to Referrer by Company, identified to Referrer through the OWNAFLEET Program, or otherwise involved in the OWNAFLEET Program.</p>

<p>2.12 &ldquo;<strong>Referral</strong>&rdquo; means a portal-submitted or Company-approved written introduction by Referrer to Company of a potential commercial equipment buyer, purchaser, participant, or purchaser entity that was not already a Pre-Existing Relationship before the Documentation Date.</p>

<p>2.13 &ldquo;<strong>Referred Purchaser</strong>&rdquo; means any individual or entity that becomes the subject of a valid Referral, together with such individual&rsquo;s or entity&rsquo;s Affiliates, controlled entities, acquisition entities, special purpose entities, related entities, successors, assigns, or other entities through which the referred party acquires, finances, owns, manages, leases, or participates in an Approved Transaction.</p>

<p>2.14 &ldquo;<strong>Referral Fee</strong>&rdquo; means the fee payable by Company to Referrer under Section 4 of this Agreement.</p>

<p>2.15 &ldquo;<strong>Tail Period</strong>&rdquo; means the thirty-six (36) month period beginning on the Documentation Date. All references in this Agreement to a time period for fee rights, follow-on purchases, or Company&rsquo;s non-circumvention obligations with respect to a Referred Purchaser refer to the Tail Period.</p>

<h2>3. Referral Process</h2>

<p>3.1 <strong>Permitted Referral Activity; Portal Submissions.</strong> Referrer may identify potential Referred Purchasers and submit Referrals through Company&rsquo;s website, online referral portal, CRM-connected referral form, approved tracking link, or other Company-approved electronic submission method. Referrer may conduct its own outreach and communications, provided that Referrer complies with this Agreement and Applicable Law. Paper referral forms are not required unless Company later adopts them or approves them in writing.</p>

<p>3.2 <strong>No Agency Authority.</strong> Referrer has no authority to bind Company, make commitments on behalf of Company, amend or interpret OWNAFLEET Program terms on behalf of Company, approve any purchaser, approve any transaction, execute any agreement for Company, collect funds for Company, receive funds for Company, or make representations on behalf of Company.</p>

<p>3.3 <strong>No Obligation to Accept Referral.</strong> Company has no obligation to accept, approve, pursue, close, or continue any Referral or transaction. Company may reject or discontinue any Referral or transaction in its sole discretion, including for business, legal, compliance, reputational, underwriting, financing, provider, operational, or documentation reasons.</p>

<p>3.4 <strong>Direct Communications with Purchasers.</strong> Company and its representatives may communicate directly with any Referred Purchaser and its representatives as necessary or appropriate to evaluate, document, negotiate, close, administer, service, finance, manage, support, or complete any transaction or related matter involving the OWNAFLEET Program. Such direct communications do not affect Referrer&rsquo;s right to a Referral Fee under Section 6.1 if an Approved Transaction closes within the Tail Period.</p>

<p>3.5 <strong>First Documented Introduction Controls.</strong> If more than one person or entity claims a fee, commission, referral right, or similar compensation with respect to the same Referred Purchaser or transaction, the first valid Referral based on the earliest portal timestamp, CRM timestamp, approved tracking-link timestamp, or other Documentation Date will control, unless Company determines in good faith that the Referred Purchaser was a Pre-Existing Relationship or otherwise not eligible as a Referral under this Agreement.</p>

<p>3.6 <strong>Pre-Existing Relationships.</strong> No Referral Fee will be owed for any person or entity that was a Pre-Existing Relationship before the Documentation Date. The burden is on Company to establish, by written records pre-dating the Documentation Date, that a prospective purchaser was a Pre-Existing Relationship.</p>

<h2>4. Referral Fee</h2>

<p>4.1 <strong>Fee Amount.</strong> Subject to the terms of this Agreement, Company will pay Referrer a Referral Fee equal to the rate set forth on Schedule 1 to this Agreement (as populated at the time of Referrer&rsquo;s electronic acceptance) of the Eligible Equipment Purchase Price for each Approved Transaction involving a Referred Purchaser. For this Agreement, the Referral Fee rate is <strong>${fee}</strong> of the Eligible Equipment Purchase Price.</p>

<p>4.2 <strong>Condition to Earning Fee.</strong> A Referral Fee is earned only when all of the following have occurred:</p>
<ul>
<li>Referrer made a valid Referral under this Agreement;</li>
<li>the Referred Purchaser or its Affiliate completed an Approved Transaction within the Tail Period (no separate causation or origination showing is required beyond the valid Referral and the Approved Transaction closing within the Tail Period);</li>
<li>the Equipment purchase became final and was not rescinded, cancelled, unwound, rejected, or reversed at or before closing;</li>
<li>Company or a Company Affiliate actually received its corresponding upstream fee, referral fee, aggregation fee, management fee, revenue share, or other compensation attributable to the Approved Transaction; and</li>
<li>payment of the Referral Fee is lawful and permitted under this Agreement and Applicable Law.</li>
</ul>

<p>4.3 <strong>Payment Timing; Four-Week Payment Cycle.</strong> Company will calculate and pay earned Referral Fees on a four-week payment cycle. Referral Fees actually received and reconciled by Company or a Company Affiliate during a payment cycle will be paid within fourteen (14) days after the end of that payment cycle. No Referral Fee is payable until Company or a Company Affiliate has actually received the corresponding upstream fee or revenue attributable to the Approved Transaction.</p>

<p>4.4 <strong>No Payment Before Company Is Paid.</strong> Referrer acknowledges that Company is not required to pay any Referral Fee before Company or a Company Affiliate actually receives the corresponding upstream fee or revenue. Referrer assumes the risk of non-payment, delayed payment, partial payment, offset, dispute, refund, clawback, reduction, non-closing, or other non-receipt by Company or a Company Affiliate.</p>

<p>4.5 <strong>Proportionate Reduction.</strong> If Company or a Company Affiliate receives less than the expected upstream fee or revenue for any Approved Transaction, the Referral Fee will be reduced proportionately. If Company or a Company Affiliate receives no fee or revenue, no Referral Fee will be owed.</p>

<p>4.6 <strong>Follow-On Purchases.</strong> Subject to the terms of this Agreement, the Referral Fee will apply to additional Approved Transactions by a Referred Purchaser or its Affiliate during the Tail Period, but only if Company or a Company Affiliate actually receives a corresponding upstream fee or revenue on the additional Approved Transaction.</p>

<p>4.7 <strong>No Other Compensation.</strong> Except for the Referral Fee expressly provided in this Agreement, Referrer is not entitled to any commission, fee, equity, profit participation, promote, carried interest, ownership interest, revenue share, management fee, servicing fee, renewal fee, trailing fee, consulting fee, or other compensation from Company or any Company Affiliate.</p>

<p>4.8 <strong>Clawback.</strong> If any Approved Transaction is rescinded, refunded, unwound, reversed, cancelled, charged back, offset, disputed, reduced, or otherwise results in Company or a Company Affiliate being required to return, refund, credit, offset, reduce, or forgo any corresponding upstream fee or revenue, Referrer must promptly repay the affected Referral Fee to Company within ten (10) days after written demand. Company may offset any clawback amount against future amounts otherwise payable to Referrer.</p>

<p>4.9 <strong>Taxes and Reporting.</strong> Referrer is solely responsible for all taxes, reporting, filings, withholdings, licenses, professional obligations, and other requirements arising from any Referral Fee. Company may require a completed Form W-9, Form W-8, entity documents, payment instructions, evidence of authority, or other onboarding documentation before paying any Referral Fee.</p>

<p>4.10 <strong>Payment Method.</strong> Referral Fees will be paid by ACH, wire, check, or other payment method selected by Company after Referrer provides payment instructions reasonably acceptable to Company.</p>

<h2>5. Referrer Conduct, Compliance, and Restrictions</h2>

<p>5.1 <strong>Independent Conduct.</strong> Referrer is responsible for its own outreach, communications, materials, statements, business practices, professional obligations, licensing, compliance, and legal review. Referrer is not Company&rsquo;s employee, agent, broker, dealer, investment adviser, solicitor, fiduciary, representative, partner, joint venturer, or legal/tax adviser.</p>

<p>5.2 <strong>No Unauthorized Statements.</strong> Referrer must not make any false, misleading, incomplete, promissory, exaggerated, or unauthorized statement concerning Company, the OWNAFLEET Program, any Program Provider, any Equipment, any financing source, any tax result, any legal result, any investment result, any expected return, any downside protection, any depreciation benefit, any deduction, any revenue, any cash flow, or any guarantee.</p>

<p>5.3 <strong>No Tax, Legal, or Investment Advice on Behalf of Company.</strong> Referrer must not provide tax advice, legal advice, accounting advice, investment advice, financial planning advice, securities advice, suitability recommendations, fiduciary advice, or professional advice on behalf of Company. Any purchaser must be advised to consult its own independent tax, legal, accounting, investment, and financial advisers.</p>

<p>5.4 <strong>No Securities Placement or Investment Advisory Role.</strong> Referrer acknowledges that this Agreement is not intended to compensate Referrer for selling securities, soliciting investors, raising capital, recommending an investment, placing fund interests, advising on securities, or providing investment advisory solicitation services. Referrer must not characterize the OWNAFLEET Program as a securities offering or investment product on behalf of Company unless Company has expressly approved such characterization in writing after legal review.</p>

<p>5.5 <strong>No Handling Funds or Documents.</strong> Referrer must not receive, hold, transmit, control, or process purchaser funds, Company funds, Program Provider funds, subscription documents, securities documents, investment documents, tax elections, loan documents, financing documents, equipment-purchase documents, or closing documents on behalf of Company, unless Company gives express written approval.</p>

<p>5.6 <strong>Materials and Messaging.</strong> Company is not requiring Referrer to use Company-approved marketing materials and does not control Referrer&rsquo;s independent communications. However, Referrer may not state or imply that any materials, projections, summaries, tax discussions, legal discussions, financial illustrations, or other communications were prepared, approved, endorsed, reviewed, or authorized by Company unless Company has expressly approved them in writing. Referrer is solely responsible for any unapproved materials or statements Referrer uses.</p>

<p>5.7 <strong>Referral Fee and Conflict Disclosure.</strong> Company may disclose through the OWNAFLEET website, referral portal, program terms, FAQs, transaction acknowledgments, closing documents, or other written materials that referral fees may be paid in connection with the OWNAFLEET Program, including that Referrer may receive a Referral Fee as set forth on Schedule 1 if a Referred Purchaser completes an Approved Transaction. Referrer is not required by this Agreement to recite a Company-scripted disclosure in every communication. However, Referrer must not conceal, deny, or misrepresent the existence, nature, amount, or source of any Referral Fee. If a Referred Purchaser asks whether Referrer may be compensated, Referrer must answer truthfully. If Referrer is acting as or is associated with a financial planner, investment adviser, broker-dealer, fund manager, CPA, attorney, insurance agent, fiduciary, licensed professional, or regulated person, Referrer is solely responsible for making any client-facing compensation, conflict, fiduciary, professional, firm, or regulatory disclosures required by Applicable Law before or at the time of referral. Company may require Referred Purchasers to acknowledge referral-fee disclosures through the portal or transaction documents.</p>

<p>5.8 <strong>Professional and Firm Approval.</strong> If Referrer is, or is associated with, a financial planner, investment adviser, investment adviser representative, broker-dealer, registered representative, fund manager, capital raiser, CPA, attorney, insurance agent, lender, consultant, or other licensed or regulated person, Referrer represents that Referrer has obtained all firm, employer, client, regulatory, licensing, supervisory, disclosure, and professional approvals required to enter into this Agreement, make Referrals, and receive Referral Fees.</p>

<p>5.9 <strong>Conflicts and Client Duties.</strong> Referrer is solely responsible for identifying, disclosing, managing, and complying with any conflicts of interest, fiduciary duties, client duties, professional duties, firm policies, regulatory obligations, or disclosure obligations related to any Referral or Referral Fee.</p>

<p>5.10 <strong>No Guarantee of Results.</strong> Referrer must not guarantee or imply any guaranteed tax benefit, depreciation benefit, deduction, income, return, cash flow, equipment utilization, rental revenue, financing approval, asset value, liquidity, exit, sale, refinance, resale value, loss limitation, downside protection, or other result.</p>

<p>5.11 <strong>Compliance With Law.</strong> Referrer must comply with Applicable Law in all activities relating to this Agreement, the OWNAFLEET Program, Company, Program Providers, Referred Purchasers, and Referral Fees.</p>

<p>5.12 <strong>CAN-SPAM, TCPA, and Outreach Compliance.</strong> If Referrer sends email or text-message communications to prospective Referred Purchasers in connection with the OWNAFLEET Program, Referrer is solely responsible for complying with the CAN-SPAM Act, the Telephone Consumer Protection Act (TCPA), and all other applicable marketing, anti-spam, do-not-call, opt-out, and consent laws. Referrer must not send unsolicited commercial email or text messages on behalf of Company, represent that Company has approved any particular outreach campaign, or use Company&rsquo;s trademarks, brands, or domains in a manner that could be construed as Company-authorized bulk communications.</p>

<h2>6. Company Conduct and Referrer Protection</h2>

<p>6.1 <strong>Objective Fee-Survival Rule.</strong> If a Referred Purchaser or its Affiliate completes an Approved Transaction at any time within the Tail Period, and Company or a Company Affiliate actually receives its corresponding upstream fee or revenue attributable to that transaction, Company will pay Referrer the applicable Referral Fee &mdash; regardless of the channel through which the transaction closed, the path by which the Referred Purchaser reached Company, a Company Affiliate, or a Program Provider, or any internal origination designation used by Company. This obligation applies even if Company independently solicited or co-sourced the transaction, unless Company can establish by written records pre-dating the Documentation Date that the Referred Purchaser was a Pre-Existing Relationship not subject to this Agreement.</p>

<p>6.2 <strong>No Targeted Circumvention.</strong> During the Tail Period, Company will not take steps designed to structure, route, or document a transaction involving a Referred Purchaser in a manner intended to remove it from the scope of Section 6.1 or otherwise deprive Referrer of a Referral Fee earned under this Agreement.</p>

<p>6.3 <strong>Permitted Company Activity.</strong> The provisions of Sections 6.1 and 6.2 do not prohibit Company or any Company Affiliate from:</p>
<ul>
<li>communicating with Referred Purchasers to evaluate, document, negotiate, close, administer, service, manage, or support any transaction;</li>
<li>responding to inbound communications from a Referred Purchaser;</li>
<li>sending general marketing, newsletters, webinars, educational content, public solicitations, or broadly distributed communications not specifically designed to bypass Referrer;</li>
<li>engaging with any Pre-Existing Relationship;</li>
<li>conducting business with any purchaser where no Referral Fee is owed under this Agreement;</li>
<li>complying with Program Provider requirements, lender requirements, financing requirements, documentation requirements, legal requirements, or business requirements;</li>
<li>communicating with a Referred Purchaser after the Tail Period has expired; or</li>
<li>taking any action reasonably necessary to protect Company, a Company Affiliate, a Program Provider, or a transaction.</li>
</ul>

<p>6.4 <strong>No Broader Restriction.</strong> Nothing in this Agreement prevents Company from operating OWNAFLEET, conducting equipment transactions, marketing to the public, working with Program Providers, working with other referrers, working with purchasers not subject to a valid Referral, or conducting its business generally.</p>

<h2>7. Non-Circumvention by Referrer</h2>

<p>7.1 <strong>No Provider Circumvention.</strong> Referrer must not, directly or indirectly, bypass, circumvent, avoid, interfere with, or attempt to bypass, circumvent, avoid, or interfere with Company&rsquo;s relationship, compensation, business opportunity, or contractual rights involving any Program Provider introduced to Referrer by Company, disclosed through Company, identified through the OWNAFLEET Program, or otherwise made known to Referrer in connection with this Agreement.</p>

<p>7.2 <strong>Restricted Conduct.</strong> Without limiting Section 7.1, Referrer must not, directly or indirectly, without Company&rsquo;s prior written consent:</p>
<ul>
<li>contact, solicit, contract with, or transact directly with any Program Provider for the purpose of replacing, avoiding, or bypassing Company;</li>
<li>introduce Referred Purchasers or other purchasers directly to any Program Provider in a manner intended to bypass Company;</li>
<li>disclose the identity, contact information, or involvement of any Program Provider to any Referred Purchaser or prospective purchaser;</li>
<li>use Confidential Information to establish a competing or bypass arrangement with any Program Provider;</li>
<li>divert or attempt to divert Company&rsquo;s OWNAFLEET Program relationships, fees, economics, purchaser relationships, or opportunities;</li>
<li>misrepresent Company&rsquo;s role in the OWNAFLEET Program; or</li>
<li>assist any third party in doing any of the foregoing.</li>
</ul>

<p>7.3 <strong>Duration.</strong> The restrictions on contacting, soliciting, contracting with, or transacting directly with Program Providers (Sections 7.1 and 7.2) apply during the term of this Agreement and for the Tail Period after the Documentation Date applicable to any Referral involving the relevant Program Provider. Confidentiality and trade-secret duties under this Section 7 and Section 9 with respect to Confidential Information survive for so long as the relevant information remains non-public, to the maximum extent permitted by Applicable Law. All restrictions in this Section 7 apply only to the extent permitted by Applicable Law, including RCW 49.62 (Washington noncompetition covenants) where applicable.</p>

<p>7.4 <strong>Permitted Existing Relationships.</strong> The restrictions in this Section 7 do not prohibit Referrer from continuing a bona fide pre-existing relationship with a Program Provider if Referrer can document that such relationship existed before Company introduced or disclosed the Program Provider to Referrer, provided that Referrer may not use Company&rsquo;s Confidential Information, OWNAFLEET Program economics, documents, purchaser information, or transaction information to expand, redirect, or convert that relationship in a manner that bypasses Company.</p>

<h2>8. Non-Solicitation</h2>

<p>8.1 <strong>No Solicitation of Company Relationships.</strong> Referrer must not use Confidential Information to solicit, divert, or interfere with Company&rsquo;s OWNAFLEET Program relationships, Program Provider relationships, purchaser relationships, referral-source relationships, vendor relationships, lender relationships, contractor relationships, employee relationships, consultant relationships, or business opportunities.</p>

<p>8.2 <strong>No Diversion of Referred Purchasers.</strong> Company must not take steps to divert a Referred Purchaser in a manner that would violate Section 6.1 or 6.2 of this Agreement.</p>

<p>8.3 <strong>No Restriction on General Business.</strong> The Parties acknowledge that this Agreement is not intended to impose a broad noncompetition covenant. The restrictions are limited to protecting documented referrals, Confidential Information, fee rights, and business relationships arising from this Agreement and the OWNAFLEET Program.</p>

<h2>9. Confidentiality</h2>

<p>9.1 <strong>Confidentiality Obligation.</strong> Each Party must keep the other Party&rsquo;s Confidential Information confidential and may use such Confidential Information only for purposes of performing under this Agreement.</p>

<p>9.2 <strong>No Disclosure.</strong> A Party receiving Confidential Information must not disclose it to any third party except to its attorneys, accountants, tax advisers, compliance advisers, employees, contractors, or representatives who have a need to know and are bound by confidentiality obligations, or as otherwise required by law.</p>

<p>9.3 <strong>Program Provider Confidentiality.</strong> Referrer must not disclose, publish, copy, distribute, reverse engineer, or use any non-public OWNAFLEET Program economics, Program Provider identities, Program Provider contacts, Program Provider terms, transaction structures, fee arrangements, purchaser lists, or operational information. Referrer must not disclose the identity, name, contact information, or involvement of any Program Provider to any Referred Purchaser or prospective purchaser, except (a) with Company&rsquo;s prior written consent, (b) through Company-approved materials that Company has expressly authorized for use with that purchaser, or (c) as required by Applicable Law.</p>

<p>9.4 <strong>Return or Destruction.</strong> Upon request, each Party must return or destroy the other Party&rsquo;s Confidential Information, except that each Party may retain archival copies as required for legal, tax, compliance, or recordkeeping purposes.</p>

<p>9.5 <strong>Exclusions.</strong> Confidential Information does not include information that is publicly available through no breach of this Agreement, independently developed without use of Confidential Information, received from a third party without breach of duty, or required to be disclosed by law.</p>

<h2>10. Representations and Warranties</h2>

<p>10.1 <strong>Mutual Representations.</strong> Each Party represents and warrants that:</p>
<ul>
<li>it has authority to enter into this Agreement;</li>
<li>entering into and performing this Agreement will not violate any agreement or obligation binding on it;</li>
<li>it will comply with Applicable Law;</li>
<li>it will not make false or misleading statements in connection with this Agreement; and</li>
<li>it will perform its obligations in a professional and commercially reasonable manner.</li>
</ul>

<p>10.2 <strong>Referrer Representations.</strong> Referrer further represents and warrants that:</p>
<ul>
<li>Referrer is legally permitted to make Referrals and receive Referral Fees;</li>
<li>Referrer has obtained all required firm, employer, client, licensing, and regulatory approvals;</li>
<li>Referrer is not relying on Company for legal, tax, accounting, regulatory, licensing, professional, or compliance advice;</li>
<li>Referrer is solely responsible for its own tax and regulatory treatment;</li>
<li>Referrer will disclose compensation and conflicts as required by this Agreement and Applicable Law;</li>
<li>Referrer will not hold itself out as Company&rsquo;s agent, employee, broker, adviser, representative, or fiduciary;</li>
<li>Referrer will not provide tax, legal, accounting, investment, or financial advice on behalf of Company;</li>
<li>Referrer will not handle purchaser funds or Company funds;</li>
<li>Referrer will not use unauthorized statements, guarantees, projections, or promises; and</li>
<li>Referrer is not subject to any disqualification, disciplinary order, suspension, bar, regulatory restriction, criminal conviction, or other event that would make Referrer&rsquo;s activities or compensation unlawful or inappropriate, unless fully disclosed in writing to Company before any Referral.</li>
</ul>

<p>10.3 <strong>Referrer Data Privacy Representations.</strong> Referrer represents and warrants that: (a) Referrer has the legal right to share the name, email address, phone number, and other contact information of any Referred Purchaser with Company; (b) Referrer has made any disclosures to the Referred Purchaser about sharing their information with third parties as required by Applicable Law; and (c) Referrer&rsquo;s collection, use, and sharing of Referred Purchaser contact information complies with Applicable Law, including applicable privacy laws.</p>

<h2>11. Indemnification and Limitation of Liability</h2>

<p>11.1 <strong>Referrer Indemnity.</strong> Referrer will indemnify, defend, and hold harmless Company, Company Affiliates, Josh Cochran, and their respective members, managers, officers, employees, contractors, representatives, agents, successors, and assigns from and against all claims, damages, losses, liabilities, penalties, fines, costs, expenses, disputes, regulatory inquiries, purchaser claims, Program Provider claims, and attorneys&rsquo; fees to the extent arising out of or relating to:</p>
<ul>
<li>Referrer&rsquo;s breach of this Agreement;</li>
<li>Referrer&rsquo;s fraud, willful misconduct, gross negligence, or negligent misrepresentation;</li>
<li>Referrer&rsquo;s violation of Applicable Law;</li>
<li>Referrer&rsquo;s unauthorized statements, materials, promises, guarantees, projections, or representations;</li>
<li>Referrer&rsquo;s tax, legal, accounting, investment, financial, or professional advice given on behalf of Company or in connection with the OWNAFLEET Program;</li>
<li>Referrer&rsquo;s failure to obtain required firm, employer, client, licensing, professional, or regulatory approvals;</li>
<li>Referrer&rsquo;s failure to make required compensation, conflict, fiduciary, professional, firm, client, or regulatory disclosures;</li>
<li>Referrer&rsquo;s misuse or unauthorized disclosure of Confidential Information;</li>
<li>Referrer&rsquo;s circumvention or attempted circumvention of Company, the OWNAFLEET Program, or a Program Provider;</li>
<li>Referrer&rsquo;s violation of professional, licensing, regulatory, client, employer, fiduciary, or firm obligations; or</li>
<li>any claim by a Referred Purchaser, Program Provider, regulator, or third party based on Referrer&rsquo;s conduct, statements, omissions, materials, or independent business practices.</li>
</ul>
<p>Referrer will not be required to indemnify Company to the extent a claim is finally determined by a court of competent jurisdiction to have been caused by Company&rsquo;s fraud, willful misconduct, or intentional breach of this Agreement.</p>

<p>11.2 <strong>Company Indemnity.</strong> Company will indemnify and hold harmless Referrer from third-party claims arising solely from Company&rsquo;s fraud, willful misconduct, or intentional breach of its payment obligations under Section 6.1 of this Agreement, except to the extent the claim arises from Referrer&rsquo;s breach, conduct, statements, omissions, materials, or violation of Applicable Law.</p>

<p>11.3 <strong>Procedure.</strong> The indemnified Party must provide prompt written notice of any claim for indemnification. Failure to provide prompt notice will not relieve the indemnifying Party except to the extent the delay materially prejudices the defense. The indemnifying Party may control the defense with counsel reasonably acceptable to the indemnified Party, provided that no settlement may impose liability, admission, payment, or obligation on the indemnified Party without its written consent.</p>

<p>11.4 <strong>Limitation of Liability.</strong></p>
<ul>
<li><strong>Cap.</strong> Each Party&rsquo;s aggregate liability to the other Party under or in connection with this Agreement will not exceed the total Referral Fees actually paid or payable by Company to Referrer in the twelve (12) months immediately preceding the event giving rise to the claim.</li>
<li><strong>Consequential Damages Waiver.</strong> Neither Party will be liable to the other for any indirect, incidental, special, consequential, punitive, or exemplary damages arising out of or related to this Agreement, including lost profits, loss of business opportunity, or loss of goodwill, even if advised of the possibility of such damages.</li>
<li><strong>Earned Fees Not Consequential Damages.</strong> For the avoidance of doubt, unpaid Referral Fees earned under Section 4 are direct contract obligations, not consequential or indirect damages, and are not subject to the cap or waiver in this Section 11.4.</li>
<li><strong>Exceptions.</strong> The limitations in this Section 11.4 do not apply to: (i) fraud or willful misconduct by either Party; (ii) a Party&rsquo;s breach of its confidentiality obligations under Section 9; (iii) Referrer&rsquo;s non-circumvention obligations under Section 7; (iv) Company&rsquo;s payment obligations under Sections 4 and 6.1; (v) Company&rsquo;s anti-circumvention obligations under Sections 6.1 and 6.2; or (vi) a Party&rsquo;s indemnification obligations for third-party claims under Sections 11.1 and 11.2.</li>
</ul>

<h2>12. Term and Termination</h2>

<p>12.1 <strong>Term.</strong> This Agreement begins on the Effective Date and continues until terminated by either Party.</p>

<p>12.2 <strong>Termination Without Cause.</strong> Either Party may terminate this Agreement at any time by written notice to the other Party.</p>

<p>12.3 <strong>Termination for Cause.</strong> Company may terminate this Agreement immediately by written notice if Referrer breaches this Agreement, violates Applicable Law, makes unauthorized statements, creates regulatory or reputational risk, attempts to circumvent Company, fails to disclose compensation or conflicts, or engages in conduct that Company determines in good faith could harm Company, the OWNAFLEET Program, a Program Provider, or a Referred Purchaser.</p>

<p>12.4 <strong>Effect of Termination; Post-Termination Fee Survival.</strong> Termination does not affect any Referral Fee earned before termination. In addition, any Referral Fee that becomes earned after termination because a Referred Purchaser completes an Approved Transaction within the Tail Period (as measured from the Documentation Date) will remain payable by Company in accordance with Section 4, provided all conditions in Section 4.2 are satisfied as of the closing date of the Approved Transaction. Termination also does not eliminate any clawback, confidentiality, non-circumvention, non-solicitation, indemnity, dispute-resolution, records, audit, or other obligation that by its nature should survive termination.</p>

<p>12.5 <strong>Survival.</strong> Sections 4 through 16 survive termination to the extent necessary to protect the Parties&rsquo; rights and obligations, including Referrer&rsquo;s right to receive Referral Fees for Approved Transactions closing within the Tail Period after the termination date.</p>

<h2>13. Records and Audit Rights</h2>

<p>13.1 <strong>Referral Records.</strong> Company may maintain portal records, CRM records, tracking-link data, timestamps, submitter information, Referred Purchaser information, Approved Transaction records, fee calculations, payment dates, clawbacks, and related matters. Company&rsquo;s portal, CRM, and payment records will be presumptive evidence of the Documentation Date, referral status, fee calculation, and payment status, absent manifest error. For clarity, this presumption does not shift Company&rsquo;s burden to establish Pre-Existing Relationship status under Sections 3.6 and 6.1.</p>

<p>13.2 <strong>Referrer Records.</strong> Referrer must maintain accurate records sufficient to demonstrate compliance with this Agreement, including records of introductions, required approvals, and communications with Referred Purchasers. If Referrer is legally, professionally, contractually, or regulatorily required to make compensation, conflict, fiduciary, firm, client, or similar disclosures, Referrer must also maintain records of such disclosures.</p>

<p>13.3 <strong>Verification.</strong> Upon reasonable request, Referrer must provide Company with documentation reasonably necessary to verify compliance with this Agreement, including evidence that required compensation disclosures were made, if applicable to Referrer.</p>

<h2>14. Equitable Relief</h2>

<p>14.1 <strong>Irreparable Harm.</strong> The Parties agree that breach of the confidentiality, non-circumvention, non-solicitation, or misuse-of-information provisions may cause irreparable harm that is difficult to measure with money damages.</p>

<p>14.2 <strong>Injunctive Relief.</strong> The injured Party may seek temporary, preliminary, or permanent injunctive relief, specific performance, or other equitable relief without posting bond, in addition to any other remedies available at law or in equity.</p>

<h2>15. Dispute Resolution, Governing Law, and Venue</h2>

<p>15.1 <strong>Informal Resolution.</strong> Before filing suit, the Parties will attempt in good faith to resolve any dispute through direct written communication and at least one executive-level discussion, unless immediate injunctive relief is reasonably necessary.</p>

<p>15.2 <strong>Governing Law.</strong> This Agreement is governed by the laws of the State of Washington, without regard to conflict-of-law principles.</p>

<p>15.3 <strong>Venue.</strong> Any dispute arising out of or relating to this Agreement must be brought in the state or federal courts located in Spokane County, Washington, and each Party consents to personal jurisdiction and venue in those courts.</p>

<p>15.4 <strong>Attorneys&rsquo; Fees.</strong> The prevailing Party in any action or proceeding arising out of or relating to this Agreement is entitled to recover its reasonable attorneys&rsquo; fees, expert fees, costs, and expenses.</p>

<h2>16. General Provisions</h2>

<p>16.1 <strong>Independent Contractors.</strong> The Parties are independent contractors. Nothing in this Agreement creates an employment, agency, partnership, joint venture, fiduciary, broker-dealer, investment adviser, solicitor, franchise, or representative relationship.</p>

<p>16.2 <strong>Assignment.</strong> Referrer may not assign this Agreement or any rights or obligations under it without Company&rsquo;s prior written consent. Company may assign this Agreement to a Company Affiliate or successor, or in connection with any reorganization, merger, sale, transfer, or restructuring of the OWNAFLEET Program or Company&rsquo;s business, provided that (a) the assignee must assume in writing all of Company&rsquo;s accrued, unpaid, and future Tail Period payment obligations to Referrer under this Agreement as a condition of the assignment, and (b) Company will remain liable for such obligations unless Referrer provides a written release of Company.</p>

<p>16.3 <strong>No Third-Party Beneficiaries.</strong> This Agreement is for the benefit of the Parties and their permitted successors and assigns only. No Referred Purchaser, Program Provider, or other third party has rights under this Agreement.</p>

<p>16.4 <strong>Severability and Modification.</strong> If any provision is found invalid, illegal, or unenforceable, it will be modified to the minimum extent necessary to make it enforceable, and the remaining provisions will remain in effect.</p>

<p>16.5 <strong>Entire Agreement.</strong> This Agreement is the entire agreement between the Parties regarding its subject matter and supersedes all prior or contemporaneous discussions, negotiations, proposals, emails, term sheets, and understandings regarding such subject matter.</p>

<p>16.6 <strong>Amendments.</strong> This Agreement may be amended only by a written instrument signed by both Parties.</p>

<p>16.7 <strong>Waiver.</strong> No waiver is effective unless in writing and signed by the Party granting the waiver. No waiver of one breach is a waiver of any other breach.</p>

<p>16.8 <strong>Counterparts and Electronic Signatures.</strong> This Agreement may be signed in counterparts and by electronic signature, each of which is deemed an original and all of which together constitute one instrument. The Parties agree to conduct this transaction by electronic means pursuant to the federal Electronic Signatures in Global and National Commerce Act (ESIGN Act, 15 U.S.C. &sect; 7001 et seq.) and applicable state electronic-transactions laws, and intend Referrer&rsquo;s electronic acceptance under Section 17 to constitute Referrer&rsquo;s legally binding electronic signature. Referrer expressly consents to receive this Agreement and all related notices and disclosures electronically.</p>

<p>16.9 <strong>Notices.</strong> Notices must be in writing and delivered by email, personal delivery, nationally recognized overnight courier, or certified mail to the addresses below, or to any updated notice address provided in writing.</p>

<p>Company Notice Address:<br>Cochran Management, LLC<br>600 1st Ave, Suite 330, PMB 74869<br>Seattle, WA 98104-2205<br>Email: josh@cochrancap.com</p>

<p>Referrer Notice Address: the name, mailing address (if provided), and email address Referrer supplied through the partner application or portal account, as updated in writing.</p>

<h2>17. Electronic Acceptance</h2>

<p>Referrer accepts and signs this Agreement electronically by (a) typing Referrer&rsquo;s full legal name, (b) checking the acceptance box, and (c) clicking &ldquo;Agree &amp; Sign.&rdquo; Company records and retains the signed name, the date and time of acceptance, the network (IP) address and browser identifier used, the version of this Agreement, and a cryptographic hash of the exact agreement text presented. Company is deemed to execute this Agreement by countersignature or by confirming Referrer&rsquo;s acceptance in writing (including by email confirmation), and Company&rsquo;s activation of Referrer&rsquo;s partner account constitutes Company&rsquo;s acceptance. Referrer may request a paper copy of this Agreement at any time by emailing josh@cochrancap.com. A copy of this Agreement is emailed to Referrer upon acceptance.</p>

<p><strong>By accepting, Referrer also certifies that:</strong></p>
<ul>
<li>Referrer has reviewed the Agreement;</li>
<li>Referrer understands that the arrangement relates only to commercial equipment-purchaser referrals;</li>
<li>Referrer is not authorized to act as Company&rsquo;s agent;</li>
<li>Referrer has made or will make any required compensation disclosures applicable to Referrer;</li>
<li>Referrer has obtained all required firm, employer, client, licensing, and regulatory approvals;</li>
<li>Referrer is solely responsible for its own legal, tax, regulatory, professional, and compliance obligations;</li>
<li>Referrer will not provide tax, legal, accounting, investment, or financial advice on behalf of Company;</li>
<li>Referrer will not guarantee any outcome; and</li>
<li>Referrer will not circumvent Company, disclose Program Provider identities to referred purchasers, or misuse Confidential Information.</li>
</ul>

<h2>Exhibit A — Referral Portal Submission Fields and Terms</h2>

<p>Referrals are intended to be submitted through Company&rsquo;s website, online referral portal, CRM-connected referral form, approved tracking link, or other Company-approved electronic submission method. No paper submission form is required unless Company later adopts or approves one in writing.</p>

<p>The referral portal may request information such as: Referrer name; Referrer entity, if any; Referrer email and phone number; prospective purchaser name; prospective purchaser entity, if known; prospective purchaser email and phone number; prospective purchaser state or market; known affiliated or controlled purchaser entities; source of relationship; summary of introduction; whether Referrer is acting in any licensed, professional, fiduciary, advisory, or regulated capacity with respect to the prospective purchaser; whether Referrer has any firm, employer, client, professional, or regulatory disclosure obligations; portal acknowledgment of this Agreement; and any other information Company reasonably requests.</p>

<p>The portal timestamp, CRM timestamp, approved tracking-link timestamp, or other Company-approved electronic record will establish the Documentation Date unless Company determines in good faith that the Referral was incomplete, inaccurate, duplicative, a Pre-Existing Relationship, or otherwise ineligible under this Agreement.</p>

<p>Company may require a Referrer to update or confirm portal information before any Referral Fee becomes payable.</p>

<h2>Exhibit B — Referral Fee Disclosure Framework</h2>

<p>Company may provide referral-fee disclosure through the OWNAFLEET website, referral portal, program terms, FAQs, transaction acknowledgments, closing documents, or other written materials. The disclosure may state substantially:</p>

<p>&ldquo;OWNAFLEET, Cochran Management, LLC, or their program partners may pay referral fees to referral partners who introduce equipment purchasers to the OWNAFLEET Program. A referral partner may receive a Referral Fee as set forth in their partner agreement if a referred purchaser completes an equipment purchase through the OWNAFLEET Program. This compensation creates a financial incentive for referral partners to make introductions.&rdquo;</p>

<p>Referrer is not required by this Agreement to use a Company-scripted disclosure in every communication. Referrer remains solely responsible for any disclosure obligations that apply to Referrer because of Referrer&rsquo;s own professional, fiduciary, client, firm, licensing, employment, regulatory, or legal obligations. Referrer must not conceal, deny, or misrepresent the existence, nature, amount, or source of any Referral Fee.</p>

<h2>Schedule 1 — Referral Fee Rate</h2>

<p>Pursuant to Section 4.1, the Referral Fee rate applicable to this Agreement is:</p>

<p><strong>${fee}</strong> of the Eligible Equipment Purchase Price for each Approved Transaction.</p>

<p>This rate is set at the time of Referrer&rsquo;s electronic acceptance and is incorporated into the cryptographic hash of this Agreement stored in Company&rsquo;s records. Any change to Referrer&rsquo;s Referral Fee rate requires a new version of this Agreement, which Referrer will be asked to review and re-sign.</p>
`.trim();
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
