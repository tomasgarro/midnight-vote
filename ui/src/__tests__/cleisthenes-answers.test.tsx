import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type {
  ConsultationBrief as Brief,
  DeliberationAssistantPort,
  EvidenceCitation,
} from 'midnight-referendum-api/deliberation';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CatalogueChat } from '@/views/CatalogueChat';
import { ConsultationBrief } from '@/views/ConsultationBrief';
import { answerCatalogue, GUIDE_COPY } from '@/views/catalogue-guide';
import { BRIEF_COPY } from '@/views/consultation-brief-copy';
import { localizePoll, POLLS } from '@/views/poll-model';

afterEach(() => vi.unstubAllGlobals());

// A consultation with arguments, sources and an uncertainty in every language.
const poll = POLLS.find((item) => item.sources.length > 0 && item.argumentsFor.length > 0);
if (!poll) throw new Error('The catalogue has no consultation with sources');

describe('the catalogue guide answers in one shape', () => {
  it('gives the short answer, each side, the source and what it cannot say', () => {
    for (const locale of ['en', 'es', 'fr'] as const) {
      const t = GUIDE_COPY[locale];
      const copy = localizePoll(poll, locale);
      const answer = answerCatalogue(`${t.summary} ${copy.title}`, POLLS, locale);
      expect(answer.sections?.map((section) => section.kind)).toEqual([
        'short',
        'sides',
        'source',
        'limits',
      ]);
      expect(answer.sections?.[0]?.lines).toEqual([copy.description]);
      expect(answer.sections?.[1]?.lines[0]).toBe(`${t.forLabel} — ${copy.argumentsFor[0]}`);
      expect(answer.sections?.at(-1)?.lines.at(-1)).toBe(t.notAdvice);
    }
  });

  it.each([
    ['en', 'Should I vote yes?', 'I don’t say how to answer.'],
    ['es', '¿Qué voto?', 'No digo cómo responder.'],
    ['fr', 'Dois-je voter oui ?', 'Je ne dis pas comment répondre.'],
  ] as const)(
    'declines to say how to answer in %s, and shows both sides instead',
    (locale, question, refusal) => {
      const answer = answerCatalogue(question, POLLS, locale, undefined, poll.id);
      expect(answer.declined).toBe(true);
      expect(answer.text.startsWith(refusal)).toBe(true);
      expect(answer.sections?.map((section) => section.kind)).toEqual(['sides']);
      // With nothing in view, it declines without inventing a consultation.
      const alone = answerCatalogue(question, POLLS, locale);
      expect(alone.declined).toBe(true);
      expect(alone.pollIds).toEqual([]);
    },
  );

  it('shows the parts under their own headings and keeps the disclosure', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    render(<CatalogueChat polls={POLLS} locale="en" onOpenPolicy={vi.fn()} />);
    const title = localizePoll(poll, 'en').title;
    fireEvent.change(screen.getByRole('textbox'), { target: { value: `Summarize ${title}` } });
    fireEvent.click(screen.getByRole('button', { name: 'Send question' }));

    const answer = document.querySelector<HTMLElement>('.catalogue-chat__answer');
    if (!answer) throw new Error('No answer');
    expect(
      within(answer)
        .getAllByRole('heading', { level: 3 })
        .map((node) => node.textContent),
    ).toEqual(['In short', 'What each side says', 'Sources', 'What I can’t tell you']);
    expect(within(answer).getByText('How to answer. That is yours to decide.')).toBeTruthy();
    expect(screen.getByText(/Generative AI is not connected/)).toBeTruthy();
  });
});

// Invented people, with the group names the record really uses.
const quadri: EvidenceCitation = {
  id: 'c1',
  speaker: 'Anna Beispiel',
  role: 'National Councillor',
  group: "Groupe de l'Union démocratique du Centre",
  chamber: 'Conseil national',
  date: '2026-03-05T10:47:38.317Z',
  quote: 'Die Finanzierung muss gesichert sein.',
  quoteLanguage: 'de',
  officialUrl: null,
  video: null,
};
const centre: EvidenceCitation = {
  ...quadri,
  id: 'c2',
  speaker: 'Bruno Exemple',
  group: 'Groupe du Centre. Le Centre. PEV.',
};
const unnamed: EvidenceCitation = { ...quadri, id: 'c3', speaker: 'Carla Muster', group: 'X' };

