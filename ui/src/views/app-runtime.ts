/*
 * App-level runtime facts: which mode the build is in, what the network is
 * called in each locale, and the shell copy the chrome needs.
 *
 * Extracted from App.tsx unchanged so views can read them without importing
 * the app itself.
 */

import type { PassportNetwork } from 'midnight-referendum-api';
import { resolveAppMode } from '@/integration/app-mode';
import type { CicoLocale } from '@/integration/locale';

/**
 * Three destinations. Five used to share the bar, and two of them, the pass
 * and the Passport account, were the same person seen from two sides.
 */
export type Tab = 'consultations' | 'cleisthenes' | 'you';
/** What the `you` destination is showing: its summary, or one part of it in full. */
export type YouSection = 'hub' | 'pass' | 'answers' | 'account';
/**
 * `verify` and `eligible` are gone. Nothing ever set them: `startVote` sends a
 * credentialled user straight to `choose` and everyone else into the Passport
 * journey, so the two screens they named were unreachable -- which is why the
 * vote flow opened on "Paso 3 de 3", a progress counter that started at the
 * end.
 */
export type FlowStage = 'choose' | 'review' | 'processing' | 'receipt';

/** The active app keeps the same language across identity, jury, and receipt surfaces. */
export const APP_COPY = {
  es: {
    language: 'Idioma',
    nav: { consultations: 'Consultas', cleisthenes: 'Cleisthenes', you: 'Vos' },
    network: { undeployed: 'Local no desplegado', preview: 'Preview', demo: 'Demo local' },
  },
  en: {
    language: 'Language',
    nav: { consultations: 'Consultations', cleisthenes: 'Cleisthenes', you: 'You' },
    network: { undeployed: 'Undeployed local', preview: 'Preview', demo: 'Local demo' },
  },
  fr: {
    language: 'Langue',
    nav: { consultations: 'Consultations', cleisthenes: 'Cleisthenes', you: 'Vous' },
    network: { undeployed: 'Local non déployé', preview: 'Preview', demo: 'Démo locale' },
  },
} as const;

export const APP_MODE = resolveAppMode(import.meta.env.MODE, import.meta.env.VITE_APP_MODE);
// Demo/showcase are presentation boundaries. Undeployed and Preview both use
// the real v2 catalog and fail closed when it is missing or invalid.
export const CHAIN_RUNTIME_ENABLED = APP_MODE === 'preview' || APP_MODE === 'undeployed';
export const APP_NETWORK_LABEL =
  APP_MODE === 'undeployed'
    ? 'Undeployed local'
    : APP_MODE === 'preview'
      ? 'Preview'
      : 'Demo local';
export function networkLabel(locale: CicoLocale): string {
  return APP_MODE === 'undeployed'
    ? APP_COPY[locale].network.undeployed
    : APP_MODE === 'preview'
      ? APP_COPY[locale].network.preview
      : APP_COPY[locale].network.demo;
}
export const PASSPORT_ORIGIN =
  import.meta.env.VITE_PASSPORT_ORIGIN?.trim() || 'https://midnightpassport.com';
const configuredPassportNetwork = import.meta.env.VITE_PASSPORT_NETWORK?.trim();
export const PASSPORT_ACCOUNT_NETWORK: Exclude<PassportNetwork, 'mainnet'> =
  configuredPassportNetwork === 'preview' ||
  configuredPassportNetwork === 'devnet' ||
  configuredPassportNetwork === 'stagenet'
    ? configuredPassportNetwork
    : 'stagenet';

export function passportNetworkLabel(network: PassportNetwork, locale: CicoLocale): string {
  if (network === 'stagenet') return 'Stagenet';
  if (network === 'preview') return 'Preview';
  if (network === 'mainnet') return 'Mainnet';
  return locale === 'es'
    ? 'Desarrollo local'
    : locale === 'fr'
      ? 'Développement local'
      : 'Local development';
}
export const ONBOARDING_SESSION_KEY = 'cico-wave1-onboarding-complete';
/** The app, and the one screen inside it that has an address of its own. */
export const APP_ROUTE = '#app';
export const PULSE_ROUTE = '#app/pulse';

export function shouldShowFirstRunOnboarding(): boolean {
  if (typeof window === 'undefined') return true;
  return window.sessionStorage.getItem(ONBOARDING_SESSION_KEY) !== '1';
}
