// Key-event helpers for Computer Use `key_combination` — converts a string like
// "control+c" into CDP keyDown/keyUp event payloads. Pure + unit-tested.

/** CDP modifier bitmask. */
const MOD: Record<string, number> = {
  alt: 1,
  ctrl: 2,
  control: 2,
  meta: 4,
  cmd: 4,
  command: 4,
  shift: 8,
};

interface NamedKey {
  key: string;
  code: string;
  windowsVirtualKeyCode: number;
}

const NAMED: Record<string, NamedKey> = {
  enter: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 },
  return: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 },
  tab: { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 },
  escape: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 },
  esc: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 },
  space: { key: ' ', code: 'Space', windowsVirtualKeyCode: 32 },
  backspace: { key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 },
  delete: { key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 },
  home: { key: 'Home', code: 'Home', windowsVirtualKeyCode: 36 },
  end: { key: 'End', code: 'End', windowsVirtualKeyCode: 35 },
  pageup: { key: 'PageUp', code: 'PageUp', windowsVirtualKeyCode: 33 },
  pagedown: { key: 'PageDown', code: 'PageDown', windowsVirtualKeyCode: 34 },
  arrowup: { key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 },
  arrowdown: { key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 },
  arrowleft: { key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 },
  arrowright: { key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 },
  up: { key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 },
  down: { key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 },
  left: { key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 },
  right: { key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 },
};

/** Resolve a single token (e.g. "c", "Enter", "ArrowUp") to a CDP key payload. */
export function keyInfo(token: string): NamedKey {
  const t = token.trim().toLowerCase();
  if (NAMED[t]) return NAMED[t];
  if (t.length === 1 && t >= 'a' && t <= 'z') {
    return { key: t, code: `Key${t.toUpperCase()}`, windowsVirtualKeyCode: t.toUpperCase().charCodeAt(0) };
  }
  if (t.length === 1 && t >= '0' && t <= '9') {
    return { key: t, code: `Digit${t}`, windowsVirtualKeyCode: t.charCodeAt(0) };
  }
  // Single non-letter, non-digit char (e.g. "/", "?") — let CDP infer.
  if (t.length === 1) {
    return { key: t, code: t, windowsVirtualKeyCode: t.toUpperCase().charCodeAt(0) };
  }
  // Unknown token — best-effort fallback.
  return { key: token, code: token, windowsVirtualKeyCode: 0 };
}

/** Parse a "control+shift+a" style combo into a modifier bitmask + main key. */
export function parseKeys(combo: string): { modifiers: number; main: NamedKey } {
  const parts = combo.split('+').map((p) => p.trim().toLowerCase()).filter(Boolean);
  let mods = 0;
  let mainTok = '';
  for (const p of parts) {
    if (MOD[p] !== undefined) mods |= MOD[p];
    else mainTok = p;
  }
  return { modifiers: mods, main: keyInfo(mainTok) };
}