function brief(): Brief {
  return {
    consultationId: 'consultation',
    officialTitle: 'Federal decree on financing the 13th AHV pension',
    officialTitleLanguage: 'en',
    officialSource: null,
    voteDate: '2026-11-29',
    language: 'en',
    review: { reviewer: 'A Reviewer', reviewedAt: '2026-10-08T09:30:00.000Z' },
    updatedAt: null,
    model: null,
    arguments: {
      for: [
        { text: 'Anna Beispiel argued that the financing must be secured.', citationIds: ['c1'] },
        { text: 'The rise was called overdue.', citationIds: ['c3'] },
      ],
      against: [
        { text: 'Bruno Exemple argued that it weighs on households.', citationIds: ['c2'] },
      ],
    },
    coverage: null,
    decided: {
      nationalCouncil: {
        date: '2026-03-20T09:37:25.333Z',
        subject: null,
        meaningYes: null,
        meaningNo: null,
        counts: { yes: 116, no: 65, abstained: 1 },
        source: null,
      },
    },
    citations: { c1: quadri, c2: centre, c3: unnamed },
    recordUrl: null,
  };
}

function assistant(): DeliberationAssistantPort {
  return {
    adapterName: 'test',
    getBrief: vi.fn(async () => brief()),
    listPreparedQuestions: vi.fn(async () => []),
    ask: vi.fn(async () => {
      throw new Error('should not be asked');
    }),
  };
}

async function shown(port: DeliberationAssistantPort, locale: 'en' | 'es' | 'fr' = 'en') {
  render(<ConsultationBrief assistant={port} consultationId="consultation" locale={locale} />);
  await waitFor(() => expect(screen.queryByText(BRIEF_COPY[locale].loading)).toBeNull());
}

describe('the brief answers in one shape', () => {
  it('says in two sentences when the vote is and how the National Council voted', async () => {
    await shown(assistant());
    expect(screen.getByRole('heading', { name: 'In short' })).toBeTruthy();
    expect(
      screen.getByText(
        'Swiss voters decide on this object on 29 November 2026. In its final vote the National Council counted 116 yes, 65 no and 1 abstention.',
      ),
    ).toBeTruthy();
  });

  it('names the party of whoever makes each argument', async () => {
    await shown(assistant());
    expect(screen.getByText(/^Anna Beispiel \(SVP\) argued that the financing/u)).toBeTruthy();
    expect(screen.getByText(/^Bruno Exemple \(Centre\) argued that it weighs/u)).toBeTruthy();
    // A sentence that names nobody starts with the speaker.
    expect(screen.getByText(/^Carla Muster: The rise was called overdue\./u)).toBeTruthy();
  });

  it('names the party in the reader’s language', async () => {
    await shown(assistant(), 'fr');
    expect(screen.getByText(/^Anna Beispiel \(UDC\) argued/u)).toBeTruthy();
    expect(screen.getByText(/^Bruno Exemple \(Le Centre\) argued/u)).toBeTruthy();
  });

  it('states what Cleisthenes cannot tell you', async () => {
    await shown(assistant(), 'es');
    expect(screen.getByText('Lo que Cleisthenes no puede decirte')).toBeTruthy();
    expect(screen.getByText('Cómo responder. Esa decisión sigue siendo tuya.')).toBeTruthy();
  });

  it.each([
    ['en', 'Should I vote yes?'],
    ['es', '¿Cómo voto en esto?'],
    ['fr', 'Que voter ?'],
  ] as const)('declines a request for advice in %s and sends nothing', async (locale, question) => {
    const port = assistant();
    await shown(port, locale);
    fireEvent.change(screen.getByLabelText(BRIEF_COPY[locale].own), {
      target: { value: question },
    });
    fireEvent.click(screen.getByRole('button', { name: BRIEF_COPY[locale].send }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(BRIEF_COPY[locale].declined),
    );
    expect(port.ask).not.toHaveBeenCalled();
  });
});
