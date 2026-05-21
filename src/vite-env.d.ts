/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * DEV-ONLY Gemini API key fallback. Read at build time and inlined into the
   * bundle, so it is visible to anyone with the build — never commit a real key
   * or ship a build that contains one. Production uses the in-app key (Settings
   * → chrome.storage.local).
   */
  readonly VITE_GEMINI_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
