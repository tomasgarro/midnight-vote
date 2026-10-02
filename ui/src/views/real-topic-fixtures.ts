import type { CicoLocale } from '@/integration/locale';
import type { Poll } from './poll-model';

/*
 * Subjects people recognise, for the demo catalogue. Never included in
 * provider or runtime catalogues.
 *
 * Checked against the official sources on 2 October 2026:
 * - The four Swiss objects of 29 November 2026 are the ones the Federal
 *   Council listed on 30 June 2026 (admin.ch). Their VoteInfo feed is not
 *   published yet, so no Cleisthenes brief is mapped to them.
 * - The World question follows the European Commission's KIDS Act proposal
 *   of 17 September 2026.
 *
 * Every argument names who makes it. The Swiss questions are an open pulse:
 * any adult with a pass may answer, whatever the passport, because a passport
 * says nothing about where a person lives or votes.
 */

type Copy = Pick<
  Poll,
  | 'title'
  | 'description'
  | 'question'
  | 'whyNow'
  | 'evidence'
  | 'legalFrame'
  | 'evidenceLabel'
  | 'argumentsFor'
  | 'argumentsAgainst'
  | 'uncertainty'
  | 'eligible'
  | 'sources'
>;

type Shared = Omit<Poll, keyof Copy | 'translations'>;

/** Spanish is the catalogue's base language, as in the rest of the demo. */
function subject(shared: Shared, copy: Record<CicoLocale, Copy>): Poll {
  return { ...shared, ...copy.es, translations: copy };
}

const SWISS_RELEASE = {
  de: 'https://www.admin.ch/de/newnsb/KpnrPOW9cpZAvB6IXOekf',
  fr: 'https://www.admin.ch/fr/newnsb/KpnrPOW9cpZAvB6IXOekf',
};

const SWISS_SCHEDULE = {
  opened: 'October 1, 2026',
  deadline: 'November 27, 2026',
  opensAt: '2026-10-01T00:00:00+02:00',
  // Answers close on the Friday before the federal vote.
  closesAt: '2026-11-27T18:00:00+01:00',
  participation: 'Demo',
  place: 'CH',
  milestone: { kind: 'vote', date: '2026-11-29T12:00:00+01:00' },
} as const;

const OPEN_PULSE = {
  en: {
    legalFrame:
      'Open pulse: any adult with a verified pass can answer, whatever their passport. It is not the federal vote. Only Swiss citizens vote on 29 November, and this result has no legal effect.',
    evidenceLabel: 'FEDERAL VOTE · 29 NOVEMBER 2026',
    eligible: 'Any pass, 18+',
  },
  es: {
    legalFrame:
      'Pulso abierto: puede responder cualquier persona adulta con un pase verificado, sea cual sea su pasaporte. No es la votación federal: el 29 de noviembre votan solo quienes tienen ciudadanía suiza, y este resultado no tiene efecto legal.',
    evidenceLabel: 'VOTACIÓN FEDERAL · 29 DE NOVIEMBRE DE 2026',
    eligible: 'Cualquier pase, 18+',
  },
  fr: {
    legalFrame:
      'Sondage ouvert : toute personne majeure avec un laissez-passer vérifié peut répondre, quel que soit son passeport. Ce n’est pas la votation fédérale : seuls les citoyens suisses votent le 29 novembre, et ce résultat n’a aucun effet juridique.',
    evidenceLabel: 'VOTATION FÉDÉRALE · 29 NOVEMBRE 2026',
    eligible: 'Tout laissez-passer, 18+',
  },
} as const;

const releaseSource = {
  en: {
    label: 'Federal Council · the four objects of 29 November',
    href: SWISS_RELEASE.de,
    detail: 'Official list, 30 June 2026 (in German)',
  },
  es: {
    label: 'Consejo Federal · los cuatro objetos del 29 de noviembre',
    href: SWISS_RELEASE.de,
    detail: 'Lista oficial, 30 de junio de 2026 (en alemán)',
  },
  fr: {
    label: 'Conseil fédéral · les quatre objets du 29 novembre',
    href: SWISS_RELEASE.fr,
    detail: 'Liste officielle, 30 juin 2026',
  },
};

