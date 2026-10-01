/*
 * The consultation model: the Poll shape, the demo fixtures, the English copy
 * overlay, and the runtime-catalog conversion.
 *
 * Extracted from App.tsx unchanged so the rebuilt views can import a poll
 * without importing the whole app. Behaviour is identical -- this file is a
 * move, not a rewrite.
 */
import type { VoteReveal } from 'midnight-referendum-api';
import { ASSIGNED_COUNTRIES } from '@/integration/country-catalog';
import type { CicoLocale } from '@/integration/locale';
import { countryPolicyCode, toPassportV2Catalog } from '@/integration/passport-v2-catalog';
import type { PassportV2RuntimeReferendum } from '@/integration/passport-v2-runtime-config';
import type { PassportReceiptRecord } from '@/integration/receipt-store';
import { REAL_TOPIC_FIXTURES } from './real-topic-fixtures';

export type Choice = VoteReveal['choice'];

export interface Poll {
  aliases?: string[];
  subject?: 'mobility' | 'housing' | 'climate' | 'governance' | 'economy';
  media?: { image: string; video?: string; captions?: string };
  translations?: Partial<Record<CicoLocale, Partial<Poll>>>;
  id: string;
  title: string;
  description: string;
  question: string;
  deadline: string;
  opened: string;
  opensAt: string;
  closesAt: string;
  eligible: string;
  participation: string;
  whyNow: string;
  legalFrame: string;
  evidence: string;
  evidenceLabel: string;
  argumentsFor: string[];
  argumentsAgainst: string[];
  uncertainty: string;
  sources: Array<{ label: string; href: string; detail: string }>;
  /** Runtime catalog scope; omitted for synthetic/demo fixture polls. */
  runtimeScope?: 'global' | 'country';
  /** ISO alpha-2 country derived from the private catalog policy, when present. */
  runtimeCountryCode?: string;
  /** Runtime v2 contract address used by the public indexer reader. */
  runtimeContractAddress?: string;
  /**
   * ISO alpha-2 place the consultation is listed under, when that is not its
   * country policy. A Swiss federal object is listed under Switzerland and
   * open to any adult pass: where a question belongs says nothing about who
   * may answer it.
   */
  place?: string;
  /** The official date the subject is known by: a federal vote, a proposal. */
  milestone?: { kind: 'vote' | 'proposal'; date: string };
}

export type VoteReceipt = PassportReceiptRecord;

