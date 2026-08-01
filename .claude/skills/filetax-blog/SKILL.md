---
name: filetax-blog
description: Writes, rewrites and reviews articles for filetax.co, a self-serve portal that prepares IRS Form 5472 and pro forma 1120 filings for non-US owners of US single-member LLCs. Use this whenever the user is drafting, merging, editing, reviewing or planning a filetax.co article, working with the posts in the filetax Sanity dataset, or asking how to improve an existing /resources page. Also use it when they ask about internal linking, FAQ blocks, meta descriptions, tables, schema or publishing cadence for that site, and when they paste a draft and ask what to change. It covers voice, structure, query coverage, the verified IRS facts, the renderer's limits and the conversion rules specific to this site. It is distinct from the sister-site blog skill on this machine: different audience, different product, different voice.
---

# Writing for filetax.co

## Why this skill exists

Measured across the 36 posts in the dataset on 30 July 2026, published and scheduled:

- **All 36** carry the identical skeleton: opening, "What You Need to Know First", body sections, "What This Means for Your Filing", then exactly six FAQ questions.
- **All 36 contain zero internal links.** Not one article links to another in its body. The original prompt deferred linking to a manual pass that was never run, so the placeholders were resolved into plain text. Articles say things like "see Form 5472 Field by Field" as unclickable prose.
- 29 of 36 land between 7,000 and 11,900 characters.
- The library earns **56 distinct queries in total**, roughly two per article, against 1,106 lifetime impressions and 3 clicks.

A sister site ran the same pattern and has the outcome on record: 51 posts to one template, 45 with exactly six FAQ questions, and impressions falling from 4,364 in a month to 667 four months later. Assume the same result here unless the pattern is broken.

Nothing in the existing posts is factually wrong. The citation quality is genuinely good. The problem is that every page is assembled to the same shape and each one answers about two questions.

## What is fixed and what bends

The failure this skill exists to prevent came from treating every rule as equally binding, which produced 36 posts of the same shape. So the rules are graded. Apply them at their stated strength, not uniformly.

**Hard, never break.** Breaking one of these produces a factual error, a legal exposure, or something the site cannot publish.

- The verified IRS facts and citations, exactly as written
- Never inventing a statute number, a statistic, or an enforcement claim
- No em dashes
- The renderer's limits: no format the site cannot display
- Every internal link points at a slug that exists
- Any credential or review claim is true of that specific post

**Strong default, bend with a reason.** These are right in the large majority of cases. Depart when the topic genuinely calls for it, and say why in the handover note.

- Two CTAs, placed as described
- Three to six internal links
- Direct answer block near the top
- Answer first, reasoning second
- Four columns maximum in a table
- The word-count bands
- Three `relatedPosts`

**Deliberately open.** Fixing these is what caused the problem. Let the topic decide.

- How many FAQ questions
- How many sections, and what they are called
- Whether a table appears at all
- Total length
- Whether the post opens with a scenario, a number, a definition or a direct answer

The test for any departure: does this serve the reader and the query, or does it just fit the pattern? A library where every post made the same choice is evidence the pattern won.

## Audience

Non-US nationals who own a US single-member LLC. Founders, freelancers, Amazon FBA sellers, SaaS builders, ecommerce operators. Most formed through Stripe Atlas, doola, Firstbase, or a formation agent, and were never told Form 5472 existed. They are not tax professionals and English is often not their first language.

They arrive in one of three states, and the post should know which:

1. **Have not filed and do not know they should.** Searching the formation platform's name or general LLC tax questions.
2. **Have just discovered the requirement.** Searching the penalty amount. Frightened. This is the highest-converting state.
3. **Have an IRS notice in hand.** Searching a notice number, CP15 or CP215. Urgent.

Their fear is an unbounded professional bill on top of an unbounded penalty. Naming a fixed price is reassurance, not just marketing.

## Voice

Calm, direct, institutional. A practitioner explaining something important to a smart non-specialist. Short declarative sentences. No theatrics.

The portal speaks as an organisation, not as a person. This is deliberate, and differs from the sister-site skill on this machine, where a named CPA speaks in the first person.

**Never use em dashes.** Use a comma, a colon, or a full stop. This applies to body, headings, FAQ answers, excerpt, SEO title and meta description without exception.

