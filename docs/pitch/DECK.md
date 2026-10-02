# Deck: text of the slides

- Status: draft, 2 October 2026. Ten slides, one idea each.
- The evidence slide (6) states only what the repository and the chain show on
  the day the deck is exported. Update it from
  [PREVIEW-RUNBOOK.md](../PREVIEW-RUNBOOK.md) and the manifests before export.
- Audience: the Buildathon judge, who ranks on feasibility, real-world adoption
  and uniqueness, and then anyone from [OUTREACH-DRAFTS.md](OUTREACH-DRAFTS.md)
  who asks for more.

## 1. Title

**midnight.vote**
One answer per verified person. A count anyone can check. No list of who
answered.

*Visual: the Cleisthenes hero from the landing page.*

## 2. The problem, from the buyer's side

An organisation that wants to hear from real people online has two bad
options.

| Option | What goes wrong |
| --- | --- |
| An open poll | Anyone answers, any number of times. The number means little |
| A named vote | The organisation now holds who answered what. That is a liability under data protection law, and a reason for people not to answer |

*Speaker note: Swiss newsrooms publish open polls before every federal vote.
Campaigns pay CHF 1.50 to 7.50 for each collected signature. St. Gallen is
piloting electronic collecting since 1 September.*

## 3. What we sell

| The buyer gets | The buyer never gets |
| --- | --- |
| One answer per verified adult, and a public count | A list of who answered, or how |
| A short brief of the question, each sentence tied to the official record | Advice on how to answer |
| A record that the rules were published first and not changed | Personal data to store, secure or disclose |

The right-hand column is the product.

## 4. What a person does

1. Scans the chip of their passport with their phone. It proves they are an
   adult. Their name and passport number are not sent to the service.
2. Gets a pass. It carries no name.
3. Reads the question, and a brief if there is one. Seals an answer. The proof
   is built on their own device.
4. After the consultation closes, opens the app again and counts their answer.

No wallet, no tokens, no account with us.

*Visual: four phone screens from the Preview run.*

## 5. Why this needs Midnight

| Need | What Midnight gives |
| --- | --- |
| Prove "an adult, once" without saying who | A zero-knowledge membership proof against a registry of passes, with a one-time tag per consultation |
| Keep the answer hidden while the consultation runs | The answer is committed, and only its owner can open it |
| People without crypto | Proofs are built in the browser; a relayer pays the fee and never sees an answer |
| A result anyone can check | The contract is public and enforces its own schedule |

What sets it apart from a voting demo: a real identity document behind the
pass, no wallet for the person, proving on the person's device, the person
counting their own answer, and sourced briefs beside the question.

## 6. What exists today

*Fill from the manifests on the day of export. State only what was observed.*

| Piece | State |
| --- | --- |
| Contracts on Midnight Preview | Credential registry and one consultation contract per question: addresses and explorer links |
| Credential service | Reads a passport chip through Rarimo and issues a pass on chain |
| Relayer | Pays fees for answers that are already proven |
| App | Three languages, phone first, live at midnight.vote |
| Briefs | Written from the Swiss parliamentary record by Cleisthenes, each reviewed by a named person |
| Tests | Contract simulator tests, service tests, app tests, browser journeys: the numbers from the last CI run |
| A real answer | Sealed and counted by a person with a real passport: date, and the count read from the contract |

## 7. Who pays

| Route | Who | Price anchor | Time to a first sale |
| --- | --- | --- | --- |
| Organisations | Associations, parties, unions | USD 29 to 299 per member vote today | Days to weeks |
| Media | Newsrooms | Opt-in polls bought per vote date | Weeks |
| Campaigns | Committees, NGOs | CHF 1.50 to 7.50 per paid signature | Weeks to months |
| Government | Cantons, communes | GBP 12,500 to 36,500 a year per licence | 6 to 18 months |

Citizens never pay. Grants carry the work until one route does.

## 8. Why Switzerland first, and why not only Switzerland

- Four federal vote dates a year: a calendar to sell against.
- Parliament's debates and votes are open data: the brief can cite them.
- Electronic collecting is on the public agenda now.
- The federal e-ID arrives on 1 December 2026: a second source of passes,
  issued by the state.

A passport chip works in every country that issues one. A new country needs a
body of evidence for the brief, not a new product.

## 9. What Wave 2 tests

| Test | Passes if |
| --- | --- |
| A pilot with real people | 20 to 50 verified adults seal an answer, and at least half return to count it |
| Ten conversations opened | Five take place |
| One buyer says yes in writing | One letter of interest |

*Replace with results before export. Report a miss as a miss.*

## 10. What comes next

| When | What |
| --- | --- |
| 29 November | The four federal objects as open consultations, counted after the official result |
| December | Passes from the Swiss e-ID |
| Wave 3 | A contract in which counting an answer cannot be linked to sealing it; a first paid pilot |
| Later | Electronic collecting with a canton; other countries' record and identity |

**What we know we have not done:** no audit, no production network, no
credential issued by a state, and a passport proves nationality, not
residence.
