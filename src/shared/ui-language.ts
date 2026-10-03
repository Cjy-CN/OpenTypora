export type UiLanguage = 'zh-CN' | 'en';

/** The first OS preference selects the UI; unsupported languages fall back to English. */
export function resolveUiLanguage(preference: string, systemLanguages: readonly string[]): UiLanguage {
  if (preference === 'zh-CN' || preference === 'en') return preference;
  const primary = systemLanguages.find(language => language.trim())?.trim().replaceAll('_', '-').toLowerCase();
  return primary === 'zh' || primary?.startsWith('zh-') ? 'zh-CN' : 'en';
}