Never use: delve, unlock, game changer, in conclusion, it is important to note, it is worth noting, tapestry, vibrant, robust, leverage as a verb, streamline, comprehensive guide, ultimate guide, in this article we'll explore, let's dive in, we've got you covered, whether you're, needless to say. Do not open a paragraph with Moreover or Furthermore.

No callout labels: no "Key Takeaway:", "Pro Tip:", "Important:".

Bold only for dollar amounts, deadlines, statute references, and a key term on first use. Two or three times per section at most.

### Do not hedge

- Not "the penalty may be $25,000". It **is** $25,000.
- Not "you generally need to file by April 15". "You must file by April 15. Form 7004 extends this to October 15."
- Never close with "consult a tax advisor". Give a specific next action.

Where real uncertainty exists, name it: "The IRS has not published guidance on this" beats "may".

### Be specific

Weak: "Many founders discover the requirement years later."

Strong: "An Indian founder forms a Wyoming LLC in March 2022. The 2022 deadline is April 15, 2023. He discovers the requirement applying for a Mercury account in November 2024. Two years are late."

## Query coverage, the main ranking lever

This is the change that matters most. A page earns traffic by answering many related questions, not one.

Before writing, list every question a reader could type that this post should answer. Aim for **15 to 40**. Cover:

- The head term and its variants: "form 5472", "form5472", "5472 form", "irs form 5472"
- Questions: "who has to file form 5472", "what happens if I file 5472 late", "do I need form 5472 if my LLC had no income"
- Comparisons: "form 5472 vs 5471", "is 5472 the same as FBAR"
- Situations: "form 5472 dormant llc", "form 5472 single member llc uk owner"
- Procedure: "where to mail form 5472", "can I fax form 5472", "form 5472 deadline 2026"

Then write so each is answered explicitly, in wording close to how it would be asked. Do not create a section per question. Fold them into prose and FAQ.

Output the list at the end under QUERY COVERAGE so it can be checked. It is a working artifact, not part of the post.

## Structure

Only the opening and the close are fixed in **function**. Their wording varies per post.

**Opening**: answer the core question in three or four sentences. No preamble.

**Direct answer block**: the complete answer standing alone, three to five sentences. First sentence answers with no qualifier. Then the amount, deadline or rule that matters most. Then the most common scenario. Optionally what to do next.

Head it with a real question or statement specific to the post. "Who has to file Form 5472?" or "What the $25,000 penalty actually applies to". **Never reuse the same heading across posts.** The existing library uses "What You Need to Know First" on all 36, which is the single most visible sign of assembly.

**Body**: H2 and H3 as the topic requires. Question-shaped H2s where natural.

**Close**: one or two paragraphs synthesising what to do, opening with one specific action. No new information. Vary the heading.

**FAQ**: length set by the topic. A narrow procedural post may justify five questions. A broad one may justify twenty-five. **There is no fixed count.** The old rule of exactly six was justified as "consistency helps SEO", which is not true, and it capped long-tail coverage on broad topics while padding narrow ones.

- Phrase questions as typed: "Can I file Form 5472 late?" not "Late Filing of Form 5472"
- Three to five sentences each, self-contained, no "see above"
- First sentence gives the direct yes, no, or number
- "Q:" and "A:" prefixes
- Do not repeat a question already answered verbatim in the body

## Answer engines and AI search

This audience increasingly asks ChatGPT, Perplexity and Claude rather than Google. Claude-SearchBot made 30 requests to the site in one 24 hour window, second only to Googlebot's 48.

- **Every section must stand alone.** Assume any two or three paragraphs may be extracted with no context. Never open a section with "This", "That said", or "As noted above".
- **Answer first, reasoning second.** Never build to a conclusion.
- **One quotable sentence per section**: self-contained, with its number attached. "The penalty for a late Form 5472 is $25,000 per form, per year, and it applies whether or not the LLC had any income."
- **Full entity names in each section.** "Form 5472", not "the form". An extracted section loses earlier definitions.
- **Attribute in the sentence**: "Under IRC §6038A(d)(1), the penalty is $25,000." Answer engines preferentially quote attributed statements.
- One definition paragraph per post, written to be lifted whole.
- At least one IRS.gov reference.

## What the renderer supports

H2, H3, paragraphs, blockquote, bulleted and numbered lists, links, bold, italic, images, and tables.

### Tables

Supported since July 2026, in both the Studio schema and the site renderer. Use one where a comparison is genuinely two-dimensional: two or more things compared across two or more attributes. Form 5472 against Form 5471 across who files, direction and penalty. Relief paths across eligibility, cost and outcome.

