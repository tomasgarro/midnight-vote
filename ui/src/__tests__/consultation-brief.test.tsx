import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
  type AssistantAnswer,
  type ConsultationBrief as Brief,
  type DeliberationAssistantPort,
  DeliberationError,
  type EvidenceCitation,
  type PreparedQuestion,
} from 'midnight-referendum-api/deliberation';
import { describe, expect, it, vi } from 'vitest';
import { assistantLanguage, createAppAssistant } from '../integration/deliberation';
import { ConsultationBrief } from '../views/ConsultationBrief';
import { BRIEF_COPY } from '../views/consultation-brief-copy';

const CONSULTATION = 'ch-2026-11-29-ahv';

// Invented people and words.
const anna: EvidenceCitation = {
  id: 'c1',
  speaker: 'Anna Beispiel',
  role: 'National Councillor',
  group: 'Example Group',
  chamber: 'Conseil national',
  date: '2026-03-05T10:47:38.317Z',
  quote: 'Die Finanzierung muss gesichert sein.',
  quoteLanguage: 'de',
  officialUrl: 'https://www.parlament.ch/example/1',
  video: { url: 'https://video.example/1.mp4', start: 110, end: 150.4 },
};
const bruno: EvidenceCitation = {
  ...anna,
  id: 'c2',
  speaker: 'Bruno Exemple',
  quote: 'La hausse pèse sur les ménages.',
  quoteLanguage: 'fr',
  officialUrl: null,
  video: null,
};

function brief(overrides: Partial<Brief> = {}): Brief {
  return {
    consultationId: CONSULTATION,
    officialTitle: 'Federal decree on financing the 13th AHV pension',
    officialTitleLanguage: 'en',
    officialSource: { publisher: 'Federal Chancellery', url: 'https://www.admin.ch/example' },
    voteDate: '2026-11-29',
    language: 'en',
    review: { reviewer: 'Tomas Garro', reviewedAt: '2026-10-08T09:30:00.000Z' },
    updatedAt: '2026-10-07T06:28:05.334Z',
    model: 'gpt-6-luna',
    arguments: {
      for: [
        { text: 'Anna Beispiel argued that the financing must be secured.', citationIds: ['c1'] },
      ],
      against: [
        { text: 'Bruno Exemple argued that the rise weighs on households.', citationIds: ['c2'] },
      ],
    },
    coverage: {
      for: { level: 'full', passages: 27, speakers: 20 },
      against: { level: 'thin', passages: 3, speakers: 2 },
    },
    decided: {
      nationalCouncil: {
        date: '2026-03-20T09:37:25.333Z',
        subject: 'Vote final',
        meaningYes: 'Adopter le projet',
        meaningNo: 'Rejeter le projet',
        counts: { yes: 116, no: 65, abstained: 5 },
        source: 'Official roll-call record',
      },
    },
    citations: { c1: anna, c2: bruno },
    recordUrl: 'https://www.parlament.ch/en/example',
    ...overrides,
  };
}

const answer: AssistantAnswer = {
  language: 'en',
  lead: { text: 'Anna Beispiel said the financing must be secured.', citationIds: ['c1'] },
  sections: [
    {
      title: 'Against the rise',
      paragraphs: [{ text: 'Bruno Exemple said it weighs on households.', citationIds: ['c2'] }],
    },
  ],
  citations: { c1: anna, c2: bruno },
  limitations: ['speech-not-decision', 'unknown-code'],
  model: 'gpt-6-luna',
};

const questions: PreparedQuestion[] = [
  { key: 'arguments', question: 'What were the main arguments?', answer },
  { key: 'change', question: 'What would change?', answer: null },
];

function assistant(overrides: Partial<DeliberationAssistantPort> = {}): DeliberationAssistantPort {
  return {
    adapterName: 'test-assistant',
    getBrief: vi.fn(async () => brief()),
    listPreparedQuestions: vi.fn(async () => questions),
    ask: vi.fn(async () => answer),
    ...overrides,
  };
}

async function shown(port: DeliberationAssistantPort, locale: 'en' | 'es' | 'fr' = 'en') {
  const view = render(
    <ConsultationBrief assistant={port} consultationId={CONSULTATION} locale={locale} />,
  );
  await waitFor(() => expect(screen.queryByText(BRIEF_COPY[locale].loading)).toBeNull());
  return view;
}

