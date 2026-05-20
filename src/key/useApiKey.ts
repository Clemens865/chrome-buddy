// useApiKey — React hook for managing a provider's API key from the UI.
//
// The UI never holds the key in React state for longer than the keystroke that
// submits it: setKey() hands the key straight to the background SW (KEY_SET) and
// the hook only ever tracks a boolean "is a key set?" derived from KEY_STATUS.
// validate() asks the SW to test a candidate key live (KEY_VALIDATE).
//
// See src/key/messages.ts for the protocol and src/background/background.ts for
// the handlers.

import { useCallback, useEffect, useState } from 'react';
import type {
  ErrorResponse,
  KeySetMessage,
  KeySetResponse,
  KeyStatusMessage,
  KeyStatusResponse,
  KeyValidateMessage,
  KeyValidateResponse,
} from './messages';

export type KeyStatus = 'unknown' | 'set' | 'unset';

export interface ValidateResult {
  ok: boolean;
  error?: string;
}

export interface UseApiKey {
  /** Whether a key is currently stored in the SW session. */
  keyStatus: KeyStatus;
  /** Store a key in the SW (empty string clears it), then refresh status. */
  setKey: (key: string) => Promise<void>;
  /** Live-validate a candidate key without storing it. */
  validate: (key: string) => Promise<ValidateResult>;
  /** Re-query KEY_STATUS. */
  refresh: () => Promise<void>;
}

function canMessage(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.runtime?.sendMessage;
}

export function useApiKey(provider: string): UseApiKey {
  const [keyStatus, setKeyStatus] = useState<KeyStatus>('unknown');

  const refresh = useCallback(async () => {
    if (!canMessage()) {
      setKeyStatus('unset');
      return;
    }
    const msg: KeyStatusMessage = { type: 'KEY_STATUS', provider };
    const res = (await chrome.runtime.sendMessage(msg)) as
      | KeyStatusResponse
      | ErrorResponse
      | undefined;
    if (res && res.type === 'KEY_STATUS') {
      setKeyStatus(res.hasKey ? 'set' : 'unset');
    } else {
      setKeyStatus('unset');
    }
  }, [provider]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setKey = useCallback(
    async (key: string) => {
      if (!canMessage()) return;
      const msg: KeySetMessage = { type: 'KEY_SET', provider, key };
      (await chrome.runtime.sendMessage(msg)) as KeySetResponse | ErrorResponse | undefined;
      await refresh();
    },
    [provider, refresh],
  );

  const validate = useCallback(
    async (key: string): Promise<ValidateResult> => {
      if (!canMessage()) return { ok: false, error: 'Extension messaging unavailable.' };
      const msg: KeyValidateMessage = { type: 'KEY_VALIDATE', provider, key };
      const res = (await chrome.runtime.sendMessage(msg)) as
        | KeyValidateResponse
        | ErrorResponse
        | undefined;
      if (!res) return { ok: false, error: 'No response from background.' };
      if (res.type === 'KEY_VALIDATE') return { ok: res.ok, error: res.error };
      return { ok: false, error: res.error };
    },
    [provider],
  );

  return { keyStatus, setKey, validate, refresh };
}