Do not use a table for a plain list, for one item's attributes, or to hold prose. If a cell needs a full sentence, it is paragraphs.

- First row is the header. Always supply one.
- Four columns maximum. The article column is 740px and wider tables scroll sideways on a phone.
- Cells are plain text. No bold, links or lists inside a cell.
- Introduce each table with a sentence saying what it compares, and follow it with the conclusion to draw.
- **Never put a fact only in a table.** Extraction of tables is unreliable, so anything load-bearing must also exist as a sentence.

## Internal linking

**Write real links, not placeholders.** The previous prompt deferred this and it never happened, which is why all 36 posts have none.

Three to six links per post, in the body where editorially natural, never as a block at the end. Anchor text describes the destination: "how the statute of limitations works for unfiled Form 5472", never "click here".

Narrow posts link up to the pillar. Pillars link down to spokes. Spokes link sideways only where a reader would genuinely need the other page.

Use `/resources/<slug>`. **Verify the slug exists before using it.** If the target does not exist yet, omit the link rather than guess.

Also set `relatedPosts` to three entries. It is a separate mechanism and both are required.

## Conversion

Two CTAs. One mid-post, immediately after the section resolving the reader's most urgent question, where relief is highest. One in the close. Never more than two.

Match to situation:

- **Technical and planning**: "If your LLC is foreign-owned with a single related party and standard transactions, filetax.co generates your completed Form 5472 and pro forma 1120 packet in under 15 minutes for $99."
- **Deadline and extension**: "Form 7004 extends the deadline to October 15." Do not attach a price to Form 7004 or promise it at checkout. See the availability note below.
- **Penalty, late filer, multi-year**: lead with the honest referral. "If your situation involves multiple years of unfiled returns, actual US-source income, or more than four related parties, an automated tool is not the right solution. A qualified CPA review is the appropriate next step." Then offer the $99 option for the current year where it applies.

**State the price and the time.** "Under 15 minutes for $99" converts better than "get started today", because the fear is an unbounded bill.

**Say who it is not for.** Naming the cases where the $99 tool is wrong raises trust and raises conversion on the cases where it is right.

### Prices, hard rule

**Never write a dollar figure from memory. These are the only correct ones**, and they match
`src/lib/pricing.ts`, which is the single source of truth. Prices were cut on 31 July 2026 and an
earlier version of this skill still carried the old ones, which put stale figures into 35 posts.

| Item | Price | Basis |
|---|---|---|
| Form 5472 plus pro forma 1120 | $99 | per year |
| Reasonable cause letter | $199 | per job, one letter covers every year |
| Additional Form 5472 | $25 | per additional related party, per year |
| Classification change (Form 8832) | $50 | one off |
| IRS fax delivery | $9 | per job, however many years are sent |

Returning customers: the next two filings after the first are guaranteed at the same $99 base,
counted in filings rather than calendar years.

**Do not sell Form 2553.** It was removed from the product. IRC §1361(b)(1)(C) bars an S
corporation from having a nonresident alien shareholder, so every reader who qualifies for this
product is categorically ineligible. Form 8832 stays.

**Availability, check before writing any CTA that promises delivery:**

- **IRS fax is NOT BUILT.** The $9 price is set but nothing transmits yet. Never write a CTA that
  says the site faxes the filing, and never describe faxing in the present tense. Describing how a
  reader can fax the package themselves is fine, and correct: the IRS accepts it.
- **Form 7004 is built but waitlisted**, and the intention on record is to make it free rather
  than an add-on. Until that ships, state that Form 7004 extends the deadline, with no price and
  no claim that the portal files it.

### Naming restriction, hard rule

**Never name the referral CPA firm, or link to it, in any published content.** Not in an article, not in a CTA, not in an FAQ answer, not in schema, not in a meta description. The payment provider prohibits it.

Refer out generically: "a qualified CPA review is the appropriate next step", "speak with a qualified tax professional". Never a firm name, never a domain.

This applies to anything that reaches the public, including files in this repository, which is public.

## Verified IRS facts, do not modify

Confirmed against "When and Where To File" in the Instructions for Form 5472.

