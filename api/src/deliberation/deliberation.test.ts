import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { createCleisthenesAssistant } from './cleisthenes-adapter.js';
import { DeliberationError, MAX_QUESTION_LENGTH } from './ports.js';

const CONSULTATION = 'ch-2026-11-29-ahv';
const BASE = 'https://midnight.vote/Switzerland/api';

// Invented people and words, in the shape the assistant serves.
const citationA = {
  speaker: 'Anna Beispiel',
  role: 'National Councillor',
  group: 'X',
  groupName: 'Example Group',
  chamber: 'Conseil national',
  date: '2026-03-05T10:47:38.317Z',
  quote: 'Die Finanzierung muss gesichert sein.',
  language: 'de',
  officialUrl: 'https://www.parlament.ch/example/1',
  passageId: '1-0',
  video: { url: 'https://video.example/1.mp4', start: 4.08, end: 64.16 },
};
const citationB = {
  ...citationA,
  speaker: 'Bruno Exemple',
  quote: 'La hausse pèse sur les ménages.',
  language: 'fr',
  officialUrl: 'https://www.parlament.ch/example/2',
  video: undefined,
};

function preparedAnswer(language: string, overrides: Record<string, unknown> = {}) {
  return {
    status: 'ok',
    mode: 'prepared',
    model: 'gpt-6-luna',
    language,
    answer: {
      lead: { text: `Lead in ${language}.`, citationIds: ['c1'] },
      sections: [
        {
          title: 'Arguments',
          paragraphs: [
            { text: 'A paragraph with a source.', citationIds: ['c1'] },
            { text: 'A paragraph that names a source we do not hold.', citationIds: ['c9'] },
          ],
        },
      ],
    },
    citations: [{ id: 'c1', ...citationA, council: 'Conseil national', originalLanguage: 'de' }],
    researchSummary: {
      limitations: [{ code: 'speech-not-decision' }, { code: 'withheld', count: 2 }],
    },
    ...overrides,
  };
}