const EN_POLL_COPY: Record<string, Partial<Poll>> = {
  'france-mobilite': {
    title: 'Everyday mobility in the France pilot',
    description: 'A simulated pilot consultation on safer, simpler low-emission local travel.',
    question:
      'Should the France pilot prioritise safer walking and cycling routes around schools and public transport connections?',
    opened: 'August 29, 2026',
    deadline: 'October 4, 2026',
    whyNow:
      'This fictional consultation exists to test the complete French eligibility and voting journey on real mobile hardware.',
    legalFrame:
      'Product pilot only. It is not an official French consultation or a government service.',
    evidence:
      'No policy outcome is claimed. Figures and participation are simulated for product testing.',
    evidenceLabel: 'SIMULATED PILOT · no official status',
    argumentsFor: [
      'Safer connections can make short daily journeys easier without a car.',
      'A focused pilot can reveal accessibility and implementation needs.',
    ],
    argumentsAgainst: [
      'Street changes can move traffic or reduce loading and parking space.',
      'A local pilot may not represent rural or regional mobility needs.',
    ],
    uncertainty:
      'The location, budget, implementation authority, and measured effects are intentionally not defined in this product demo.',
  },
  'tierras-rurales': {
    title: 'Rural land and foreign ownership',
    description:
      'A consultation on national limits and controls for foreign ownership of rural land.',
    question:
      'Should Argentina keep national limits and controls on foreign ownership and possession of rural land, with regular public review?',
    opened: 'August 8, 2026',
    deadline: 'October 4, 2026',
    whyNow:
      'Law 26.737 remains under debate. The consultation presents the current legal frame and the open questions without taking an institutional position.',
    legalFrame:
      'Law 26.737: rural land rules, the national registry, and national, provincial, and departmental limits.',
    evidence:
      'The official registry published a 2025 report on departments above the registered 15% threshold.',
    evidenceLabel: 'FACT · official registry, August 2025',
    argumentsFor: [
      'More traceability for rural land ownership and possession.',
      'Common rules for border areas, water, and other strategic resources.',
    ],
    argumentsAgainst: [
      'Uniform limits may not reflect provincial and productive differences.',
      'A review could improve legal certainty, investment, and administrative processes.',
    ],
    uncertainty:
      'The final text, its legislative scope, and effects on investment, production, and the environment remain unknown.',
  },
  'federalismo-fiscal': {
    title: 'Fiscal federalism and revenue sharing',
    description:
      'How resources are distributed between the national government, provinces, and the city of Buenos Aires.',
    question:
      'Should Argentina reform revenue sharing to make it more transparent, predictable, and reviewable?',
    opened: 'August 8, 2026',
    deadline: 'August 23, 2026',
    whyNow:
      'Transfers and shared revenue remain central to funding public services across jurisdictions.',
    legalFrame:
      'Law 23.548 and Article 75 of the Constitution: revenue-sharing rules and the framework for an agreement law.',
    evidence:
      'Official series publish daily and consolidated transfers to provinces with a stated methodology.',
    evidenceLabel: 'FACT · Treasury Secretariat, 2003–2025 series',
    argumentsFor: [
      'A published formula could improve predictability and accountability.',
      'A reform could include explicit transition and review mechanisms.',
    ],
    argumentsAgainst: [
      'Changing the formula creates relative winners and losers during the transition.',
      'Known rules can avoid short-term fiscal uncertainty.',
    ],
    uncertainty:
      'There is no agreed formula and the net effects on each jurisdiction are not known.',
  },
  'reforma-laboral': {
    title: 'Labour reform and registered employment',
    description: 'A consultation on formalisation, job creation, and explicit labour protections.',
    question:
      'Should Argentina modify the labour framework to prioritise formal employment while keeping explicit protections and public impact reviews?',
    opened: 'August 8, 2026',
    deadline: 'August 30, 2026',
    whyNow:
      'The discussion combines formalisation costs, collective bargaining, rights, and registered employment.',
    legalFrame:
      'Law 27.802 and labour-market statistics; this consultation does not replace the legal text or regulations.',
    evidence:
      'Household surveys and administrative records cover different populations and should not be conflated.',
    evidenceLabel: 'FACT · national statistics and labour methodology',
    argumentsFor: [
      'Changing incentives could support formal registration and job creation.',
      'Public evaluation could track implementation costs and impacts.',
    ],
    argumentsAgainst: [
      'Formalisation alone does not guarantee good jobs or higher wages.',
      'Broad changes can weaken protections without clear limits and transition.',
    ],
    uncertainty:
      'Future employment effects cannot be attributed to one law without isolating the economic cycle and implementation.',
  },
  jubilaciones: {
    title: 'Pensions and long-term sustainability',
    description: 'Coverage, adequacy, and financial sustainability of the pension system.',
    question:
      'Should Argentina reform pensions to improve sustainability, coverage, and adequacy while protecting people with incomplete contributions?',
    opened: 'August 8, 2026',
    deadline: 'September 6, 2026',
    whyNow:
      'The debate combines indexation, funding, contributory coverage, and protection for incomplete work histories.',
    legalFrame:
      'Law 24.241: the national pension system, benefits, requirements, and indexation rules.',
    evidence:
      'ANSES publishes statistical reports that must be read with their cutoff date and methodology.',
    evidenceLabel: 'FACT · ANSES, June 2025 report',
    argumentsFor: [
      'A comprehensive review can make coverage, funding, and transition parameters visible.',
      'Explicit protection for incomplete contributions can organise fragmented rules.',
    ],
    argumentsAgainst: [
      'Parameter changes may move costs to current or future pensioners.',
      'Financial sustainability alone does not ensure adequate benefits.',
    ],
    uncertainty:
      'No single proposal resolves coverage, adequacy, and funding at once; effects depend on design and transition.',
  },
  'energia-renovable': {
    title: 'Energy, tariffs, and the renewable transition',
    description:
      'More renewable power and networks, with targeted protection for vulnerable users.',
    question:
      'Should Argentina prioritise an energy transition with more renewables, network expansion, and targeted protection for vulnerable users?',
    opened: 'August 8, 2026',
    deadline: 'September 13, 2026',
    whyNow:
      'Renewable targets, distributed generation, tariffs, and targeted subsidies combine investment and protection choices.',
    legalFrame: 'Laws 27.191 and 27.424, together with the targeted energy subsidy framework.',
    evidence: 'The 20% renewable target is a legal objective, not an observed measurement.',
    evidenceLabel: 'FACT · Law 27.191, statutory target',
    argumentsFor: [
      'Renewables, networks, and distributed generation can diversify the mix and attract investment.',
      'Targeting can focus protection on the users who need it most.',
    ],
    argumentsAgainst: [
      'Expansion requires networks, backup, and finance; costs do not disappear.',
      'A fast transition can increase tariffs or exclude misclassified users.',
    ],
    uncertainty:
      'Technology, budget, schedule, and subsidy scope are not defined by this question.',
  },
};

