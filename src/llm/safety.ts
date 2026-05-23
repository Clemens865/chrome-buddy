// Gemini safety settings — explicit, because defaults are OFF on 2.5/3.
// (See /Users/clemenshoenig/Documents/Software-Projects/Google_Geminin_documentation/safety-settings.md L65, L82-83.)
//
// We pick BLOCK_MEDIUM_AND_ABOVE for the four adjustable categories as the
// "normal" preset for a productivity tool. A "strict" preset would use
// BLOCK_LOW_AND_ABOVE. BLOCK_NONE / OFF on these categories may subject the
// extension to Google review (safety-settings.md L12 note) and is avoided.

export type HarmCategory =
  | 'HARM_CATEGORY_HARASSMENT'
  | 'HARM_CATEGORY_HATE_SPEECH'
  | 'HARM_CATEGORY_SEXUALLY_EXPLICIT'
  | 'HARM_CATEGORY_DANGEROUS_CONTENT';

export type HarmBlockThreshold =
  | 'BLOCK_LOW_AND_ABOVE'
  | 'BLOCK_MEDIUM_AND_ABOVE'
  | 'BLOCK_ONLY_HIGH'
  | 'BLOCK_NONE'
  | 'OFF';

export interface SafetySetting {
  category: HarmCategory;
  threshold: HarmBlockThreshold;
}

export type SafetyPreset = 'normal' | 'strict';

const CATEGORIES: HarmCategory[] = [
  'HARM_CATEGORY_HARASSMENT',
  'HARM_CATEGORY_HATE_SPEECH',
  'HARM_CATEGORY_SEXUALLY_EXPLICIT',
  'HARM_CATEGORY_DANGEROUS_CONTENT',
];

/** Standard safety settings to attach to every Gemini request. */
export function defaultSafetySettings(preset: SafetyPreset = 'normal'): SafetySetting[] {
  const threshold: HarmBlockThreshold =
    preset === 'strict' ? 'BLOCK_LOW_AND_ABOVE' : 'BLOCK_MEDIUM_AND_ABOVE';
  return CATEGORIES.map((category) => ({ category, threshold }));
}

/** snake_case shape required by the native generateContent endpoint. */
export function safetySettingsForNative(preset: SafetyPreset = 'normal'): { category: string; threshold: string }[] {
  return defaultSafetySettings(preset).map((s) => ({ category: s.category, threshold: s.threshold }));
}
