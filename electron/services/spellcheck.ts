import type { Session } from 'electron';
import { serviceError, string } from './validation';

type SpellcheckSession = Pick<Session, 'availableSpellCheckerLanguages' | 'getSpellCheckerLanguages' | 'isSpellCheckerEnabled' | 'setSpellCheckerEnabled' | 'setSpellCheckerLanguages'>;
export interface SpellcheckStatus { enabled: boolean; languages: string[]; availableLanguages: string[] }
const languageKey = (language: string) => language.replace(/_/g, '-').toLowerCase();

/** Resolve OS locale variants to Electron's actual dictionary codes, in preference order. */
export function preferredSpellcheckLanguages(preferred: readonly string[], available: readonly string[]): string[] {
  const result: string[] = [];
  for (const preference of preferred) {
    const key = languageKey(preference), base = key.split('-')[0];
    const matched = available.find(language => languageKey(language) === key)
      ?? available.find(language => languageKey(language) === base)
      ?? (base === 'en' ? available.find(language => languageKey(language) === 'en-us') : undefined)
      ?? available.find(language => languageKey(language).split('-')[0] === base);
    if (matched && !result.includes(matched)) result.push(matched);
  }
  // Electron otherwise falls back to en-US for an empty dictionary list.
  if (!result.length) {
    const fallback = available.find(language => languageKey(language) === 'en-us');
    if (fallback) result.push(fallback);
  }
  return result;
}

export class SpellcheckService {
  constructor(readonly session: SpellcheckSession, readonly preferredLanguages: () => string[]) {}
  status(): SpellcheckStatus {
    return { enabled: this.session.isSpellCheckerEnabled(), languages: [...this.session.getSpellCheckerLanguages()], availableLanguages: [...this.session.availableSpellCheckerLanguages] };
  }
  configure(value: unknown): SpellcheckStatus {
    const requested = string(value, '拼写语言', 200).trim();
    if (requested === 'off') { this.session.setSpellCheckerEnabled(false); return this.status(); }
    const available = this.session.availableSpellCheckerLanguages;
    const languages = requested === 'auto'
      ? preferredSpellcheckLanguages(this.preferredLanguages(), available)
      : available.filter(language => languageKey(language) === languageKey(requested));
    if (!languages.length) throw serviceError('SPELLCHECK_LANGUAGE_UNAVAILABLE', requested === 'auto'
      ? '系统偏好语言没有可用拼写词典；请在拼写语言中选择可用语言或 off 关闭'
      : `不支持拼写语言“${requested}”；请从可用语言中选择，或使用 auto / off`, { requested, availableLanguages: [...available] });
    // Validate before changing the session so an invalid preference preserves its current state.
    this.session.setSpellCheckerLanguages(languages);
    this.session.setSpellCheckerEnabled(true);
    return this.status();
  }
}