export function localizePoll(poll: Poll, locale: CicoLocale): Poll {
  if (poll.translations?.[locale]) return { ...poll, ...poll.translations[locale] };
  if (locale === 'es' || poll.runtimeContractAddress) return poll;
  return { ...poll, ...EN_POLL_COPY[poll.id] };
}

export const POLLS: Poll[] = [
  // Subjects people recognise come first: the World question, then the four
  // Swiss federal objects of 29 November 2026.
  ...REAL_TOPIC_FIXTURES,
  // Kept until the French question is chosen from the shortlist in
  // docs/CONSULTATION-SUBJECTS.md. It is a simulated pilot, and says so.
  {
    id: 'france-mobilite',
    title: 'Mobilité du quotidien — pilote France',
    description:
      'Une consultation pilote simulée sur des déplacements locaux plus sûrs et plus simples.',
    question:
      'Le pilote France devrait-il prioriser des itinéraires piétons et cyclables plus sûrs autour des écoles et des transports publics ?',
    opened: '29 août 2026',
    deadline: '4 octobre 2026',
    opensAt: '2026-08-29T00:00:00+02:00',
    closesAt: '2026-10-04T23:59:59+02:00',
    eligible: 'Pilote limité',
    participation: '1.284 participations simulées',
    whyNow:
      'Cette consultation fictive sert à tester de bout en bout le parcours français d’éligibilité et de vote sur téléphone réel.',
    legalFrame:
      'Pilote produit uniquement. Ce service n’est ni une consultation officielle française ni un service public.',
    evidence:
      'Aucun résultat de politique publique n’est revendiqué. Les chiffres sont simulés pour les tests produit.',
    evidenceLabel: 'PILOTE SIMULÉ · aucun statut officiel',
    argumentsFor: [
      'Des connexions plus sûres peuvent faciliter les trajets courts sans voiture.',
      'Un pilote ciblé peut révéler les besoins d’accessibilité et de mise en œuvre.',
    ],
    argumentsAgainst: [
      'Les changements de voirie peuvent déplacer le trafic ou réduire les espaces de livraison et de stationnement.',
      'Un pilote local ne représente pas nécessairement les besoins ruraux ou régionaux.',
    ],
    uncertainty:
      'Le lieu, le budget, l’autorité de mise en œuvre et les effets mesurés ne sont volontairement pas définis dans cette démo.',
    sources: [],
  },
  {
    id: 'tierras-rurales',
    title: 'Tierras rurales y propiedad extranjera',
    description:
      'Una consulta sobre límites y controles nacionales a la titularidad y posesión extranjera de tierras rurales.',
    question:
      '¿Debería Argentina mantener un régimen nacional de límites y controles sobre la titularidad y posesión extranjera de tierras rurales, con revisión pública periódica?',
    opened: '8 de agosto de 2026',
    // Argentina is a pilot scope, so its consultation has to be open for the
    // scope to be walkable at all. It closed on 16 August, which left the
    // Argentina tab showing one closed card and no action.
    deadline: '4 de octubre de 2026',
    opensAt: '2026-08-08T00:00:00-03:00',
    closesAt: '2026-10-04T23:59:59-03:00',
    eligible: '143.820',
    participation: '8.914 participaciones de demo',
    whyNow:
      'La Ley 26.737 continúa bajo debate: el DNU 70/2023 intentó derogarla y una medida cautelar restituyó su vigencia. El expediente PE-13/26 también sigue su propio trámite legislativo.',
    legalFrame:
      'Ley 26.737: régimen de tierras rurales, Registro Nacional de Tierras Rurales y límites nacionales, provinciales y departamentales.',
    evidence:
      'El registro oficial publicó en agosto de 2025 que más de treinta departamentos superaban el 15% registrado.',
    evidenceLabel: 'HECHO · registro oficial, agosto de 2025',
    argumentsFor: [
      'Más trazabilidad sobre titularidad y posesión de tierras rurales.',
      'Reglas comunes para zonas de frontera, agua y otros recursos estratégicos.',
    ],
    argumentsAgainst: [
      'Los límites uniformes pueden no reflejar diferencias provinciales y productivas.',
      'Una revisión podría mejorar seguridad jurídica, inversión y trámites.',
    ],
    uncertainty:
      'No se conoce el texto final ni el alcance que tendrá el expediente PE-13/26, ni el efecto de una reforma sobre inversión, producción y ambiente.',
    sources: [
      {
        label: 'Ley 26.737',
        href: 'https://www.argentina.gob.ar/normativa/nacional/ley-26737-192150/actualizacion',
        detail: 'Norma primaria',
      },
      {
        label: 'Registro de Tierras Rurales',
        href: 'https://www.argentina.gob.ar/justicia/tierrasrurales/datos/extranjerizacion-departamento',
        detail: 'Datos publicados, agosto de 2025',
      },
      {
        label: 'Expediente PE-13/26',
        href: 'https://www.senado.gob.ar/parlamentario/comisiones/verExp/13.26/PE/PL',
        detail: 'Estado legislativo',
      },
    ],
  },
  {
    id: 'federalismo-fiscal',
    title: 'Federalismo fiscal y coparticipación',
    description:
      'Cómo se distribuyen recursos entre Nación, provincias y CABA, y qué puede cambiar una nueva fórmula.',
    question:
      '¿Debería Argentina reformar el régimen de distribución de recursos entre la Nación, las provincias y la Ciudad Autónoma de Buenos Aires para hacerlo más transparente, previsible y revisable?',
    opened: '8 de agosto de 2026',
    deadline: '23 de agosto de 2026',
    opensAt: '2026-08-08T00:00:00-03:00',
    closesAt: '2026-08-23T23:59:59-03:00',
    eligible: '126.540',
    participation: '6.382 participaciones de demo',
    whyNow:
      'La distribución de recursos, los ATN y las transferencias automáticas siguen siendo centrales para financiar servicios públicos en las jurisdicciones.',
    legalFrame:
      'Ley 23.548 y artículo 75 de la Constitución Nacional: reglas de coparticipación y marco para una ley-convenio.',
    evidence:
      'La serie oficial de Recursos de Origen Nacional publica montos diarios e informes consolidados para provincias desde 2003.',
    evidenceLabel: 'HECHO · Secretaría de Hacienda, series 2003–2025',
    argumentsFor: [
      'Una fórmula publicada podría dar mayor previsibilidad y rendición de cuentas.',
      'Una reforma puede incorporar transiciones y mecanismos de revisión explícitos.',
    ],
    argumentsAgainst: [
      'Cambiar la fórmula puede generar perdedores relativos y conflictos de transición.',
      'Mantener reglas conocidas puede evitar incertidumbre fiscal de corto plazo.',
    ],
    uncertainty:
      'No existe una única fórmula acordada ni se conocen sus efectos netos sobre cada provincia, CABA y municipio.',
    sources: [
      {
        label: 'Ley 23.548',
        href: 'https://www.argentina.gob.ar/normativa/nacional/ley-23548-21108/actualizacion',
        detail: 'Régimen vigente',
      },
      {
        label: 'Recursos de Origen Nacional',
        href: 'https://www.argentina.gob.ar/economia/sechacienda/asuntosprovinciales/ron',
        detail: 'Datos y metodología',
      },
      {
        label: 'Gasto Público Consolidado',
        href: 'https://www.argentina.gob.ar/economia/politicaeconomica/macroeconomica/gastopublicoconsolidado',
        detail: 'Base hasta 2024; actualización marzo de 2026',
      },
    ],
  },
  {
    id: 'reforma-laboral',
    title: 'Reforma laboral y empleo registrado',
    description:
      'Una consulta sobre formalización, creación de empleo y garantías laborales explícitas.',
    question:
      '¿Debería Argentina modificar el marco laboral vigente para priorizar la formalización y la creación de empleo, manteniendo garantías laborales explícitas y evaluación pública de impacto?',
    opened: '8 de agosto de 2026',
    deadline: '30 de agosto de 2026',
    opensAt: '2026-08-08T00:00:00-03:00',
    closesAt: '2026-08-30T23:59:59-03:00',
    eligible: '119.760',
    participation: '5.107 participaciones de demo',
    whyNow:
      'La Ley 27.802 y sus mecanismos de transición abren una discusión sobre costos, negociación colectiva, derechos y empleo registrado.',
    legalFrame:
      'Ley 27.802 y estadísticas del mercado de trabajo: la consulta no reemplaza el texto legal ni su reglamentación.',
    evidence:
      'La EPH de INDEC y los registros SIPA miden universos distintos; por eso sus cifras no deben confundirse.',
    evidenceLabel: 'HECHO · metodología INDEC / Secretaría de Trabajo',
    argumentsFor: [
      'Cambiar incentivos podría facilitar la registración y la creación de puestos formales.',
      'La evaluación pública permitiría seguir costos e impactos de implementación.',
    ],
    argumentsAgainst: [
      'La formalización no garantiza por sí sola empleo de calidad ni mejores salarios.',
      'Cambios amplios pueden debilitar protecciones si no se definen límites y transición.',
    ],
    uncertainty:
      'No se puede atribuir un cambio futuro del empleo a una ley sin aislar el ciclo económico, el cumplimiento y la reglamentación.',
    sources: [
      {
        label: 'Ley 27.802',
        href: 'https://www.argentina.gob.ar/normativa/nacional/ley-27802-423680/texto',
        detail: 'Norma primaria',
      },
      {
        label: 'Mercado de trabajo INDEC',
        href: 'https://www.indec.gob.ar/indec/web/Nivel4-Tema-4-31-58',
        detail: 'EPH y metodología',
      },
      {
        label: 'Empleo registrado',
        href: 'https://www.argentina.gob.ar/trabajo/estadisticas/situacion-y-evolucion-del-trabajo-registrado',
        detail: 'Informe administrativo, abril de 2026',
      },
    ],
  },
  {
    id: 'jubilaciones',
    title: 'Jubilaciones y sostenibilidad previsional',
    description:
      'Cobertura, suficiencia de prestaciones y sostenibilidad financiera del sistema previsional.',
    question:
      '¿Debería Argentina reformar el sistema previsional para mejorar simultáneamente su sostenibilidad financiera, la cobertura y la suficiencia de las prestaciones, protegiendo a quienes no completan aportes?',
    opened: '8 de agosto de 2026',
    deadline: '6 de septiembre de 2026',
    opensAt: '2026-08-08T00:00:00-03:00',
    closesAt: '2026-09-06T23:59:59-03:00',
    eligible: '132.900',
    participation: '4.618 participaciones de demo',
    whyNow:
      'El debate previsional combina movilidad, financiamiento, cobertura contributiva y no contributiva, y protección a trayectorias laborales incompletas.',
    legalFrame:
      'Ley 24.241: estructura del SIPA, prestaciones, requisitos y reglas de movilidad dentro del marco previsional nacional.',
    evidence:
      'ANSES publica caracterizaciones e informes estadísticos que deben leerse con su fecha de corte y metodología.',
    evidenceLabel: 'HECHO · ANSES, informe a junio de 2025',
    argumentsFor: [
      'Una revisión integral puede hacer visibles los parámetros de cobertura, financiamiento y transición.',
      'La protección explícita de aportes incompletos puede ordenar reglas hoy fragmentadas.',
    ],
    argumentsAgainst: [
      'Reformas de parámetros pueden trasladar costos a jubilados actuales o futuros.',
      'La sostenibilidad financiera no garantiza por sí sola prestaciones suficientes.',
    ],
    uncertainty:
      'No hay una propuesta única que resuelva a la vez cobertura, suficiencia y financiamiento; sus efectos dependen del diseño y la transición.',
    sources: [
      {
        label: 'Ley 24.241',
        href: 'https://www.argentina.gob.ar/normativa/nacional/639/actualizacion',
        detail: 'Marco previsional',
      },
      {
        label: 'Caracterización ANSES',
        href: 'https://www.anses.gob.ar/caracterizacion-de-las-prestaciones-previsionales',
        detail: 'Alcance y metodología',
      },
      {
        label: 'Estadísticas de la seguridad social',
        href: 'https://www.anses.gob.ar/sites/default/files/2025-11/Informe%20de%20Estad%C3%ADsticas%20de%20la%20SS%20II%20Trim.%202025.pdf',
        detail: 'Datos a junio de 2025',
      },
    ],
  },
  {
    id: 'energia-renovable',
    title: 'Energía, tarifas y transición renovable',
    description: 'Más renovables y redes, con protección focalizada para usuarios vulnerables.',
    question:
      '¿Debería Argentina priorizar una transición energética con mayor participación renovable, expansión de redes y protección focalizada para usuarios vulnerables?',
    opened: '8 de agosto de 2026',
    deadline: '13 de septiembre de 2026',
    opensAt: '2026-08-08T00:00:00-03:00',
    closesAt: '2026-09-13T23:59:59-03:00',
    eligible: '138.260',
    participation: '7.246 participaciones de demo',
    whyNow:
      'Las metas de renovables, la generación distribuida, las tarifas y el esquema de subsidios focalizados requieren decisiones que combinan inversión y protección.',
    legalFrame:
      'Leyes 27.191 y 27.424, junto con el esquema de Subsidios Energéticos Focalizados (SEF).',
    evidence:
      'La meta legal de 20% renovable al 31 de diciembre de 2025 es un objetivo normativo; no es un dato observado.',
    evidenceLabel: 'HECHO · Ley 27.191, meta normativa',
    argumentsFor: [
      'Renovables, redes y generación distribuida pueden diversificar la matriz y atraer inversión.',
      'La focalización puede concentrar protección en usuarios que más la necesitan.',
    ],
    argumentsAgainst: [
      'La expansión exige red, respaldo y financiamiento; los costos no desaparecen.',
      'Una transición rápida puede aumentar tarifas o dejar fuera a usuarios mal clasificados.',
    ],
    uncertainty:
      'La tecnología, el presupuesto, el cronograma y el alcance del SEF no están definidos por esta pregunta; tampoco hay un único indicador de pobreza energética.',
    sources: [
      {
        label: 'Ley 27.191',
        href: 'https://www.argentina.gob.ar/normativa/nacional/ley-27191-253626/actualizacion',
        detail: 'Fomento de renovables',
      },
      {
        label: 'Ley 27.424',
        href: 'https://www.argentina.gob.ar/normativa/nacional/ley-27424-305179/actualizacion',
        detail: 'Generación distribuida',
      },
      {
        label: 'Subsidios Energéticos Focalizados',
        href: 'https://www.argentina.gob.ar/normativa/nacional/decreto-943-2025-422016',
        detail: 'Decreto 943/2025',
      },
    ],
  },
];
export function requireDefaultPoll(polls: readonly Poll[]): Poll {
  const poll = polls.at(0);
  if (!poll) throw new Error('At least one civic consultation must be configured.');
  return poll;
}

