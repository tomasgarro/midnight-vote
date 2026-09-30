# Capybara mascot — current assets and future avatar system

> **Superseded on 2026-09-29.** The capybara left the app. Cleisthenes is the
> companion now: see [COMPANION.md](COMPANION.md). This record is kept for the
> avatar idea in its last section and for the history of the artwork, which
> stays in the repository's history.

## Status

The onboarding now renders the reviewed `CapybaraMascot` component with six
PNG variants in `ui/src/assets/mascot/`: waving, reading, thinking,
achievement, climbing, and waiting. Welcome and credential-success use the
calm illustrative moments; serious consent, eligibility, ballot, and receipt
decisions remain free of decorative mascot treatment.

The variant catalogue below is therefore an implementation record and reuse
guide, not an unbuilt asset request. The generated profile-avatar concept in
the final section remains future work.

Deliberately **not** placed on the consent or eligibility stages, or on the
ballot screen: a cartoon animal beside a serious privacy decision, or beside the
moment someone casts a vote, undercuts both.

## Style reference

From the supplied sticker reference:

| Attribute | Value |
| --- | --- |
| Body | Warm golden-yellow / amber, soft and rounded |
| Accents | Muted grey-brown muzzle, inner ears, paws and feet |
| Eyes | Single simple black dot, no highlight, no eyebrows |
| Line work | Thin, dark, slightly imperfect; hand-drawn feel |
| Proportions | Chunky, short limbs, large head-to-body ratio, seated |
| Outline | Thick white sticker border |
| Background | Transparent |
| Mood | Calm, gentle, unhurried. Never manic or "wacky" |

The capybara's charm is its *calmness*. That matters here: the product's whole
promise is that voting can be private and unstressful. A frantic mascot would
fight the message.

## Variant set for the onboarding journey

Each maps to a moment in the flow. The current transparent PNG assets are
square and share the same visual language.

| Variant | Where it goes | Prompt seed |
| --- | --- | --- |
| **Waving hello** | Welcome stage | Capybara seated, one paw raised in a small friendly wave, calm smile |
| **Reading** | Explore / FAQ | Capybara seated holding an open coral-pink book, absorbed (matches reference exactly) |
| **Thinking** | Privacy explanation | Capybara seated, one paw at chin, small thought bubble, gently curious |
| **Achievement** | Credential success | Capybara at the top of a small green hill holding a tiny flag, content rather than triumphant |
| **Climbing** | Optional progress states | Capybara halfway up a gentle slope, determined but relaxed |
| **Waiting** | Enrollment pending | Capybara seated beside a small hourglass, patient and unbothered |

Original generation prompt template, preserved for future matching variants:

> A cute minimalist sticker illustration of a chubby seated capybara, warm
> golden-yellow fur with muted grey-brown muzzle and paws, a single small black
> dot eye, thin hand-drawn dark outlines, thick white sticker border,
> transparent background, calm gentle expression, flat colours with soft
> shading. The capybara is {ACTION}. Children's-book softness, no text.

Keep the same seed or reference image across variants so the character stays
recognisably the same animal.

## Future: generated profile avatars

**Not built. Documented for a later iteration.**

The idea: each profile gets a randomly generated capybara avatar plus a random
public display name, showing country but never identity — supporting an
anonymous comment layer on consultations.

Design sketch:

- Deterministic generation from a per-profile random seed, so the same profile
  always renders the same avatar without storing an image.
- Layered attributes in the established style: fur tone, accessory (hat, scarf,
  glasses, book), background colour, expression, rarity tiers.
- Display name from a word list, e.g. "Carpincho Tranquilo 4471".
- Country shown as a flag or label; nothing else about the person.

### Two cautions for whoever picks this up

**Avoid the word "NFT".** These would be locally generated images, not tokens on
a chain. Calling them NFTs invites questions about minting, ownership and
resale that the feature does not answer, and muddies a product whose whole point
is that it is *not* speculative.

**The avatar must not leak identity.** If the seed derives from anything tied to
the person's credential, holder binding or vote, the avatar becomes a
correlation handle across consultations — precisely the linkage the protocol
works to prevent. Derive it from a fresh per-profile random value stored only on
the device, and never from credential material.

An anonymous comment layer also needs moderation, storage and abuse handling
before it can ship. That is a feature in its own right, not a coat of paint.