- Deadline: April 15, extended to October 15 via Form 7004
- Base penalty: $25,000 per form per year, IRC §6038A(d)(1)
- Continuation penalty: $25,000 per 30-day period after IRS notification, IRC §6038A(d)(2)
- Dedicated address: Internal Revenue Service, 1973 Rulon White Blvd, M/S 6112, Attn: PIN Unit, Ogden, UT 84201. The instructions state explicitly that these filers do **not** use the Form 1120 address.
- Fax: 855-887-7737, at 300 DPI or higher
- "Foreign-owned U.S. DE" is written across the top of the Form 1120
- The **only** information required on the pro forma Form 1120 is the name and address of the foreign-owned US DE and items B and E on page 1
- Items C (date incorporated) and D (total assets) are not required. They may be completed, and where completed must agree with Form 5472 Line 1c and the formation date. Complete both or neither.
- The DE uses its owner's US tax year, or the calendar year if the owner has none
- Form 5472 is filed as an attachment to the return it accompanies, by that return's due date including extensions
- IRS.gov/Form5472

An earlier version of this guidance gave the address as P.O. Box 409101, Ogden, UT 84409. **That is wrong** and would route packets to the wrong processing centre.

[VERIFY: the form revision date and the instructions revision date differ. The instructions are cited as revised December 2024. Confirm the form revision separately before citing it.]

### Verified citations

- IRC §6038A, §6038A(d)(1), §6038A(d)(2)
- IRC §6664(c): reasonable cause defence
- IRC §6501(c)(8): tolls the statute of limitations on the whole return until Form 5472 is filed
- Treas. Reg. §1.6038A-2: reportable transactions
- Treas. Reg. §1.6038A-3: record keeping
- Treas. Reg. §301.7701-2(c)(2)(vi): treats foreign-owned single-member LLCs as corporations for §6038A
- Treas. Reg. §301.7701-3: entity classification
- IRM 20.1.1.3.6.1: the reasonable cause framework examiners use

Never state a section number that is not on this list. Use general framing instead: "Under the regulations applicable to foreign-owned domestic disregarded entities...".

## Never invent

- No statistics. No percentages, no "studies show", unless citing a real named source. Use "a common pattern among foreign founders is".
- No regulation numbers outside the list above.
- No IRS enforcement or audit-selection claims unless publicly documented.
- If unsure of a procedural detail, insert `[VERIFY: what needs checking]` rather than guessing.

## Country posts

Eleven country posts exist and they are visibly the same article with the country swapped. They rank now only because competition is thin. A set of near-identical pages differing by one noun is the shape search engines treat as doorway pages, and the risk grows with each addition.

Every country post needs at least four facts true only of that country:

- The local filing regime by name: FBR in Pakistan, HMRC Self Assessment in the UK, FEMA and ITR in India, the ATO in Australia
- Whether a US income tax treaty exists and what it does and does not change for a disregarded entity
- The local filing deadline against April 15
- The local banking or payment context that triggers discovery
- A worked example in local currency, a local city, a plausible local business

If four cannot be found, do not write the post.

## Length

Length follows query coverage. Cover what the topic raises, then stop.

As a check, not a target: quick reference 1,500 to 2,000 words, standard guides 2,500 to 3,000, cornerstone 3,500 to 4,500, country posts 2,800 to 3,500. Landing outside a band is fine when coverage justifies it. **Every post landing in the same band is the warning sign.**

## Sanity fields to output

- TITLE
- seoTitle, max 60 characters
- seoDescription, max 155, primary keyword plus an action signal
- excerpt, max 200. This renders as the Summary box at the top of the article, so write it as a standalone answer, not a teaser.
- slug, lowercase, hyphens, no stop words
- mainImage alt text, descriptive, primary keyword natural
- categories: Form 5472 Essentials, The $25,000 Penalty, Catching Up on Missed Years, Responding to an IRS Notice, LLC Formation for Foreign Founders, Filing on Time
- relatedPosts: exactly three existing slugs
- body internal links: the three to six `/resources/<slug>` targets used
- QUERY COVERAGE list

## Checks before handing over

1. No em dashes anywhere, including the SEO fields.
2. Three to six real internal links, every slug verified to exist.
3. The direct-answer heading and the closing heading are not reused from another post.
4. Every section reads correctly with everything before it removed.
5. No section number outside the verified list.
6. Any table has a header row, four columns or fewer, and every fact in it also appears in prose.
7. FAQ length is set by the topic, and no question repeats the body verbatim.
8. Both CTAs present, priced, and matched to the reader's situation.
9. `relatedPosts` set.
10. If it is a country post, at least four country-specific facts.