describe('the brief of a consultation', () => {
  it('asks for the consultation and a language, and nothing about the person', async () => {
    const port = assistant();
    await shown(port, 'fr');

    expect(port.getBrief).toHaveBeenCalledExactlyOnceWith({
      consultationId: CONSULTATION,
      language: 'fr',
    });
    expect(port.listPreparedQuestions).toHaveBeenCalledExactlyOnceWith({
      consultationId: CONSULTATION,
      language: 'fr',
    });
  });

  it('quotes the official title and shows what Parliament decided', async () => {
    await shown(assistant());

    expect(screen.getByText('Federal decree on financing the 13th AHV pension')).toBeTruthy();
    expect(screen.getByText('Quoted word for word. We never rephrase it.')).toBeTruthy();
    expect(screen.getByText('116')).toBeTruthy();
    expect(screen.getByText('65')).toBeTruthy();
    expect(screen.getByText('National Council, final vote of 20 March 2026')).toBeTruthy();
    expect(screen.getByText('Adopter le projet')).toBeTruthy();
  });

  it('sets the two sides in a fixed order, each sentence with its source', async () => {
    await shown(assistant());

    const sides = screen.getAllByRole('heading', { level: 4 }).map((node) => node.textContent);
    expect(sides.indexOf('For')).toBeGreaterThan(-1);
    expect(sides.indexOf('For')).toBeLessThan(sides.indexOf('Against'));
    expect(
      screen.getByRole('button', {
        name: 'Source 1: Anna Beispiel, 5 March 2026. Open the citation',
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', {
        name: 'Source 2: Bruno Exemple, 5 March 2026. Open the citation',
      }),
    ).toBeTruthy();
    // The thin side says that it is thin, and is not padded.
    expect(
      screen.getByText('The record covers this side thinly: 3 passages from 2 speakers.'),
    ).toBeTruthy();
  });

  it('says so when one side has no passage, and fills nothing in', async () => {
    await shown(
      assistant({
        getBrief: async () =>
          brief({
            arguments: { for: [], against: brief().arguments?.against ?? [] },
            coverage: {
              for: { level: 'silent', passages: 0, speakers: 0 },
              against: { level: 'full', passages: 9, speakers: 9 },
            },
          }),
      }),
    );

    expect(
      screen.getByText('No passage in the record argues this side. We do not fill the gap.'),
    ).toBeTruthy();
    expect(screen.queryByText(/Anna Beispiel argued/u)).toBeNull();
  });

  it('opens a source with the speaker’s own words in their own language', async () => {
    await shown(assistant());

    fireEvent.click(screen.getByRole('button', { name: /^Source 1:/u }));

    const sheet = screen.getByRole('dialog');
    const quote = within(sheet).getByText('Die Finanzierung muss gesichert sein.');
    expect(quote.getAttribute('lang')).toBe('de');
    expect(within(sheet).getByText('Original · German')).toBeTruthy();
    expect(within(sheet).getByText('Anna Beispiel')).toBeTruthy();
    expect(
      within(sheet)
        .getByRole('link', { name: /Open in the official record/u })
        .getAttribute('href'),
    ).toBe('https://www.parlament.ch/example/1');
    const video = within(sheet).getByRole('link', { name: /Watch 1:50–2:30/u });
    expect(video.getAttribute('href')).toBe('https://video.example/1.mp4#t=110,151');
    expect(
      within(sheet).getByText('The timing was set by a machine and not checked by a person.'),
    ).toBeTruthy();
    for (const link of within(sheet).getAllByRole('link')) {
      expect(link.getAttribute('rel')).toBe('noreferrer');
      expect(link.getAttribute('target')).toBe('_blank');
    }
  });

  it('withholds the arguments of a brief that nobody has reviewed', async () => {
    await shown(assistant({ getBrief: async () => brief({ review: null, arguments: null }) }));

    expect(screen.getByText('Arguments in preparation')).toBeTruthy();
    expect(screen.queryByText('For')).toBeNull();
    expect(screen.queryByText('How this brief was made')).toBeNull();
    // What comes from official records is still shown.
    expect(screen.getByText('Federal decree on financing the 13th AHV pension')).toBeTruthy();
  });

  it('names the reviewer and the model', async () => {
    await shown(assistant());

    expect(screen.getByText('Reviewed by Tomas Garro on 8 October 2026')).toBeTruthy();
    expect(screen.getByText('gpt-6-luna')).toBeTruthy();
  });

  it('tells a Spanish reader which language the brief is in', async () => {
    const port = assistant();
    await shown(port, 'es');

    expect(port.getBrief).toHaveBeenCalledWith({ consultationId: CONSULTATION, language: 'en' });
    expect(screen.getByText('Esta síntesis está disponible en inglés.')).toBeTruthy();
  });

  it('shows nothing invented when there is no brief, and offers a retry when it fails', async () => {
    const none = await shown(assistant({ getBrief: async () => null }));
    expect(screen.getByText('No brief is published for this consultation yet.')).toBeTruthy();
    none.unmount();

    const getBrief = vi
      .fn<DeliberationAssistantPort['getBrief']>()
      .mockRejectedValueOnce(new DeliberationError('ASSISTANT_UNAVAILABLE', 'down', true))
      .mockResolvedValue(brief());
    await shown(assistant({ getBrief }));
    expect(screen.getByRole('alert').textContent).toContain('The brief could not be loaded.');

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() =>
      expect(screen.getByText('Federal decree on financing the 13th AHV pension')).toBeTruthy(),
    );
    expect(getBrief).toHaveBeenCalledTimes(2);
  });
});

