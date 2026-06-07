// Deepgram STT language codes and display names (supported set)
export type DeepgramLanguage = {
  code: string;
  label: string;
};

export const DEEPGRAM_LANGUAGES: DeepgramLanguage[] = [
  { code: "bg", label: "Bulgarian" },
  { code: "ca", label: "Catalan" },
  { code: "zh", label: "Chinese (Mandarin, Simplified)" },
  { code: "zh-CN", label: "Chinese (Mandarin, Simplified CN)" },
  { code: "zh-Hans", label: "Chinese (Simplified Han)" },
  { code: "zh-TW", label: "Chinese (Mandarin, Traditional TW)" },
  { code: "zh-Hant", label: "Chinese (Traditional Han)" },
  { code: "zh-HK", label: "Chinese (Cantonese, Traditional HK)" },
  { code: "cs", label: "Czech" },
  { code: "da", label: "Danish" },
  { code: "da-DK", label: "Danish (Denmark)" },
  { code: "nl", label: "Dutch" },
  { code: "nl-BE", label: "Flemish (Belgium)" },
  { code: "en", label: "English" },
  { code: "en-US", label: "English (US)" },
  { code: "en-AU", label: "English (Australia)" },
  { code: "en-GB", label: "English (UK)" },
  { code: "en-NZ", label: "English (New Zealand)" },
  { code: "en-IN", label: "English (India)" },
  { code: "et", label: "Estonian" },
  { code: "fi", label: "Finnish" },
  { code: "fr", label: "French" },
  { code: "fr-CA", label: "French (Canada)" },
  { code: "de", label: "German" },
  { code: "de-CH", label: "German (Switzerland)" },
  { code: "el", label: "Greek" },
  { code: "hi", label: "Hindi" },
  { code: "hu", label: "Hungarian" },
  { code: "id", label: "Indonesian" },
  { code: "it", label: "Italian" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "ko-KR", label: "Korean (South Korea)" },
  { code: "lv", label: "Latvian" },
  { code: "lt", label: "Lithuanian" },
  { code: "ms", label: "Malay" },
  { code: "no", label: "Norwegian" },
  { code: "pl", label: "Polish" },
  { code: "pt", label: "Portuguese" },
  { code: "pt-BR", label: "Portuguese (Brazil)" },
  { code: "pt-PT", label: "Portuguese (Portugal)" },
  { code: "ro", label: "Romanian" },
  { code: "ru", label: "Russian" },
  { code: "sk", label: "Slovak" },
  { code: "es", label: "Spanish" },
  { code: "es-419", label: "Spanish (LatAm)" },
  { code: "sv", label: "Swedish" },
  { code: "sv-SE", label: "Swedish (Sweden)" },
  { code: "th", label: "Thai" },
  { code: "th-TH", label: "Thai (Thailand)" },
  { code: "tr", label: "Turkish" },
  { code: "uk", label: "Ukrainian" },
  { code: "vi", label: "Vietnamese" },
];

/**
 * Get language name from language code
 * @param code - Language code (e.g., "en-US")
 * @returns Language name (e.g., "English (US)") or "English" if not found
 */
export function getLanguageName(code: string): string {
  const language = DEEPGRAM_LANGUAGES.find((lang) => lang.code === code);
  return language?.label || "English";
}
