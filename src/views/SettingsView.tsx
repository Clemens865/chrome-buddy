// SettingsView.tsx — real settings: appearance (theme + accent), BYO key, model.
// No mock account/usage data.
import { type ReactNode } from 'react';
import { Pill } from '../ui/primitives';
import { THEMES, type ThemeName } from '../ui/theme';
import { DEFAULT_REGISTRY } from '../llm/registry.default';
import { usePersistedState } from '../sidepanel/usePersistedState';

interface SettingsProps {
  themeName: ThemeName;
  accent: string;
  onThemeChange: (t: ThemeName) => void;
  onAccentChange: (a: string) => void;
}

const THEME_NAMES: ThemeName[] = ['slate', 'cream', 'graphite'];

export function SettingsView({ themeName, accent, onThemeChange, onAccentChange }: SettingsProps) {
  const theme = THEMES[themeName] ?? THEMES.slate;
  const defaultModel = DEFAULT_REGISTRY.defaultModel ?? 'gemini-3.5-flash';
  const [overlayEnabled, setOverlayEnabled] = usePersistedState<boolean>('overlayEnabled', true);

  return (
    <div className="settings">
      <div className="settings-section">
        <div className="settings-section-h">Appearance</div>
        <SettingsRow t="Theme" s="Color mood for the panel">
          <div className="seg">
            {THEME_NAMES.map((name) => (
              <button key={name} type="button" className={'seg-btn' + (themeName === name ? ' is-on' : '')} onClick={() => onThemeChange(name)}>
                {THEMES[name].name}
              </button>
            ))}
          </div>
        </SettingsRow>
        <SettingsRow t="Accent" s="Highlight color">
          <div className="accent-swatches">
            {theme.accents.map((c) => (
              <button
                key={c}
                type="button"
                className={'accent-swatch' + (accent === c ? ' is-on' : '')}
                style={{ background: c }}
                onClick={() => onAccentChange(c)}
                aria-label={'Accent ' + c}
              />
            ))}
          </div>
        </SettingsRow>
      </div>

      <div className="settings-section">
        <div className="settings-section-h">On web pages</div>
        <SettingsRow t="Floating overlay" s="Show the panel floating over web pages (off = side panel only)">
          <Toggle on={overlayEnabled} onChange={setOverlayEnabled} />
        </SettingsRow>
      </div>

      <div className="settings-section">
        <div className="settings-section-h">API key</div>
        <SettingsRow t="Gemini API key" s="Stored locally · used for all cloud calls">
          <button type="button" className="btn btn-primary btn-sm">Add key</button>
        </SettingsRow>
      </div>

      <div className="settings-section">
        <div className="settings-section-h">Model</div>
        <SettingsRow t="Default model" s="Used for chat and skills"><Pill>{defaultModel}</Pill></SettingsRow>
        <SettingsRow t="Computer Use fallback" s="When DOM tools aren't enough"><Pill>gemini-2.5-computer-use</Pill></SettingsRow>
      </div>

      <div className="settings-section">
        <div className="settings-section-h">Permissions</div>
        <SettingsRow t="Require confirmation for" s="Consequential actions (send · purchase · delete)"><Pill tone="ok">Always on</Pill></SettingsRow>
      </div>

      <div className="settings-section">
        <div className="settings-section-h">Data</div>
        <SettingsRow t="Memory & history" s="Stored locally on this device"><button type="button" className="btn btn-ghost btn-sm">Clear</button></SettingsRow>
        <SettingsRow t="Export skills" s="Download all skills as JSON"><button type="button" className="btn btn-ghost btn-sm">Export</button></SettingsRow>
      </div>
    </div>
  );
}

function SettingsRow({ t, s, children }: { t: string; s: string; children: ReactNode }) {
  return (
    <div className="settings-row">
      <div className="settings-row-l">
        <div>
          <div className="settings-row-t">{t}</div>
          <div className="settings-row-s">{s}</div>
        </div>
      </div>
      <div className="settings-row-r">{children}</div>
    </div>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" className={'toggle' + (on ? ' is-on' : '')} onClick={() => onChange(!on)} aria-pressed={on} aria-label="Toggle">
      <span className="toggle-thumb" />
    </button>
  );
}
