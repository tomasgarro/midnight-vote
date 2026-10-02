import type { CredentialSummary, ReferendumV2CatalogEntry } from 'midnight-referendum-api';
import type {
  PassportV2RuntimeReferendum,
  ReferendumTranslations,
} from './passport-v2-runtime-config';

export type PassportReferendumScope = 'global' | 'country';

/** Safe display data for a configured Passport v2 referendum. */
export interface PassportV2CatalogItem {
  readonly referendumId: string;
  readonly title: string;
  readonly question: string;
  readonly description?: string;
  readonly opened?: string;
  readonly deadline?: string;
  readonly opensAt?: string;
  readonly closesAt?: string;
  readonly eligible?: string;
  readonly participation?: string;
  readonly scope: PassportReferendumScope;
  /** Title, question and description in other languages, when the catalogue has them. */
  readonly translations?: ReferendumTranslations;
  readonly source?: ReferendumV2CatalogEntry;
}

export function toPassportV2Catalog(
  referenda: readonly PassportV2RuntimeReferendum[],
): readonly PassportV2CatalogItem[] {
  return referenda.map((entry) => ({
    referendumId: entry.referendumId,
    title: entry.title,
    question: entry.question,
    ...(entry.description ? { description: entry.description } : {}),
    ...(entry.opened ? { opened: entry.opened } : {}),
    ...(entry.deadline ? { deadline: entry.deadline } : {}),
    ...(entry.opensAt ? { opensAt: entry.opensAt } : {}),
    ...(entry.closesAt ? { closesAt: entry.closesAt } : {}),
    ...(entry.eligible ? { eligible: entry.eligible } : {}),
    ...(entry.participation ? { participation: entry.participation } : {}),
    scope: entry.config.countryPolicyEnabled ? 'country' : 'global',
    ...(entry.translations ? { translations: entry.translations } : {}),
    source: entry,
  }));
}

/**
 * The local preview fixture is only used by older injected-port tests. A real
 * Preview deployment always supplies `VITE_CICO_REFERENDA_JSON` instead.
 */
export const LEGACY_PREVIEW_CATALOG: readonly PassportV2CatalogItem[] = [
  {
    referendumId: 'tierras-rurales:world',
    title: 'Tierras rurales y propiedad extranjera',
    question:
      '¿Debería Argentina mantener un régimen nacional de límites y controles sobre la titularidad y posesión extranjera de tierras rurales?',
    scope: 'global',
  },
  {
    referendumId: 'tierras-rurales:032',
    title: 'Tierras rurales y propiedad extranjera',
    question:
      '¿Debería Argentina mantener un régimen nacional de límites y controles sobre la titularidad y posesión extranjera de tierras rurales?',
    scope: 'country',
  },
];

export function eligibilityCopy(scope: PassportReferendumScope): string {
  return scope === 'global'
    ? 'Elegibilidad global: se comprueba una credencial cívica válida, sin comprobar un país específico.'
    : 'Elegibilidad territorial: se comprueba en privado que tu credencial cumple la política de país configurada. El país no se publica ni se adjunta al voto.';
}

/** Decode the numeric country policy without exposing it in public copy. */
export function countryPolicyCode(item: PassportV2CatalogItem): string | null {
  if (item.scope !== 'country' || !item.source) return null;
  const bytes = item.source.config.countryPolicy;
  if (!(bytes instanceof Uint8Array) || bytes.length !== 32) return null;
  const decoded = new TextDecoder().decode(bytes).replace(/\0+$/u, '');
  return /^[0-9]{3}$/u.test(decoded) ? decoded : null;
}

export function catalogEligibility(
  item: PassportV2CatalogItem,
  credential: CredentialSummary | null | undefined,
): { readonly available: boolean; readonly reason?: string } {
  if (!credential) {
    return { available: false, reason: 'Necesitás una credencial cívica vigente.' };
  }
  if (item.source) {
    const policy = item.source.config;
    const credentialEpoch = BigInt(credential.credentialEpoch);
    if (credentialEpoch !== policy.registry.credentialEpoch) {
      return {
        available: false,
        reason:
          credentialEpoch > policy.registry.credentialEpoch
            ? 'Esta consulta usa una cohorte anterior. Tu credencial quedará disponible para una consulta de su propio epoch.'
            : 'Esta consulta requiere una cohorte más reciente. Renová la credencial para el próximo epoch.',
      };
    }
    const validUntilSeconds = Math.floor(Date.parse(credential.validUntil) / 1_000);
    if (
      !Number.isSafeInteger(validUntilSeconds) ||
      BigInt(validUntilSeconds) < policy.validityReference
    ) {
      return {
        available: false,
        reason: 'La credencial no cubre la fecha de validez exigida por esta consulta.',
      };
    }
    const credentialAssurance = assuranceLevel(credential.assurance);
    if (credentialAssurance < policy.minimumAssurance) {
      return {
        available: false,
        reason: 'Esta consulta requiere un nivel de verificación documental superior.',
      };
    }
    if (policy.requireAdult && credential.ageClass !== '18-plus') {
      return {
        available: false,
        reason: 'La credencial no cumple el predicado de edad configurado.',
      };
    }
  }
  if (item.scope === 'global') return { available: true };
  const policyCountry = countryPolicyCode(item);
  if (!policyCountry) {
    return {
      available: false,
      reason:
        'No pudimos comprobar en privado la política territorial. Esta consulta no está disponible.',
    };
  }
  if (policyCountry !== credential.country) {
    return {
      available: false,
      reason: 'Esta consulta requiere otra política territorial; tu país no se comparte.',
    };
  }
  return { available: true };
}

function assuranceLevel(value: CredentialSummary['assurance']): bigint {
  switch (value) {
    case 'self-asserted':
      return 0n;
    case 'document':
      return 1n;
    case 'document-nfc':
      return 2n;
    case 'passport-native':
      return 3n;
  }
}

export function scopeLabel(scope: PassportReferendumScope): string {
  return scope === 'global' ? 'Consulta global' : 'Consulta con política territorial';
}
