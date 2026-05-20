// theme.ts — theme tokens + helpers (ported from the design prototype).

import type { CSSProperties } from 'react';

export type ThemeName = 'slate' | 'cream' | 'graphite';

export interface Theme {
  name: string;
  bg: string;
  pageBg: string;
  pageFg: string;
  pageMuted: string;
  pageBorder: string;
  panelBg: string;
  panelFg: string;
  panelMuted: string;
  panelMutedSoft: string;
  panelBorder: string;
  panelBorderSoft: string;
  panelElev: string;
  panelElev2: string;
  railBg: string;
  railFg: string;
  code: string;
  codeFg: string;
  chip: string;
  chipFg: string;
  shadow: string;
  shadowSoft: string;
  accents: string[];
}

export const THEMES: Record<ThemeName, Theme> = {
  slate: {
    name: 'Slate',
    bg: '#F4F4F5', pageBg: '#FFFFFF', pageFg: '#0A0A0A', pageMuted: '#71717A', pageBorder: '#E4E4E7',
    panelBg: '#FFFFFF', panelFg: '#0A0A0A', panelMuted: '#71717A', panelMutedSoft: '#A1A1AA',
    panelBorder: '#E4E4E7', panelBorderSoft: '#F1F1F4', panelElev: '#F8F8F9', panelElev2: '#F1F1F4',
    railBg: '#FAFAFA', railFg: '#52525B', code: '#F4F4F5', codeFg: '#27272A', chip: '#F4F4F5', chipFg: '#3F3F46',
    shadow: '0 1px 2px rgba(0,0,0,.04), 0 12px 32px -8px rgba(0,0,0,.10)',
    shadowSoft: '0 1px 0 rgba(0,0,0,.02), 0 1px 2px rgba(0,0,0,.04)',
    accents: ['#6366F1', '#0EA5E9', '#10B981', '#F59E0B', '#F43F5E', '#8B5CF6'],
  },
  cream: {
    name: 'Cream',
    bg: '#EFEAE1', pageBg: '#FBF8F3', pageFg: '#1F1B14', pageMuted: '#6E6960', pageBorder: '#E8E2D7',
    panelBg: '#FBF8F3', panelFg: '#1F1B14', panelMuted: '#6E6960', panelMutedSoft: '#9A9389',
    panelBorder: '#E8E2D7', panelBorderSoft: '#F1ECE2', panelElev: '#F4EFE5', panelElev2: '#EDE6D9',
    railBg: '#F4EFE5', railFg: '#534E45', code: '#F4EFE5', codeFg: '#3A352D', chip: '#F1ECE2', chipFg: '#3A352D',
    shadow: '0 1px 2px rgba(60,40,20,.05), 0 14px 36px -10px rgba(60,40,20,.16)',
    shadowSoft: '0 1px 0 rgba(60,40,20,.02), 0 1px 2px rgba(60,40,20,.05)',
    accents: ['#C26F4A', '#6B8C5A', '#2A4B6E', '#B8893A', '#8B4F8A', '#1F1B14'],
  },
  graphite: {
    name: 'Graphite',
    bg: '#0A0B0E', pageBg: '#0F1115', pageFg: '#E8EAF0', pageMuted: '#8B92A0', pageBorder: '#1E2229',
    panelBg: '#13161B', panelFg: '#E8EAF0', panelMuted: '#8B92A0', panelMutedSoft: '#5C6371',
    panelBorder: '#262B33', panelBorderSoft: '#1B1F26', panelElev: '#1A1E25', panelElev2: '#22272F',
    railBg: '#0F1115', railFg: '#A1A8B5', code: '#0B0D11', codeFg: '#D4D8E0', chip: '#1A1E25', chipFg: '#C5CAD4',
    shadow: '0 1px 2px rgba(0,0,0,.4), 0 18px 40px -12px rgba(0,0,0,.6)',
    shadowSoft: '0 1px 0 rgba(255,255,255,.02), 0 1px 2px rgba(0,0,0,.4)',
    accents: ['#22D3EE', '#A78BFA', '#84CC16', '#FBBF24', '#F472B6', '#60A5FA'],
  },
};

export function hexAlpha(hex: string, a: number): string {
  if (!hex || hex[0] !== '#') return hex;
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

export function applyTheme(theme: Theme, accent: string): CSSProperties {
  return {
    '--bg': theme.bg,
    '--page-bg': theme.pageBg,
    '--page-fg': theme.pageFg,
    '--page-muted': theme.pageMuted,
    '--page-border': theme.pageBorder,
    '--panel-bg': theme.panelBg,
    '--panel-fg': theme.panelFg,
    '--panel-muted': theme.panelMuted,
    '--panel-muted-soft': theme.panelMutedSoft,
    '--panel-border': theme.panelBorder,
    '--panel-border-soft': theme.panelBorderSoft,
    '--panel-elev': theme.panelElev,
    '--panel-elev-2': theme.panelElev2,
    '--rail-bg': theme.railBg,
    '--rail-fg': theme.railFg,
    '--code': theme.code,
    '--code-fg': theme.codeFg,
    '--chip': theme.chip,
    '--chip-fg': theme.chipFg,
    '--shadow': theme.shadow,
    '--shadow-soft': theme.shadowSoft,
    '--accent': accent,
    '--accent-soft': hexAlpha(accent, 0.12),
    '--accent-softer': hexAlpha(accent, 0.06),
  } as CSSProperties;
}
