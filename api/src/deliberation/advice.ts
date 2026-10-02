/*
 * The assistant explains; it never says how to answer.
 *
 * A question that asks for a recommendation is recognised at this boundary,
 * before it reaches any model, so every app that embeds the assistant gets the
 * same refusal. Matching leans broad: declining a real question costs the
 * person one more tap, while advice on a vote would cost the assistant its
 * neutrality.
 *
 * English, German and Italian are read without accents. Spanish and French
 * keep theirs, because "¿cómo votó el Consejo?" asks what happened and
 * "¿cómo voto?" asks for advice. JavaScript's \b only knows ASCII letters,
 * so the Spanish and French word edges are written out.
 */

const fold = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[’']/gu, ' ');

const FOLDED: readonly RegExp[] = [
  /\b(should|shall|must|do|would) (i|we) (vote|answer|say|choose|pick|support|back)\b/u,
  /\bhow (should|do|would) (i|we) (vote|answer)\b/u,
  /\bwhat (should|do) (i|we) (vote|answer|choose|pick)\b/u,
  /\b(recommend|advise|tell me (what|how) to)\b/u,
  /\b(which|what) (side|option|answer) (is|should)\b.*\b(best|right|better|correct)\b/u,
  /\bvote (yes|no) or (yes|no)\b/u,
  /\b(soll|sollte) ich (ja|nein|abstimmen|stimmen)\b/u,
  /\b(cosa|come) (dovrei )?(votare|rispondere)\b/u,
];

const START = '(?:^|[^\\p{L}])';
const END = '(?=$|[^\\p{L}])';
const word = (body: string): RegExp => new RegExp(`${START}${body}${END}`, 'u');
const ACCENTED: readonly RegExp[] = [
  word('(?:qu[eé]|c[oó]mo) (?:voto|respondo|elijo)'),
  word('(?:deber[ií]a|tengo que|me conviene|conviene) (?:votar|responder|elegir|apoyar)'),
  word('(?:me recomend[aá]s|recomend[aá]me|me aconsej[aá]s|aconsej[aá]me)'),
  word('voto (?:s[ií]|no) o (?:s[ií]|no)'),
  word('(?:dois-je|devrais-je|faut-il que je) (?:voter|r[ée]pondre|choisir|soutenir)'),
  word('(?:je vote|voter) (?:oui|non) ou (?:oui|non)'),
  word('(?:tu me conseilles|vous me conseillez|tu me recommandes|vous me recommandez)'),
  new RegExp(`${START}(?:que|comment) (?:voter|r[ée]pondre|choisir)\\s*[?!.]*$`, 'u'),
];

/** True when the question asks how to answer rather than what is at stake. */
export function asksHowToAnswer(question: string): boolean {
  const folded = fold(question);
  const lower = question.normalize('NFC').toLowerCase().replace(/[’']/gu, ' ').trim();
  return (
    FOLDED.some((pattern) => pattern.test(folded)) ||
    ACCENTED.some((pattern) => pattern.test(lower))
  );
}
