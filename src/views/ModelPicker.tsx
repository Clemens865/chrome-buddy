// ModelPicker — a chip-styled dropdown of the ACTUAL models (Auto + named
// Gemini/Claude), used in the chat composer AND the app builder. Self-contained:
// it reads/writes the shared persisted model preference (intent + exact id), so
// every call site (chat, agent, builder, skills) resolves the same choice. Claude
// entries are key-gated. Picking a named model pins it exactly (no surprise Opus);
// "Auto (Balanced)" keeps the smart default.
import { useApiKey } from '../key/useApiKey';
import { useModelIntent, useActiveModel, useResolvedModelId } from '../llm/modelPref';
import { DEFAULT_REGISTRY } from '../llm/registry.default';
import { buildModelMenu, selectedMenuValue, AUTO_VALUE } from '../llm/modelMenu';
import { Ic } from '../ui/icons';

export function ModelPicker({ title }: { title?: string }) {
  const [intent, setIntent] = useModelIntent();
  const [, setActiveModel] = useActiveModel();
  const resolved = useResolvedModelId();
  const { keyStatus } = useApiKey('anthropic');
  const groups = buildModelMenu(DEFAULT_REGISTRY, keyStatus === 'set');
  const value = selectedMenuValue(intent, resolved);

  const onChange = (v: string) => {
    if (v === AUTO_VALUE) {
      setIntent('balanced');
    } else {
      setActiveModel(v);
      setIntent('custom');
    }
  };

  return (
    <label className="ctx-chip ctx-chip-select" title={title ?? 'Model for this chat — pick a specific model, or Auto for a smart default'}>
      <span className="ctx-chip-ic">{Ic.chart}</span>
      <select aria-label="Model" value={value} onChange={(e) => onChange(e.target.value)} data-testid="model-picker">
        {groups.map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.items.map((it) => (
              <option key={it.value} value={it.value} disabled={it.disabled}>
                {it.label}{it.hint ? ` · ${it.hint}` : ''}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}