export const DEFAULT_POLL = requireDefaultPoll(POLLS);
// Fiscal federalism, labour reform, pensions and energy tariffs are Argentine
// questions about Argentine law. They sat under World, which promised a scope
// the catalogue never had.
const COUNTRY_POLL_IDS = new Set([
  'france-mobilite',
  'tierras-rurales',
  'federalismo-fiscal',
  'reforma-laboral',
  'jubilaciones',
  'energia-renovable',
]);
export const COUNTRY_POLL_COUNTRIES = new Map([
  ['france-mobilite', 'FR'],
  ['tierras-rurales', 'AR'],
  ['federalismo-fiscal', 'AR'],
  ['reforma-laboral', 'AR'],
  ['jubilaciones', 'AR'],
  ['energia-renovable', 'AR'],
]);
export const DASHBOARD_COUNTRIES = ASSIGNED_COUNTRIES.map((country) => ({
  code: country.alpha2,
  numeric: country.numeric,
}));

/** True when the consultation is listed under a country rather than under Global. */
export function isCountryPoll(poll: Poll): boolean {
  if (poll.place) return true;
  return poll.runtimeScope ? poll.runtimeScope === 'country' : COUNTRY_POLL_IDS.has(poll.id);
}

/**
 * The ISO alpha-2 country whose passes alone may answer, or null when any pass
 * may. This is eligibility, not where the consultation is listed.
 */
