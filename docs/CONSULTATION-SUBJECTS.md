# The subjects people answer

- Status: in the demo catalogue since 2 October 2026
- Code: `ui/src/views/real-topic-fixtures.ts`, listed by `ui/src/views/poll-model.ts`
- Checked against the official sources on 2 October 2026

Each subject has a neutral question, a summary of two sentences, an official
source, a date, and one argument on each side that names who makes it. The
demo shows them as simulated; nothing answered in the demo is recorded.

## Switzerland: the federal vote of 29 November 2026

The Federal Council listed four objects on 30 June 2026
([admin.ch, in German](https://www.admin.ch/de/newnsb/KpnrPOW9cpZAvB6IXOekf),
[in French](https://www.admin.ch/fr/newnsb/KpnrPOW9cpZAvB6IXOekf)). The app
asks about each of them as an **open pulse**: any adult with a pass may answer,
whatever the passport. A passport says nothing about where a person lives or
votes, and only Swiss citizens vote on 29 November. Answers close on Friday 27
November at 18:00, Geneva time.

| Id | Official title (German) | Official source | Who argues for | Who argues against |
| --- | --- | --- | --- | --- |
| `ch-ahv-vat` | Bundesbeschluss vom 19. Juni 2026 über die Zusatzfinanzierung der AHV durch eine Erhöhung der Mehrwertsteuer | [BSV](https://www.bsv.admin.ch/de/umsetzung-13-ahv-rente): +0.4 points standard rate, +0.2 accommodation, from 2028 | Federal Council and Parliament | FDP ([recommendations](https://www.fdp.ch/abstimmungen-kampagnen/parolen)) |
| `ch-war-materiel` | Änderung vom 19. Dezember 2025 des Bundesgesetzes über das Kriegsmaterial | [SECO](https://www.seco.admin.ch/de/abstimmung-kmg) | Federal Council and Parliament | Referendum alliance of the EVP and more than 25 organisations ([EVP](https://www.evppev.ch/politik/kampagnen/kriegsmaterial-referendum)); 58,767 valid signatures |
| `ch-married-couples-tax` | Volksinitiative «Ja zu fairen Bundessteuern auch für Ehepaare – Diskriminierung der Ehe endlich abschaffen!» | [ESTV](https://www.estv.admin.ch/de/eidgenoessische-volksinitiative-ja-zu-fairen-bundessteuern-auch-fuer-ehepaare); individual taxation approved 8 March 2026 with 54.23% ([EFD](https://www.efd.admin.ch/de/abstimmung-individualbesteurung)) | Die Mitte, which launched it | Federal Council and Parliament |
| `ch-fireworks` | Volksinitiative «Für eine Einschränkung von Feuerwerk» | [UVEK](https://www.uvek.admin.ch/de/abstimmungen) | Initiative committee ([site](https://www.feuerwerksinitiative.ch/de)) | Federal Council and Parliament |

Not yet possible: a Cleisthenes brief for these four. The brief is keyed by
the VoteInfo object id, and the VoteInfo feed for 20261129 answered 404 on
2 October. When it is published, the generator runs with `--date=20261129`,
each brief is reviewed, and `VITE_ASSISTANT_SOURCES_JSON` maps the four ids
above to their object ids.

## World

| Id | Question | Official source | Date | For | Against |
| --- | --- | --- | --- | --- | --- |
| `world-social-media-age` | Should social media accounts be open only from age 15, with an age check when an account is opened? | [European Commission, the KIDS Act explained](https://digital-strategy.ec.europa.eu/en/faqs/kids-act-explained) | Proposed 17 September 2026 | European Commission | EDRi ([30 September 2026](https://edri.org/our-work/the-kids-act-will-make-the-internet-less-safe/)) |

Australia's under-16 rule, in force since 10 December 2025, is cited as the
comparison ([eSafety](https://www.esafety.gov.au/about-us/industry-regulation/social-media-age-restrictions)).

## France: three candidates, waiting for a pick

No French question ships until one is chosen. Until then the simulated pilot
`france-mobilite` stays, labelled as simulated. Whatever is chosen, the copy
says "French passport", never "people living in France".

| | Candidate question | Why now | Official source | Risk |
| --- | --- | --- | --- | --- |
| **A (recommended)** | Should the legal retirement age resume its rise to 64 when the suspension ends in 2028? | The 2023 reform is suspended at 62 years and 9 months until 1 January 2028, by the 2026 social security financing law (reported as article 105 of loi n° 2025-1403; confirm on Légifrance). It will be argued through the 2027 presidential campaign. | Légifrance (not yet read at the source) | The most recognised question in France, and distinct from the World question. Positions are well documented on both sides |
| B | After the Conseil constitutionnel's censure, should France set a minimum age of 15 for social media? | Decision 2026-911 DC of 14 August 2026 struck down article 1 of the law adopted in July 2026; a rewrite is expected this autumn. | [Conseil constitutionnel](https://www.conseil-constitutionnel.fr/actualites/communique/decision-n-2026-911-dc-du-14-aout-2026-communique-de-presse) | Overlaps with the World question |
| C | Should the 2027 budget reduce the deficit mainly by cutting spending rather than by raising taxes? | The government presented the 2027 budget on 1 October 2026; the Assemblée votes its first part on 20 October. | [Assemblée nationale, finance committee](https://questions.assemblee-nationale.fr/dyn/17/organes/commissions-permanentes/finances/actualites/projet-de-loi-de-finances-pour-2027-audition-de-roland-lescure-et-de-david-amiel) | A two-way framing of a many-sided budget; hard to keep neutral in one line |

Considered and dropped: the law on aid in dying. It was adopted on 15 July
2026 and is already in force, so the question would no longer be open.

Before shipping the pick: confirm the official text on Légifrance on the day,
write the three languages, and name who argues each side.

## What was removed

The fictional pilots (Swiss rail, housing and nature; Italian walking routes;
Spanish rainwater), the platform-governance question, the Swiss Bitcoin
initiative (it has no vote date), the EU repair directive and the Spanish
water-digitalisation question. Their cover pictures stay in `ui/public/art/`
unused until card art is approved.