export const REAL_TOPIC_FIXTURES: Poll[] = [
  subject(
    {
      id: 'world-social-media-age',
      subject: 'governance',
      aliases: [
        'kids act',
        'social media',
        'redes sociales',
        'réseaux sociaux',
        'minimum age',
        'edad mínima',
        'âge minimum',
      ],
      opened: 'October 1, 2026',
      deadline: 'December 31, 2026',
      opensAt: '2026-10-01T00:00:00Z',
      closesAt: '2026-12-31T23:59:59+01:00',
      participation: 'Demo',
      runtimeScope: 'global',
      milestone: { kind: 'proposal', date: '2026-09-17T12:00:00+02:00' },
    },
    {
      en: {
        title: 'A minimum age for social media?',
        question:
          'Should social media accounts be open only from age 15, with an age check when an account is opened?',
        description:
          'On 17 September 2026 the European Commission proposed that children open their own social media account only from 15. Australia has applied a limit of 16 since December 2025.',
        whyNow:
          'The proposal, the EU KIDS Act, now goes to the European Parliament and the member states. It would also oblige platforms to check age when someone opens an account.',
        evidence:
          'Under the proposal, children under 13 get no account, children of 13 and 14 get an account set up and supervised by a parent, and from 15 they open their own.',
        legalFrame:
          'Open pulse for any adult with a verified pass, wherever they live. It is not a vote on an EU law and has no legal effect.',
        evidenceLabel: 'PROPOSAL · EUROPEAN COMMISSION, 17 SEPTEMBER 2026',
        eligible: 'Any pass, 18+',
        argumentsFor: [
          'European Commission: one rule gives every child in the EU the same protection, and the age check can work without the platform learning who you are.',
        ],
        argumentsAgainst: [
          'European Digital Rights (EDRi): age checks can shut out people without the right documents, and a later first account does not fix addictive design.',
        ],
        uncertainty:
          'The ages can still change in the European Parliament and the Council, and no date of application is set.',
        sources: [
          {
            label: 'European Commission · the KIDS Act explained',
            href: 'https://digital-strategy.ec.europa.eu/en/faqs/kids-act-explained',
            detail: 'Official explainer of the proposal of 17 September 2026',
          },
          {
            label: 'eSafety Commissioner · social media minimum age',
            href: 'https://www.esafety.gov.au/about-us/industry-regulation/social-media-age-restrictions',
            detail: 'Australia’s under-16 rule, in force since 10 December 2025',
          },
          {
            label: 'EDRi · critique of the KIDS Act',
            href: 'https://edri.org/our-work/the-kids-act-will-make-the-internet-less-safe/',
            detail: 'Digital-rights network, 30 September 2026',
          },
        ],
      },
      es: {
        title: '¿Una edad mínima para las redes sociales?',
        question:
          '¿Las cuentas en redes sociales deberían abrirse solo a partir de los 15 años, con un control de edad al crear la cuenta?',
        description:
          'El 17 de septiembre de 2026 la Comisión Europea propuso que chicas y chicos abran su propia cuenta en redes sociales recién a los 15. Australia aplica un límite de 16 desde diciembre de 2025.',
        whyNow:
          'La propuesta, la EU KIDS Act, pasa ahora al Parlamento Europeo y a los Estados miembros. También obligaría a las plataformas a comprobar la edad al abrir una cuenta.',
        evidence:
          'Según la propuesta, menores de 13 no tienen cuenta; a los 13 y 14, una madre, un padre o tutor la crea y la supervisa; desde los 15 abren la suya.',
        legalFrame:
          'Pulso abierto para cualquier persona adulta con un pase verificado, viva donde viva. No es una votación sobre una ley de la UE y no tiene efecto legal.',
        evidenceLabel: 'PROPUESTA · COMISIÓN EUROPEA, 17 DE SEPTIEMBRE DE 2026',
        eligible: 'Cualquier pase, 18+',
        argumentsFor: [
          'Comisión Europea: una sola regla da a cada menor de la UE la misma protección, y el control de edad puede funcionar sin que la plataforma sepa quién sos.',
        ],
        argumentsAgainst: [
          'European Digital Rights (EDRi): los controles de edad pueden dejar afuera a quien no tiene los documentos adecuados, y retrasar la primera cuenta no corrige el diseño adictivo.',
        ],
        uncertainty:
          'Las edades todavía pueden cambiar en el Parlamento Europeo y el Consejo, y no hay fecha de aplicación.',
        sources: [
          {
            label: 'Comisión Europea · la KIDS Act explicada',
            href: 'https://digital-strategy.ec.europa.eu/en/faqs/kids-act-explained',
            detail: 'Explicación oficial de la propuesta del 17 de septiembre de 2026 (en inglés)',
          },
          {
            label: 'eSafety Commissioner · edad mínima en redes',
            href: 'https://www.esafety.gov.au/about-us/industry-regulation/social-media-age-restrictions',
            detail: 'La regla australiana de 16 años, vigente desde el 10 de diciembre de 2025',
          },
          {
            label: 'EDRi · crítica de la KIDS Act',
            href: 'https://edri.org/our-work/the-kids-act-will-make-the-internet-less-safe/',
            detail: 'Red de derechos digitales, 30 de septiembre de 2026 (en inglés)',
          },
        ],
      },
      fr: {
        title: 'Un âge minimum pour les réseaux sociaux ?',
        question:
          'Les comptes sur les réseaux sociaux devraient-ils n’être ouverts qu’à partir de 15 ans, avec un contrôle de l’âge à l’ouverture ?',
        description:
          'Le 17 septembre 2026, la Commission européenne a proposé que les enfants n’ouvrent leur propre compte qu’à partir de 15 ans. L’Australie applique une limite de 16 ans depuis décembre 2025.',
        whyNow:
          'La proposition, l’EU KIDS Act, passe maintenant au Parlement européen et aux États membres. Elle obligerait aussi les plateformes à vérifier l’âge à l’ouverture d’un compte.',
        evidence:
          'Selon la proposition, pas de compte avant 13 ans ; à 13 et 14 ans, un compte ouvert et supervisé par un parent ; dès 15 ans, un compte à soi.',
        legalFrame:
          'Sondage ouvert à toute personne majeure avec un laissez-passer vérifié, où qu’elle vive. Ce n’est pas un vote sur une loi de l’UE et cela n’a aucun effet juridique.',
        evidenceLabel: 'PROPOSITION · COMMISSION EUROPÉENNE, 17 SEPTEMBRE 2026',
        eligible: 'Tout laissez-passer, 18+',
        argumentsFor: [
          'Commission européenne : une seule règle donne à chaque enfant de l’UE la même protection, et le contrôle de l’âge peut se faire sans que la plateforme sache qui vous êtes.',
        ],
        argumentsAgainst: [
          'European Digital Rights (EDRi) : le contrôle de l’âge peut exclure les personnes sans les bons documents, et retarder le premier compte ne corrige pas le design addictif.',
        ],
        uncertainty:
          'Les âges peuvent encore changer au Parlement européen et au Conseil, et aucune date d’application n’est fixée.',
        sources: [
          {
            label: 'Commission européenne · le KIDS Act expliqué',
            href: 'https://digital-strategy.ec.europa.eu/en/faqs/kids-act-explained',
            detail: 'Explication officielle de la proposition du 17 septembre 2026 (en anglais)',
          },
          {
            label: 'eSafety Commissioner · âge minimum sur les réseaux',
            href: 'https://www.esafety.gov.au/about-us/industry-regulation/social-media-age-restrictions',
            detail: 'La règle australienne des 16 ans, en vigueur depuis le 10 décembre 2025',
          },
          {
            label: 'EDRi · critique du KIDS Act',
            href: 'https://edri.org/our-work/the-kids-act-will-make-the-internet-less-safe/',
            detail: 'Réseau de défense des droits numériques, 30 septembre 2026 (en anglais)',
          },
        ],
      },
    },
  ),
  subject(
    {
      id: 'ch-ahv-vat',
      subject: 'economy',
      aliases: ['ahv', 'avs', '13th pension', 'mwst', 'tva', 'iva', 'vat'],
      ...SWISS_SCHEDULE,
    },
    {
      en: {
        ...OPEN_PULSE.en,
        title: 'Financing the 13th AHV pension',
        question:
          'Should VAT rise by 0.4 percentage points from 2028 to help finance the 13th AHV pension?',
        description:
          'Swiss voters decide on 29 November 2026 whether to raise VAT to pay for the 13th old-age pension approved in 2024. The standard rate would rise by 0.4 points from 2028.',
        whyNow:
          'Voters approved a 13th AHV pension in March 2024. On 19 June 2026 Parliament decided to finance it in part through a VAT increase with no end date.',
        evidence:
          'The standard rate rises by 0.4 points and the accommodation rate by 0.2 points from 2028. As a change to the Constitution, it needs a majority of voters and of cantons.',
        argumentsFor: [
          'Federal Council and Parliament: the increase funds a pension that voters have already approved.',
        ],
        argumentsAgainst: [
          'FDP: the VAT increase is unfair and unnecessary, and it weighs on households and small businesses.',
        ],
        uncertainty:
          'How the AHV is financed beyond this increase depends on the separate AHV 2030 reform, which this vote does not decide.',
        sources: [
          releaseSource.en,
          {
            label: 'Federal Social Insurance Office · 13th AHV pension',
            href: 'https://www.bsv.admin.ch/de/umsetzung-13-ahv-rente',
            detail: 'Financing decided on 19 June 2026 (in German)',
          },
          {
            label: 'FDP · voting recommendations',
            href: 'https://www.fdp.ch/abstimmungen-kampagnen/parolen',
            detail: 'The party campaigning against (in German)',
          },
        ],
      },
      es: {
        ...OPEN_PULSE.es,
        title: 'Cómo financiar la 13.ª jubilación AHV',
        question:
          '¿Debería subir el IVA 0,4 puntos porcentuales desde 2028 para ayudar a financiar la 13.ª jubilación AHV?',
        description:
          'El 29 de noviembre de 2026 Suiza vota si sube el IVA para pagar la 13.ª jubilación aprobada en 2024. La tasa general subiría 0,4 puntos desde 2028.',
        whyNow:
          'En marzo de 2024 se aprobó una 13.ª jubilación AHV. El 19 de junio de 2026 el Parlamento decidió financiarla en parte con una suba del IVA sin fecha de fin.',
        evidence:
          'La tasa general sube 0,4 puntos y la de alojamiento 0,2 puntos desde 2028. Como cambia la Constitución, necesita mayoría de votos y de cantones.',
        argumentsFor: [
          'Consejo Federal y Parlamento: la suba financia una jubilación que la ciudadanía ya aprobó.',
        ],
        argumentsAgainst: [
          'FDP: la suba del IVA es injusta e innecesaria, y pesa sobre los hogares y las pymes.',
        ],
        uncertainty:
          'Cómo se financia la AHV más allá de esta suba depende de la reforma AHV 2030, que esta votación no decide.',
        sources: [
          releaseSource.es,
          {
            label: 'Oficina Federal de Seguros Sociales · 13.ª jubilación AHV',
            href: 'https://www.bsv.admin.ch/de/umsetzung-13-ahv-rente',
            detail: 'Financiamiento decidido el 19 de junio de 2026 (en alemán)',
          },
          {
            label: 'FDP · recomendaciones de voto',
            href: 'https://www.fdp.ch/abstimmungen-kampagnen/parolen',
            detail: 'El partido que hace campaña en contra (en alemán)',
          },
        ],
      },
      fr: {
        ...OPEN_PULSE.fr,
        title: 'Financer la 13e rente AVS',
        question:
          'La TVA devrait-elle augmenter de 0,4 point de pourcentage dès 2028 pour aider à financer la 13e rente AVS ?',
        description:
          'Le 29 novembre 2026, la Suisse vote sur une hausse de la TVA pour payer la 13e rente AVS acceptée en 2024. Le taux normal augmenterait de 0,4 point dès 2028.',
        whyNow:
          'Une 13e rente AVS a été acceptée en mars 2024. Le 19 juin 2026, le Parlement a décidé de la financer en partie par une hausse de la TVA sans date de fin.',
        evidence:
          'Le taux normal augmente de 0,4 point et le taux de l’hébergement de 0,2 point dès 2028. Comme la Constitution change, il faut la majorité du peuple et des cantons.',
        argumentsFor: [
          'Conseil fédéral et Parlement : la hausse finance une rente que le peuple a déjà acceptée.',
        ],
        argumentsAgainst: [
          'PLR : la hausse de la TVA est injuste et inutile, et elle pèse sur les ménages et les PME.',
        ],
        uncertainty:
          'Le financement de l’AVS au-delà de cette hausse dépend de la réforme AVS 2030, que ce vote ne tranche pas.',
        sources: [
          releaseSource.fr,
          {
            label: 'Office fédéral des assurances sociales · 13e rente AVS',
            href: 'https://www.bsv.admin.ch/de/umsetzung-13-ahv-rente',
            detail: 'Financement décidé le 19 juin 2026 (en allemand)',
          },
          {
            label: 'PLR · recommandations de vote',
            href: 'https://www.fdp.ch/abstimmungen-kampagnen/parolen',
            detail: 'Le parti qui fait campagne contre (en allemand)',
          },
        ],
      },
    },
  ),
  subject(
    {
      id: 'ch-war-materiel',
      subject: 'governance',
      aliases: [
        'war materiel',
        'war material',
        'kriegsmaterial',
        'material de guerra',
        'lfmg',
        'kmg',
      ],
      ...SWISS_SCHEDULE,
    },
    {
      en: {
        ...OPEN_PULSE.en,
        title: 'Exports of war materiel',
        question:
          'Should Switzerland relax its rules on exporting and re-exporting war materiel, as Parliament decided on 19 December 2025?',
        description:
          'Swiss voters decide on 29 November 2026 on looser rules for arms exports, after a referendum. Partner countries could pass Swiss war materiel on without asking Switzerland each time.',
        whyNow:
          'Parliament amended the War Materiel Act on 19 December 2025. A referendum gathered 58,767 valid signatures, so the people decide.',
        evidence:
          'Switzerland would stop asking every buyer to promise not to re-export, unless foreign policy, neutrality or security require it. The Federal Council could depart from the approval criteria in extraordinary circumstances.',
        argumentsFor: [
          'Federal Council and Parliament: the change keeps Swiss industry in the supply chains that a neutral country outside any alliance needs for its own defence.',
        ],
        argumentsAgainst: [
          'Referendum alliance of the EVP and more than 25 organisations and parties: looser exports contradict Switzerland’s humanitarian tradition and could let Swiss arms reach conflict zones.',
        ],
        uncertainty:
          'How often the Federal Council would use its power to make exceptions, and where more Swiss arms would end up, cannot be known in advance.',
        sources: [
          releaseSource.en,
          {
            label: 'SECO · vote on the War Materiel Act',
            href: 'https://www.seco.admin.ch/de/abstimmung-kmg',
            detail: 'What changes, and the official recommendation (in German)',
          },
          {
            label: 'EVP · the referendum',
            href: 'https://www.evppev.ch/politik/kampagnen/kriegsmaterial-referendum',
            detail: 'One party of the alliance against (in German)',
          },
        ],
      },
      es: {
        ...OPEN_PULSE.es,
        title: 'Exportación de material de guerra',
        question:
          '¿Debería Suiza flexibilizar sus reglas para exportar y reexportar material de guerra, como decidió el Parlamento el 19 de diciembre de 2025?',
        description:
          'El 29 de noviembre de 2026 Suiza vota, tras un referéndum, reglas más flexibles para exportar armas. Los países socios podrían reexportar material suizo sin pedir permiso cada vez.',
        whyNow:
          'El Parlamento modificó la ley de material de guerra el 19 de diciembre de 2025. Un referéndum reunió 58.767 firmas válidas, así que decide la ciudadanía.',
        evidence:
          'Suiza dejaría de pedir a cada comprador el compromiso de no reexportar, salvo que lo exijan la política exterior, la neutralidad o la seguridad. El Consejo Federal podría apartarse de los criterios en circunstancias extraordinarias.',
        argumentsFor: [
          'Consejo Federal y Parlamento: el cambio mantiene a la industria suiza en las cadenas de suministro que un país neutral, fuera de toda alianza, necesita para su defensa.',
        ],
        argumentsAgainst: [
          'Alianza del referéndum, con el EVP y más de 25 organizaciones y partidos: exportar con menos límites contradice la tradición humanitaria suiza y podría llevar armas suizas a zonas de conflicto.',
        ],
        uncertainty:
          'No se puede saber de antemano cuántas veces usaría el Consejo Federal su facultad de excepción, ni adónde llegarían más armas suizas.',
        sources: [
          releaseSource.es,
          {
            label: 'SECO · votación sobre la ley de material de guerra',
            href: 'https://www.seco.admin.ch/de/abstimmung-kmg',
            detail: 'Qué cambia y la recomendación oficial (en alemán)',
          },
          {
            label: 'EVP · el referéndum',
            href: 'https://www.evppev.ch/politik/kampagnen/kriegsmaterial-referendum',
            detail: 'Un partido de la alianza en contra (en alemán)',
          },
        ],
      },
      fr: {
        ...OPEN_PULSE.fr,
        title: 'Exportations de matériel de guerre',
        question:
          'La Suisse devrait-elle assouplir ses règles d’exportation et de réexportation de matériel de guerre, comme l’a décidé le Parlement le 19 décembre 2025 ?',
        description:
          'Le 29 novembre 2026, la Suisse vote, après un référendum, sur des règles d’exportation d’armes plus souples. Les pays partenaires pourraient réexporter du matériel suisse sans demander chaque fois.',
        whyNow:
          'Le Parlement a modifié la loi sur le matériel de guerre le 19 décembre 2025. Un référendum a réuni 58 767 signatures valables : le peuple tranche.',
        evidence:
          'La Suisse ne demanderait plus à chaque acheteur de s’engager à ne pas réexporter, sauf si la politique extérieure, la neutralité ou la sécurité l’exigent. Le Conseil fédéral pourrait déroger aux critères dans des circonstances extraordinaires.',
        argumentsFor: [
          'Conseil fédéral et Parlement : le changement maintient l’industrie suisse dans les chaînes d’approvisionnement dont un pays neutre, hors de toute alliance, a besoin pour sa défense.',
        ],
        argumentsAgainst: [
          'Alliance référendaire, avec le PEV et plus de 25 organisations et partis : assouplir les exportations contredit la tradition humanitaire suisse et pourrait mener des armes suisses dans des zones de conflit.',
        ],
        uncertainty:
          'On ne peut pas savoir à l’avance combien de fois le Conseil fédéral userait de son droit de déroger, ni où iraient davantage d’armes suisses.',
        sources: [
          releaseSource.fr,
          {
            label: 'SECO · votation sur la loi sur le matériel de guerre',
            href: 'https://www.seco.admin.ch/de/abstimmung-kmg',
            detail: 'Ce qui change, et la recommandation officielle (en allemand)',
          },
          {
            label: 'PEV · le référendum',
            href: 'https://www.evppev.ch/politik/kampagnen/kriegsmaterial-referendum',
            detail: 'Un parti de l’alliance opposée (en allemand)',
          },
        ],
      },
    },
  ),
  subject(
    {
      id: 'ch-married-couples-tax',
      subject: 'economy',
      aliases: [
        'marriage penalty',
        'heiratsstrafe',
        'ehepaare',
        'couples mariés',
        'parejas casadas',
      ],
      ...SWISS_SCHEDULE,
    },
    {
      en: {
        ...OPEN_PULSE.en,
        title: 'Federal tax for married couples',
        question:
          'Should married couples keep a joint federal tax return and never pay more federal tax than unmarried couples?',
        description:
          'Swiss voters decide on 29 November 2026 on an initiative by Die Mitte against the “marriage penalty”. Married couples would stay taxed together for the direct federal tax.',
        whyNow:
          'On 8 March 2026 voters approved individual taxation, due to apply from 2032. This initiative takes another route: married couples would stay taxed together.',
        evidence:
          'A couple’s incomes would be added together, and the law would have to ensure that married couples are not disadvantaged compared with other taxpayers.',
        argumentsFor: [
          'Die Mitte: married couples should not pay more than unmarried couples in the same situation, and should keep one joint tax return.',
        ],
        argumentsAgainst: [
          'Federal Council and Parliament: the initiative contradicts individual taxation, which voters approved in March 2026.',
        ],
        uncertainty:
          'How the initiative would be reconciled with individual taxation would be left to Parliament after a yes.',
        sources: [
          releaseSource.en,
          {
            label: 'Federal Tax Administration · the initiative',
            href: 'https://www.estv.admin.ch/de/eidgenoessische-volksinitiative-ja-zu-fairen-bundessteuern-auch-fuer-ehepaare',
            detail: 'Text of the initiative (in German)',
          },
          {
            label: 'Federal Department of Finance · individual taxation',
            href: 'https://www.efd.admin.ch/de/abstimmung-individualbesteurung',
            detail: 'Approved on 8 March 2026 with 54.23% yes (in German)',
          },
        ],
      },
      es: {
        ...OPEN_PULSE.es,
        title: 'El impuesto federal de los matrimonios',
        question:
          '¿Los matrimonios deberían seguir declarando juntos el impuesto federal y nunca pagar más que las parejas no casadas?',
        description:
          'El 29 de noviembre de 2026 Suiza vota una iniciativa de Die Mitte contra la “penalización del matrimonio”. Los matrimonios seguirían tributando juntos en el impuesto federal directo.',
        whyNow:
          'El 8 de marzo de 2026 se aprobó la tributación individual, que se aplicará desde 2032. Esta iniciativa toma otro camino: los matrimonios seguirían tributando juntos.',
        evidence:
          'Se sumarían los ingresos de la pareja, y la ley debería asegurar que los matrimonios no queden en desventaja frente a otros contribuyentes.',
        argumentsFor: [
          'Die Mitte: un matrimonio no debería pagar más que una pareja no casada en la misma situación, y debería conservar una sola declaración conjunta.',
        ],
        argumentsAgainst: [
          'Consejo Federal y Parlamento: la iniciativa contradice la tributación individual aprobada en marzo de 2026.',
        ],
        uncertainty:
          'Cómo conciliar la iniciativa con la tributación individual quedaría en manos del Parlamento si gana el sí.',
        sources: [
          releaseSource.es,
          {
            label: 'Administración Federal de Contribuciones · la iniciativa',
            href: 'https://www.estv.admin.ch/de/eidgenoessische-volksinitiative-ja-zu-fairen-bundessteuern-auch-fuer-ehepaare',
            detail: 'Texto de la iniciativa (en alemán)',
          },
          {
            label: 'Departamento Federal de Finanzas · tributación individual',
            href: 'https://www.efd.admin.ch/de/abstimmung-individualbesteurung',
            detail: 'Aprobada el 8 de marzo de 2026 con 54,23 % de sí (en alemán)',
          },
        ],
      },
      fr: {
        ...OPEN_PULSE.fr,
        title: 'L’impôt fédéral des couples mariés',
        question:
          'Les couples mariés devraient-ils garder une déclaration fédérale commune et ne jamais payer plus d’impôt fédéral que les couples non mariés ?',
        description:
          'Le 29 novembre 2026, la Suisse vote sur une initiative du Centre contre la « pénalisation du mariage ». Les couples mariés resteraient imposés ensemble pour l’impôt fédéral direct.',
        whyNow:
          'Le 8 mars 2026, l’imposition individuelle a été acceptée ; elle s’appliquera dès 2032. Cette initiative prend une autre voie : les couples mariés resteraient imposés ensemble.',
        evidence:
          'Les revenus du couple seraient additionnés, et la loi devrait garantir que les couples mariés ne sont pas désavantagés par rapport aux autres contribuables.',
        argumentsFor: [
          'Le Centre : un couple marié ne devrait pas payer plus qu’un couple non marié dans la même situation, et devrait garder une seule déclaration commune.',
        ],
        argumentsAgainst: [
          'Conseil fédéral et Parlement : l’initiative contredit l’imposition individuelle acceptée en mars 2026.',
        ],
        uncertainty:
          'La manière de concilier l’initiative avec l’imposition individuelle serait laissée au Parlement en cas de oui.',
        sources: [
          releaseSource.fr,
          {
            label: 'Administration fédérale des contributions · l’initiative',
            href: 'https://www.estv.admin.ch/de/eidgenoessische-volksinitiative-ja-zu-fairen-bundessteuern-auch-fuer-ehepaare',
            detail: 'Texte de l’initiative (en allemand)',
          },
          {
            label: 'Département fédéral des finances · imposition individuelle',
            href: 'https://www.efd.admin.ch/de/abstimmung-individualbesteurung',
            detail: 'Acceptée le 8 mars 2026 avec 54,23 % de oui (en allemand)',
          },
        ],
      },
    },
  ),
  subject(
    {
      id: 'ch-fireworks',
      subject: 'climate',
      aliases: [
        'fireworks',
        'feuerwerk',
        'feux d’artifice',
        "feux d'artifice",
        'pirotecnia',
        'fuegos artificiales',
      ],
      ...SWISS_SCHEDULE,
    },
    {
      en: {
        ...OPEN_PULSE.en,
        title: 'Limiting fireworks',
        question: 'Should the sale and private use of loud fireworks be banned across Switzerland?',
        description:
          'Swiss voters decide on 29 November 2026 on an initiative to ban loud fireworks for private use. Professional displays of supra-regional importance could still be authorised.',
        whyNow:
          'Parliament recommends a no, and a narrower counter-proposal failed in June 2026, so the initiative goes to the vote as it was submitted.',
        evidence:
          'Fireworks that make no loud bang, such as sparklers, would stay allowed. Cantons and communes can already restrict fireworks today.',
        argumentsFor: [
          'Initiative committee: loud fireworks panic animals, cause fires and injuries, and leave about 1,300 tonnes of waste a year.',
        ],
        argumentsAgainst: [
          'Federal Council and Parliament: the initiative goes too far, because cantons and communes can already restrict fireworks.',
        ],
        uncertainty:
          'How a ban would be enforced, for example against fireworks bought abroad, would be set by law after a yes.',
        sources: [
          releaseSource.en,
          {
            label: 'Federal Department of the Environment (UVEK) · the vote',
            href: 'https://www.uvek.admin.ch/de/abstimmungen',
            detail: 'The Federal Council’s position (in German)',
          },
          {
            label: 'Initiative committee',
            href: 'https://www.feuerwerksinitiative.ch/de',
            detail: 'The committee’s case (in German)',
          },
        ],
      },
      es: {
        ...OPEN_PULSE.es,
        title: 'Limitar la pirotecnia',
        question:
          '¿Debería prohibirse en toda Suiza la venta y el uso privado de pirotecnia ruidosa?',
        description:
          'El 29 de noviembre de 2026 Suiza vota una iniciativa para prohibir la pirotecnia ruidosa de uso privado. Los espectáculos profesionales de importancia suprarregional podrían seguir autorizándose.',
        whyNow:
          'El Parlamento recomienda votar no, y un contraproyecto más acotado fracasó en junio de 2026, así que la iniciativa se vota tal como se presentó.',
        evidence:
          'La pirotecnia sin estruendo, como las bengalas, seguiría permitida. Los cantones y municipios ya pueden restringirla hoy.',
        argumentsFor: [
          'Comité de la iniciativa: la pirotecnia ruidosa asusta a los animales, causa incendios y heridas, y deja unas 1.300 toneladas de residuos por año.',
        ],
        argumentsAgainst: [
          'Consejo Federal y Parlamento: la iniciativa va demasiado lejos, porque cantones y municipios ya pueden restringir la pirotecnia.',
        ],
        uncertainty:
          'Cómo se haría cumplir la prohibición, por ejemplo con pirotecnia comprada en el exterior, lo fijaría una ley si gana el sí.',
        sources: [
          releaseSource.es,
          {
            label: 'Departamento Federal de Medio Ambiente (UVEK) · la votación',
            href: 'https://www.uvek.admin.ch/de/abstimmungen',
            detail: 'La posición del Consejo Federal (en alemán)',
          },
          {
            label: 'Comité de la iniciativa',
            href: 'https://www.feuerwerksinitiative.ch/de',
            detail: 'Los argumentos del comité (en alemán)',
          },
        ],
      },
      fr: {
        ...OPEN_PULSE.fr,
        title: 'Limiter les feux d’artifice',
        question:
          'La vente et l’usage privé de feux d’artifice bruyants devraient-ils être interdits dans toute la Suisse ?',
        description:
          'Le 29 novembre 2026, la Suisse vote sur une initiative interdisant les feux d’artifice bruyants à usage privé. Les grands spectacles professionnels d’importance suprarégionale resteraient autorisables.',
        whyNow:
          'Le Parlement recommande le non, et un contre-projet plus restreint a échoué en juin 2026 : l’initiative est soumise au vote telle qu’elle a été déposée.',
        evidence:
          'Les feux sans détonation, comme les cierges magiques, resteraient permis. Les cantons et les communes peuvent déjà restreindre les feux d’artifice aujourd’hui.',
        argumentsFor: [
          'Comité d’initiative : les feux bruyants paniquent les animaux, causent incendies et blessures, et laissent environ 1300 tonnes de déchets par an.',
        ],
        argumentsAgainst: [
          'Conseil fédéral et Parlement : l’initiative va trop loin, car les cantons et les communes peuvent déjà restreindre les feux d’artifice.',
        ],
        uncertainty:
          'La manière de faire respecter l’interdiction, par exemple face aux achats à l’étranger, serait fixée par la loi en cas de oui.',
        sources: [
          releaseSource.fr,
          {
            label: 'Département fédéral de l’environnement (DETEC) · la votation',
            href: 'https://www.uvek.admin.ch/de/abstimmungen',
            detail: 'La position du Conseil fédéral (en allemand)',
          },
          {
            label: 'Comité d’initiative',
            href: 'https://www.feuerwerksinitiative.ch/de',
            detail: 'Les arguments du comité (en allemand)',
          },
        ],
      },
    },
  ),
];