describe('asking', () => {
  it('opens a prepared answer with its sources and what it does not cover', async () => {
    await shown(assistant());

    const question = screen.getByRole('button', { name: 'What were the main arguments?' });
    expect(question.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(question);

    expect(question.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText(/Anna Beispiel said the financing must be secured\./u)).toBeTruthy();
    expect(screen.getByText('Against the rise')).toBeTruthy();
    expect(screen.getByText('It reports what was said, not what was decided.')).toBeTruthy();
    // A limitation the app has no words for is left out, not shown as a code.
    expect(screen.queryByText(/unknown-code/u)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'What would change?' }));
    expect(screen.getByText('This answer is still being checked.')).toBeTruthy();
    expect(question.getAttribute('aria-expanded')).toBe('false');
  });

  it('sends the question with the consultation and the language only', async () => {
    const port = assistant();
    await shown(port);

    fireEvent.change(screen.getByLabelText('Your own question'), {
      target: { value: '  Who opposed the rise?  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));

    await waitFor(() => expect(port.ask).toHaveBeenCalledOnce());
    expect(port.ask).toHaveBeenCalledWith({
      consultationId: CONSULTATION,
      language: 'en',
      question: 'Who opposed the rise?',
    });
    await waitFor(() =>
      expect(screen.getAllByText(/Bruno Exemple said it weighs on households\./u)).toHaveLength(1),
    );
  });

  it('says what the person should know before asking', async () => {
    await shown(assistant());

    expect(
      screen.getByText('Cleisthenes explains what was said. It does not tell you how to answer.'),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'Your question is sent without your pass and without your name. Do not write personal details in it.',
      ),
    ).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Ask' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('Your own question') as HTMLTextAreaElement).maxLength).toBe(500);
  });

  it.each([
    [
      'SIGN_IN_REQUIRED',
      'Own questions are not open to everyone yet. The prepared questions above need no account.',
    ],
    ['ALLOWANCE_SPENT', 'No questions are left for now. Try again later.'],
    ['ASSISTANT_UNAVAILABLE', 'Cleisthenes could not answer. Try again.'],
    ['INVALID_RESPONSE', 'Cleisthenes found no sentence it could tie to a source.'],
  ] as const)('explains %s in plain words', async (code, message) => {
    await shown(
      assistant({
        ask: async () => {
          throw new DeliberationError(code, 'x');
        },
      }),
    );

    fireEvent.change(screen.getByLabelText('Your own question'), { target: { value: 'Why?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(message));
  });
});

describe('the app’s assistant', () => {
  const sources = JSON.stringify({ [CONSULTATION]: { objectId: '6900' } });

  it('covers only the consultations it was given a source for', () => {
    const app = createAppAssistant(
      { VITE_ASSISTANT_SOURCES_JSON: sources },
      'https://midnight.vote',
    );

    expect(app?.covers(CONSULTATION)).toBe(true);
    expect(app?.covers('fr-2026-unknown')).toBe(false);
    expect(app?.covers('toString')).toBe(false);
  });

  it('answers on this origin by default', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('{}', { status: 404 }),
    ) as unknown as typeof fetch;
    const app = createAppAssistant(
      { VITE_ASSISTANT_SOURCES_JSON: sources },
      'https://midnight.vote',
      fetchImpl,
    );

    await app?.port.getBrief({ consultationId: CONSULTATION, language: 'en' });

    expect(fetchImpl).toHaveBeenCalledExactlyOnceWith(
      'https://midnight.vote/Switzerland/api/votes/6900',
      expect.objectContaining({ credentials: 'omit' }),
    );
  });

  it.each([
    ['no sources', {}],
    ['an empty map', { VITE_ASSISTANT_SOURCES_JSON: '{}' }],
    ['sources that are not JSON', { VITE_ASSISTANT_SOURCES_JSON: '{oops' }],
    ['a list', { VITE_ASSISTANT_SOURCES_JSON: '[]' }],
    ['a source without an object', { VITE_ASSISTANT_SOURCES_JSON: '{"a":{}}' }],
    [
      'an object id that changes the path',
      { VITE_ASSISTANT_SOURCES_JSON: '{"a":{"objectId":"../me"}}' },
    ],
    [
      'an assistant over plain HTTP',
      { VITE_ASSISTANT_SOURCES_JSON: sources, VITE_ASSISTANT_API_URL: 'http://example.org/api' },
    ],
  ])('shows no brief with %s', (_label, env) => {
    expect(createAppAssistant(env, 'https://midnight.vote')).toBeNull();
  });

  it('reads English where the assistant has no Spanish', () => {
    expect(assistantLanguage('es')).toBe('en');
    expect(assistantLanguage('en')).toBe('en');
    expect(assistantLanguage('fr')).toBe('fr');
  });
});
