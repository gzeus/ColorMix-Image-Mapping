import type { ReliefSettings } from '../lib/geometry/meshTypes';

type Props = {
  settings: ReliefSettings;
  onChange: (settings: ReliefSettings) => void;
};

export function ReliefControls({ settings, onChange }: Props) {
  const patch = (partial: Partial<ReliefSettings>) => onChange({ ...settings, ...partial });
  return (
    <section className="panel-section">
      <h2>Relief</h2>
      <label className="check-row"><input type="checkbox" checked={settings.enabled} onChange={(event) => patch({ enabled: event.target.checked })} /> Enable displacement</label>
      <label className="slider-row">
        <span>Strength</span>
        <input type="range" min="0" max="2" step="0.05" value={settings.strengthMm} onChange={(event) => patch({ strengthMm: Number(event.target.value) })} />
        <output>{settings.strengthMm.toFixed(2)} mm</output>
      </label>
      <label className="slider-row">
        <span>Blur</span>
        <input type="range" min="0" max="6" step="1" value={settings.blurPx} onChange={(event) => patch({ blurPx: Number(event.target.value) })} />
        <output>{settings.blurPx}px</output>
      </label>
      <label className="check-row"><input type="checkbox" checked={settings.invert} onChange={(event) => patch({ invert: event.target.checked })} /> Invert relief</label>
    </section>
  );
}
