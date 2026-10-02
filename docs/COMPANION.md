# Cleisthenes, the companion, and the brand he shares

- Status: in the app since 2026-09-29, on the landing page since 2026-09-30. The pose sheet is not drawn yet.
- Replaces: the capybara mascot ([MASCOT-AND-AVATARS.md](MASCOT-AND-AVATARS.md))

## Who he is

Cleisthenes is the guide of midnight.vote. He is the same Cleisthenes who
answers at `/Switzerland`: one face for the companion in the app and for the
research desk behind it. He explains a consultation from the record. He never
says how to answer.

## Where he is

| Place | What he does there |
| --- | --- |
| The middle of the bar | He is one of the three destinations: Consultations, Cleisthenes, You |
| His own page | He finds consultations in the catalogue and lists the ones that have a reviewed brief |
| A consultation page | The brief: what is asked, what was argued, each sentence tied to its source |
| Onboarding and the landing page | He welcomes and explains |

In his chat he answers from the authored catalogue, and the chat says so.
Generated answers exist only in a brief, which a named person has reviewed.

## The figure

| Rule | Reason |
| --- | --- |
| One approved bust, in a round frame | A guide is recognised by its face, so the face never changes |
| A small badge says what he is doing | Six moments need six poses. Until a pose sheet is approved, a badge carries the pose |
| Never on a consent, eligibility or ballot screen | A friendly face beside a decision is a nudge |
| Decorative, hidden from screen readers | He carries no information that the text does not |
| Still under reduced motion | The figure arrives with one short movement, and with none when motion is reduced |

| Pose | Where | Badge |
| --- | --- | --- |
| `welcome` | First screen | A waving hand |
| `explain` | Privacy explanation, civic pulse | An open book |
| `passport` | Document step | An identity card |
| `waiting` | Enrollment pending | An hourglass |
| `success` | Pass ready | A seal |
| `reassure` | Recoverable errors | A shield |

Code: `ui/src/components/companion/CompanionFigure.tsx`. Art:
`ui/src/assets/companion/`.

### What is still needed

A pose sheet: the same bust in the six poses above, drawn by one hand, for
Tomas to approve. When it lands, the drawn pose replaces the badge and nothing
else changes, because the pose names stay the same.

## The brand: Alpine Civic Humanism

Rag paper, civic ink, limestone lines and one terracotta accent. Greek in its
references, Swiss in its restraint.

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--ground` | `#f3eddf` | `#1b1c19` | The page |
| `--surface` | `#fbf8f1` | `#262723` | Cards and sheets |
| `--surface-sunken` | `#e9e2d2` | `#31322d` | Insets |
| `--ink` | `#252823` | `#f3eddf` | Text |
| `--ink-muted` | `#5c5e53` | `#b8b3a3` | Secondary text |
| `--line` | `#d9cbb4` | `#3d3e37` | Hairlines |
| `--line-strong` | `#8f8168` | `#7a7b6e` | The edge of an input |
| `--accent` | `#a24f40` | `#e08e7c` | The primary action, the active state, progress |
| `--brand-lake`, `--brand-sage`, `--brand-limestone` | | | Art and charts. Never text |

Type: Source Serif 4 for display, IBM Plex Sans for everything else. Both are
under the SIL Open Font License and are served from this origin. Display type
is set in the regular weight on the landing page and in the semibold weight in
the app, where headings are small.

### Checked contrast

| Pair | Light | Dark | Needs |
| --- | --- | --- | --- |
| Ink on ground | 12.8 | 14.7 | 7 |
| Muted ink on ground | 5.7 | 8.2 | 4.5 |
| Muted ink on sunken surface | 5.1 | 6.2 | 4.5 |
| Accent ink on accent | 5.5 | 7.0 | 4.5 |
| Accent on ground | 4.8 | 6.8 | 4.5 |
| Accent on its wash | 4.5 | 5.1 | 4.5 |
| Strong line on surface | 3.6 | 3.5 | 3 |

### Rules that travel with the tokens

1. One accent. Terracotta is the primary action, the active state and
   progress. No second hue appears on a screen.
2. The accent is flat. No gradient, no glow, no tinted shadow.
3. The two sides of a consultation are set in the same ink. Colour never says
   which answer is the agreeable one.

## The pictures

| Picture | Where | File |
| --- | --- | --- |
| Cleisthenes before an alpine lake, in an arched frame | Landing page, first screen | `ui/public/art/civic/alpine-lake.webp`, `cleisthenes-bust.webp` |
| The Geneva lakefront, engraved | Landing page, last screen | `ui/public/art/civic/geneva-lakefront.webp` |
| Cleisthenes in a portico above the lake (variant) | Landing page, only with `?hero=portico`, until it is approved | `ui/public/art/civic/portico.webp` with the two above |

The pictures are the ones Cleisthenes uses at `/Switzerland`. They were painted
on rag paper, so the landing page and the documentation page stay in the light
palette when the app is in the dark theme.

The hand holding a passport, which was the first picture of the landing page
until 2026-09-30, is kept in `ui/public/art/passport/`. No page shows it now.

## What is on the brand

| Surface | State |
| --- | --- |
| App shell, consultation page, vote flow, activity, settings | On the tokens |
| Onboarding | On the tokens, with the companion |
| Landing page | On the tokens, in the two faces, with the pictures above |
| Documentation page (`/docs`) | On the tokens, in the two faces |
| Consultation card art | Placeholder tints, not yet on the brand |
| The Midnight City poster, in the "Agents" panel of the landing page | Kept as it is. It is another project's picture |
| German and Italian | Not in the app yet. The assistant already writes both |