export function pollCountryCode(poll: Poll): string | null {
  const value = poll.runtimeCountryCode ?? COUNTRY_POLL_COUNTRIES.get(poll.id);
  const normalized = value?.trim().toUpperCase();
  return normalized || null;
}

/** The ISO alpha-2 country the consultation is listed under, or null for Global. */
export function pollPlaceCode(poll: Poll): string | null {
  return poll.place?.trim().toUpperCase() || pollCountryCode(poll);
}

/** Listed under this country. Says nothing about who may answer. */
export function isCountryPollForCountry(poll: Poll, countryCode: string): boolean {
  return pollPlaceCode(poll) === countryCode.trim().toUpperCase();
}

/** A pass from this country meets the consultation's country rule, if it has one. */
export function meetsCountryPolicy(poll: Poll, countryCode: string): boolean {
  const required = pollCountryCode(poll);
  return !required || required === countryCode.trim().toUpperCase();
}

/**
 * Convert only the public, parsed runtime catalog into the existing presentation model.
 * Runtime modes never merge static fixture polls into this list: fixture copy is used only
 * where the catalog does not carry editorial prose, and all routing identity comes from the
 * catalog referendumId.

 */
/** Only reached by a catalog that publishes neither ISO dates nor a schedule. */
const EPOCH_START = '1970-01-01T00:00:00.000Z';
const FAR_FUTURE = '9999-12-31T23:59:59.000Z';

