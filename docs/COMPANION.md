# Cleisthenes, the companion, and the brand he shares

- Status: in the app since 2026-09-29. The pose sheet is not drawn yet.
- Replaces: the capybara mascot ([MASCOT-AND-AVATARS.md](MASCOT-AND-AVATARS.md))

## Who he is

Cleisthenes is the guide of midnight.vote. He is the same Cleisthenes who
answers at `/Switzerland`: one face for the companion in the app and for the
research desk behind it. He explains a consultation from the record. He never
says how to answer.

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
under the SIL Open Font License and are served from this origin.

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

## What is not rebranded yet

| Surface | State |
| --- | --- |
| App shell, consultation page, vote flow, activity, settings | On the tokens |
| Onboarding | On the tokens, with the companion |
| Landing page | Still in its own palette and in Outfit |
| Documentation page (`/docs`) | Still in its own palette and in Outfit |
| Consultation card art | Placeholder tints, not yet on the brand |
| German and Italian | Not in the app yet. The assistant already writes both |