function voteObject(overrides: Record<string, unknown> = {}) {
  return {
    id: '6900',
    type: 'mandatory-referendum',
    voteDate: '2026-11-29',
    title: {
      de: 'Bundesbeschluss über die Finanzierung der 13. AHV-Rente',
      fr: 'Arrêté fédéral sur le financement de la 13e rente AVS',
      en: 'Federal decree on financing the 13th AHV pension',
    },
    officialSource: { publisher: 'Federal Chancellery', url: 'https://www.admin.ch/example' },
    businessId: '20240073',
    parliamentUrl: 'https://www.parlament.ch/en/example',
    review: {
      status: 'approved',
      reviewer: 'Tomas Garro',
      reviewedAt: '2026-10-08T09:30:00.000Z',
    },
    brief: {
      generatedAt: '2026-10-07T06:28:05.334Z',
      model: 'gpt-6-luna',
      coverage: {
        for: { level: 'full', passages: 27, speakers: 20 },
        against: { level: 'thin', passages: 3, speakers: 2 },
      },
      languages: {
        en: {
          for: [
            {
              text: 'Anna Beispiel argued that the financing must be secured.',
              citationIds: ['c1'],
            },
            { text: 'A sentence with no source.', citationIds: [] },
          ],
          against: [
            {
              text: 'Bruno Exemple argued that the rise weighs on households.',
              citationIds: ['c2'],
            },
            { text: 'A sentence that names a source we do not hold.', citationIds: ['c7'] },
          ],
        },
        de: {
          for: [
            {
              text: 'Anna Beispiel sagte, die Finanzierung müsse gesichert sein.',
              citationIds: ['c1'],
            },
          ],
          against: [],
        },
      },
      citations: { c1: citationA, c2: citationB, c3: { ...citationA, speaker: 'Unused Person' } },
    },
    prepared: [
      {
        key: 'arguments',
        question: { en: 'What were the main arguments?', de: 'Was waren die Argumente?' },
        answers: { en: preparedAnswer('en'), de: preparedAnswer('de') },
      },
      {
        key: 'change',
        question: { en: 'What would change?' },
        answers: { en: { status: 'withheld' } },
      },
    ],
    decided: {
      nationalCouncil: {
        date: '2026-03-20T09:37:25.333Z',
        subject: 'Vote final',
        meaningYes: 'Adopter le projet',
        meaningNo: 'Rejeter le projet',
        counts: { yes: 116, no: 65, abstained: 5, didNotVote: 1 },
        source: 'Official roll-call record (National Council)',
      },
      councilOfStates: { available: false },
    },
    ...overrides,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function ndjson(events: readonly unknown[], chunkSize = 40): Response {
  const bytes = new TextEncoder().encode(events.map((event) => JSON.stringify(event)).join('\n'));
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Cut without regard for lines or characters, as a network does.
      for (let index = 0; index < bytes.length; index += chunkSize) {
        controller.enqueue(bytes.slice(index, index + chunkSize));
      }
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

interface Call {
  readonly url: string;
  readonly init: RequestInit;
}

function assistant(respond: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const call = { url: String(input), init };
    calls.push(call);
    return respond(call);
  }) as unknown as typeof fetch;
  return {
    calls,
    port: createCleisthenesAssistant({
      baseUrl: `${BASE}/`,
      consultations: { [CONSULTATION]: { objectId: '6900' } },
      fetchImpl,
    }),
  };
}

const serving = (object: unknown) =>
  assistant(({ url }) => (url.endsWith('/votes/6900') ? json(object) : json({}, 404)));

describe('reading a brief', () => {
  it('gives the official title, both sides in a fixed order, and the sources they rest on', async () => {
    const { port, calls } = serving(voteObject());

    const brief = await port.getBrief({ consultationId: CONSULTATION, language: 'en' });

    expect(calls.map((call) => call.url)).toEqual([`${BASE}/votes/6900`]);
    expect(brief).toMatchObject({
      consultationId: CONSULTATION,
      officialTitle: 'Federal decree on financing the 13th AHV pension',
      officialTitleLanguage: 'en',
      officialSource: { publisher: 'Federal Chancellery', url: 'https://www.admin.ch/example' },
      voteDate: '2026-11-29',
      language: 'en',
      review: { reviewer: 'Tomas Garro', reviewedAt: '2026-10-08T09:30:00.000Z' },
      model: 'gpt-6-luna',
      coverage: {
        for: { level: 'full', passages: 27, speakers: 20 },
        against: { level: 'thin', passages: 3, speakers: 2 },
      },
      recordUrl: 'https://www.parlament.ch/en/example',
    });
    expect(Object.keys(brief?.arguments ?? {})).toEqual(['for', 'against']);
    expect(brief?.decided?.nationalCouncil).toEqual({
      date: '2026-03-20T09:37:25.333Z',
      subject: 'Vote final',
      meaningYes: 'Adopter le projet',
      meaningNo: 'Rejeter le projet',
      counts: { yes: 116, no: 65, abstained: 5 },
      source: 'Official roll-call record (National Council)',
    });
  });

  it('drops every sentence that has no source we hold', async () => {
    const { port } = serving(voteObject());

    const brief = await port.getBrief({ consultationId: CONSULTATION, language: 'en' });

    expect(brief?.arguments?.for.map((item) => item.text)).toEqual([
      'Anna Beispiel argued that the financing must be secured.',
    ]);
    expect(brief?.arguments?.against.map((item) => item.text)).toEqual([
      'Bruno Exemple argued that the rise weighs on households.',
    ]);
    // Only the sources in use are handed on.
    expect(Object.keys(brief?.citations ?? {})).toEqual(['c1', 'c2']);
    expect(brief?.citations.c1).toEqual({
      id: 'c1',
      speaker: 'Anna Beispiel',
      role: 'National Councillor',
      group: 'Example Group',
      chamber: 'Conseil national',
      date: '2026-03-05T10:47:38.317Z',
      quote: 'Die Finanzierung muss gesichert sein.',
      quoteLanguage: 'de',
      officialUrl: 'https://www.parlament.ch/example/1',
      video: { url: 'https://video.example/1.mp4', start: 4.08, end: 64.16 },
    });
    expect(brief?.citations.c2?.video).toBeNull();
  });

  it('says which language the arguments are in when the one asked for is missing', async () => {
    const { port } = serving(voteObject());

    const brief = await port.getBrief({ consultationId: CONSULTATION, language: 'it' });

    expect(brief?.language).toBe('en');
    // The title has no Italian version either, and says so.
    expect(brief?.officialTitleLanguage).toBe('en');

    const german = await port.getBrief({ consultationId: CONSULTATION, language: 'de' });
    expect(german?.language).toBe('de');
    expect(german?.officialTitle).toBe('Bundesbeschluss über die Finanzierung der 13. AHV-Rente');
    expect(german?.arguments?.against).toEqual([]);
  });

  it('withholds the arguments of a brief that no person has reviewed', async () => {
    const { port } = serving(
      voteObject({ review: { status: 'pending', reviewer: null, reviewedAt: null } }),
    );

    const brief = await port.getBrief({ consultationId: CONSULTATION, language: 'en' });

    expect(brief?.review).toBeNull();
    expect(brief?.arguments).toBeNull();
    expect(brief?.coverage).toBeNull();
    expect(brief?.citations).toEqual({});
    // What comes from official records is still shown.
    expect(brief?.officialTitle).toBe('Federal decree on financing the 13th AHV pension');
    expect(brief?.decided?.nationalCouncil?.counts.yes).toBe(116);
  });

  it('also withholds them when the approval names no reviewer', async () => {
    const { port } = serving(voteObject({ review: { status: 'approved' } }));
    const brief = await port.getBrief({ consultationId: CONSULTATION, language: 'en' });
    expect(brief?.review).toBeNull();
    expect(brief?.arguments).toBeNull();
  });

  it('never hands on a link that is not a plain HTTPS address', async () => {
    const object = voteObject();
    object.brief.citations.c1 = {
      ...citationA,
      officialUrl: 'javascript:alert(1)',
      video: { url: 'http://video.example/1.mp4', start: 1, end: 2 },
    };
    object.brief.citations.c2 = {
      ...citationB,
      officialUrl: 'https://user:secret@www.parlament.ch/example/2',
    };
    const { port } = serving({
      ...object,
      officialSource: { publisher: 'Federal Chancellery', url: 'data:text/html,hello' },
      parliamentUrl: 'ftp://www.parlament.ch/example',
    });

    const brief = await port.getBrief({ consultationId: CONSULTATION, language: 'en' });

    expect(brief?.citations.c1?.officialUrl).toBeNull();
    expect(brief?.citations.c1?.video).toBeNull();
    expect(brief?.citations.c2?.officialUrl).toBeNull();
    expect(brief?.officialSource).toBeNull();
    expect(brief?.recordUrl).toBeNull();
  });

  it('holds nothing for a consultation it was not given, and asks nobody', async () => {
    const { port, calls } = serving(voteObject());

    expect(await port.getBrief({ consultationId: 'fr-2026-unknown', language: 'en' })).toBeNull();
    expect(await port.getBrief({ consultationId: 'constructor', language: 'en' })).toBeNull();
    expect(await port.listPreparedQuestions({ consultationId: 'fr-2026', language: 'en' })).toEqual(
      [],
    );
    expect(calls).toHaveLength(0);
  });

  it('tells an unpublished object from an assistant that is down', async () => {
    const missing = assistant(() => json({ error: 'NOT_FOUND' }, 404));
    expect(
      await missing.port.getBrief({ consultationId: CONSULTATION, language: 'en' }),
    ).toBeNull();

    const down = assistant(() => json({}, 502));
    await expect(
      down.port.getBrief({ consultationId: CONSULTATION, language: 'en' }),
    ).rejects.toMatchObject({ code: 'ASSISTANT_UNAVAILABLE', retryable: true });

    const offline = assistant(() => {
      throw new TypeError('fetch failed');
    });
    await expect(
      offline.port.getBrief({ consultationId: CONSULTATION, language: 'en' }),
    ).rejects.toMatchObject({ code: 'ASSISTANT_UNAVAILABLE', retryable: true });
  });

  it('refuses an answer about another object', async () => {
    const { port } = serving(voteObject({ id: '6880' }));
    await expect(
      port.getBrief({ consultationId: CONSULTATION, language: 'en' }),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});

describe('reading the record once', () => {
  it('serves the brief, the prepared questions and a question from one read', async () => {
    const { port, calls } = assistant(({ url }) =>
      url.endsWith('/votes/6900')
        ? json(voteObject())
        : ndjson([{ type: 'answer', answer: preparedAnswer('en') }]),
    );
    const request = { consultationId: CONSULTATION, language: 'en' as const };

    await Promise.all([port.getBrief(request), port.listPreparedQuestions(request)]);
    await port.getBrief({ ...request, language: 'de' });
    await port.ask({ ...request, question: 'Why?' });

    expect(calls.map((call) => call.url)).toEqual([
      `${BASE}/votes/6900`,
      `${BASE}/parliament/ask/stream`,
    ]);
  });

  it('reads again once the brief is older than its cache time', async () => {
    let time = 0;
    const calls: string[] = [];
    const port = createCleisthenesAssistant({
      baseUrl: BASE,
      consultations: { [CONSULTATION]: { objectId: '6900' } },
      cacheMs: 60_000,
      now: () => time,
      fetchImpl: (async (input: string | URL | Request) => {
        calls.push(String(input));
        return json(voteObject());
      }) as typeof fetch,
    });
    const request = { consultationId: CONSULTATION, language: 'en' as const };

    await port.getBrief(request);
    time = 59_999;
    await port.getBrief(request);
    expect(calls).toHaveLength(1);

    time = 60_000;
    await port.getBrief(request);
    expect(calls).toHaveLength(2);
  });

  it('does not keep a failure', async () => {
    const responses = [json({}, 502), json(voteObject())];
    const { port, calls } = assistant(() => responses.shift() as Response);
    const request = { consultationId: CONSULTATION, language: 'en' as const };

    await expect(port.getBrief(request)).rejects.toMatchObject({ code: 'ASSISTANT_UNAVAILABLE' });
    expect((await port.getBrief(request))?.officialTitle).toBe(
      'Federal decree on financing the 13th AHV pension',
    );
    expect(calls).toHaveLength(2);
  });
});

describe('prepared questions', () => {
  it('lists each question with its checked answer, in the language asked for', async () => {
    const { port } = serving(voteObject());

    const questions = await port.listPreparedQuestions({
      consultationId: CONSULTATION,
      language: 'de',
    });

    expect(questions.map((item) => [item.key, item.question])).toEqual([
      ['arguments', 'Was waren die Argumente?'],
      ['change', 'What would change?'],
    ]);
    expect(questions[0]?.answer).toMatchObject({
      language: 'de',
      lead: { text: 'Lead in de.', citationIds: ['c1'] },
      limitations: ['speech-not-decision', 'withheld'],
      model: 'gpt-6-luna',
    });
    // The paragraph without a source we hold is gone.
    expect(questions[0]?.answer?.sections).toEqual([
      {
        title: 'Arguments',
        paragraphs: [{ text: 'A paragraph with a source.', citationIds: ['c1'] }],
      },
    ]);
    // A withheld answer shows the question and no answer.
    expect(questions[1]?.answer).toBeNull();
  });

  it('shows none while the brief is unreviewed', async () => {
    const { port } = serving(voteObject({ review: { status: 'pending' } }));
    expect(
      await port.listPreparedQuestions({ consultationId: CONSULTATION, language: 'en' }),
    ).toEqual([]);
  });
});

describe('asking a question', () => {
  const answering = (events: readonly unknown[]) =>
    assistant(({ url }) => (url.endsWith('/votes/6900') ? json(voteObject()) : ndjson(events)));

  it('sends the question, the language and the business, and nothing else', async () => {
    const { port, calls } = answering([
      { type: 'stage', stage: 'searching' },
      { type: 'stage', stage: 'writing' },
      { type: 'answer', answer: preparedAnswer('en') },
    ]);
    const stages: string[] = [];

    const answer = await port.ask(
      { consultationId: CONSULTATION, language: 'en', question: '  Who opposed the VAT rise?  ' },
      (progress) => stages.push(progress.stage),
    );

    expect(stages).toEqual(['searching', 'writing']);
    expect(answer.lead).toEqual({ text: 'Lead in en.', citationIds: ['c1'] });
    const ask = calls[1] as Call;
    expect(ask.url).toBe(`${BASE}/parliament/ask/stream`);
    expect(ask.init.method).toBe('POST');
    expect(JSON.parse(String(ask.init.body))).toEqual({
      question: 'Who opposed the VAT rise?',
      language: 'en',
      businessId: '20240073',
    });
  });

  it('attaches no cookie and no referrer to any request', async () => {
    const { port, calls } = answering([{ type: 'answer', answer: preparedAnswer('en') }]);

    await port.getBrief({ consultationId: CONSULTATION, language: 'en' });
    await port.ask({ consultationId: CONSULTATION, language: 'en', question: 'Why?' });

    // One read of the record, and one question.
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.init.credentials).toBe('omit');
      expect(call.init.referrerPolicy).toBe('no-referrer');
      const headers = new Headers(call.init.headers);
      expect(headers.has('authorization')).toBe(false);
      expect(headers.has('cookie')).toBe(false);
    }
  });

  it('carries nothing about the person, even when a caller passes it in', async () => {
    const { port, calls } = answering([{ type: 'answer', answer: preparedAnswer('en') }]);
    const personal = {
      consultationId: CONSULTATION,
      language: 'en',
      question: 'Why?',
      authorization: { kind: 'civic-credential', handle: 'issuance-handle-123' },
      credential: { country: 'FR', ageClass: '18-plus' },
      choice: 'YES',
      voteSalt: 'aa'.repeat(32),
      ballotCommitment: 'bb'.repeat(32),
      passportSession: { sessionId: 'passport-session-9', displayName: 'Camille' },
    };

    await port.getBrief(personal as never);
    await port.listPreparedQuestions(personal as never);
    await port.ask(personal as never);

    const sent = calls.map((call) => `${call.url} ${String(call.init.body ?? '')}`).join('\n');
    for (const secret of [
      'issuance-handle-123',
      'civic-credential',
      'ageClass',
      'YES',
      'aa'.repeat(32),
      'bb'.repeat(32),
      'passport-session-9',
      'Camille',
    ]) {
      expect(sent).not.toContain(secret);
    }
    for (const call of calls.filter((item) => item.init.body)) {
      expect(Object.keys(JSON.parse(String(call.init.body))).sort()).toEqual([
        'businessId',
        'language',
        'question',
      ]);
    }
  });

  it('refuses an empty or oversized question before any request', async () => {
    const { port, calls } = answering([]);

    for (const question of ['', '   ', 'x'.repeat(MAX_QUESTION_LENGTH + 1)]) {
      await expect(
        port.ask({ consultationId: CONSULTATION, language: 'en', question }),
      ).rejects.toMatchObject({ code: 'INVALID_QUESTION' });
    }
    expect(calls).toHaveLength(0);
  });

  it.each([
    [401, 'SIGN_IN_REQUIRED', false],
    [403, 'SIGN_IN_REQUIRED', false],
    [429, 'ALLOWANCE_SPENT', true],
    [502, 'ASSISTANT_UNAVAILABLE', true],
  ])('reports HTTP %i as %s', async (status, code, retryable) => {
    const { port } = assistant(({ url }) =>
      url.endsWith('/votes/6900') ? json(voteObject()) : json({ error: 'x' }, status),
    );

    const failure = await port
      .ask({ consultationId: CONSULTATION, language: 'en', question: 'Why?' })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(DeliberationError);
    expect(failure).toMatchObject({ code, retryable });
  });

  it('reports a model that could not answer, and an answer with no sourced sentence', async () => {
    const failing = answering([
      { type: 'stage', stage: 'searching' },
      { type: 'error', code: 'X' },
    ]);
    await expect(
      failing.port.ask({ consultationId: CONSULTATION, language: 'en', question: 'Why?' }),
    ).rejects.toMatchObject({ code: 'ASSISTANT_UNAVAILABLE' });

    const unsourced = answering([
      {
        type: 'answer',
        answer: preparedAnswer('en', {
          answer: { lead: { text: 'A claim with no source.', citationIds: [] }, sections: [] },
        }),
      },
    ]);
    await expect(
      unsourced.port.ask({ consultationId: CONSULTATION, language: 'en', question: 'Why?' }),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('has no evidence to ask about for a consultation it was not given', async () => {
    const { port, calls } = answering([]);
    await expect(
      port.ask({ consultationId: 'world-2026', language: 'en', question: 'Why?' }),
    ).rejects.toMatchObject({ code: 'UNKNOWN_CONSULTATION' });
    expect(calls).toHaveLength(0);
  });
});

describe('configuration', () => {
  it('reaches the assistant over HTTPS, or on a local development host', () => {
    const consultations = { [CONSULTATION]: { objectId: '6900' } };
    expect(() =>
      createCleisthenesAssistant({ baseUrl: 'http://midnight.vote/api', consultations }),
    ).toThrow(/HTTPS/u);
    expect(() =>
      createCleisthenesAssistant({ baseUrl: 'http://localhost.example.com/api', consultations }),
    ).toThrow(/HTTPS/u);
    expect(() =>
      createCleisthenesAssistant({ baseUrl: 'http://localhost:8787/api', consultations }),
    ).not.toThrow();
  });

  it('refuses an object id that could change the path of a request', () => {
    for (const objectId of ['../auth/login', '6900?x=1', '', '6900/../../me']) {
      expect(() =>
        createCleisthenesAssistant({
          baseUrl: BASE,
          consultations: { [CONSULTATION]: { objectId } },
        }),
      ).toThrow(/valid object id/u);
    }
  });
});

describe('the boundary of this module', () => {
  it('imports nothing that knows a pass, a session, an answer or the chain', () => {
    const directory = dirname(fileURLToPath(import.meta.url));
    const sources = readdirSync(directory).filter(
      (file) => /\.(ts|js)$/u.test(file) && !/\.test\.|\.d\.ts$/u.test(file),
    );
    expect(sources.length).toBeGreaterThanOrEqual(3);
    for (const file of sources) {
      const imports = [
        ...readFileSync(join(directory, file), 'utf8').matchAll(/from\s+'([^']+)'/gu),
      ].map((match) => match[1] as string);
      for (const specifier of imports) {
        expect(specifier, `${file} imports ${specifier}`).toMatch(/^\.\/[a-z-]+\.js$/u);
      }
    }
  });
});