/** Contract seconds to an ISO instant. Null for anything unusable. */
function unixToIso(seconds: bigint | undefined): string | null {
  if (seconds === undefined) return null;
  const ms = Number(seconds) * 1000;
  if (!Number.isSafeInteger(ms) || ms <= 0) return null;
  return new Date(ms).toISOString();
}

export function toRuntimePolls(referenda: ReadonlyArray<PassportV2RuntimeReferendum>): Poll[] {
  return toPassportV2Catalog(referenda).map((item) => {
    const countryNumeric = countryPolicyCode(item);
    const countryCode = countryNumeric
      ? ASSIGNED_COUNTRIES.find((entry) => entry.numeric === countryNumeric)?.alpha2
      : undefined;
    return {
      id: item.referendumId,
      title: item.title,
      question: item.question,
      description: item.description ?? 'Consulta ciudadana publicada en el catálogo v2.',
      opened: item.opened ?? 'Según el catálogo v2',
      deadline: item.deadline ?? 'Según el estado del contrato',
      /* The contract publishes its own schedule, and it is enforced on chain --
         `closeVote` and `finalizeVote` are rejected before their deadlines. The
         catalog's ISO fields are an optional display override; when they are
         absent the contract's seconds are the truth. Falling straight through
         to 1970/9999, as this did, made every deployed referendum read as
         permanently open on a screen whose whole job is to say when it closes.
         The sentinels remain only for a catalog carrying neither. */
      opensAt: item.opensAt ?? unixToIso(item.source?.config.opensAtUnix) ?? EPOCH_START,
      closesAt: item.closesAt ?? unixToIso(item.source?.config.closesAtUnix) ?? FAR_FUTURE,
      eligible: item.eligible ?? '—',
      participation: item.participation ?? 'Estado público consultado en Midnight',
      whyNow: 'Esta consulta se publica desde el manifiesto de despliegue v2.',
      legalFrame: 'Consulta independiente; revisá las fuentes publicadas por su organizador.',
      evidence: 'La identidad del contrato y sus reglas provienen del catálogo v2 validado.',
      evidenceLabel: 'CATÁLOGO V2 · configuración publicada',
      argumentsFor: ['Evaluá la propuesta con la información publicada por su organizador.'],
      argumentsAgainst: ['Considerá sus límites, costos e incertidumbres antes de participar.'],
      uncertainty: 'El catálogo no sustituye el debate público ni constituye una decisión oficial.',
      sources: [],
      runtimeScope: item.scope,
      runtimeContractAddress: item.source?.contractAddress,
      ...(countryCode ? { runtimeCountryCode: countryCode } : {}),
    };
  });
}
