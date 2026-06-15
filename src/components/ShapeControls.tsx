import type { ShapeSettings } from '../lib/geometry/meshTypes';

type Props = {
  settings: ShapeSettings;
  onChange: (settings: ShapeSettings) => void;
};

const presets = {
  Draft: { radialSegments: 128, heightSegments: 128 },
  Normal: { radialSegments: 256, heightSegments: 256 },
  High: { radialSegments: 512, heightSegments: 384 },
};

export function ShapeControls({ settings, onChange }: Props) {
  const patch = (partial: Partial<ShapeSettings>) => onChange({ ...settings, ...partial });
  return (
    <section className="panel-section">
      <h2>Shape</h2>
      <div className="segmented">
        <button type="button" className={settings.type === 'cylinder' ? 'active' : ''} onClick={() => patch({ type: 'cylinder' })}>Cylinder</button>
        <button type="button" className={settings.type === 'vase' ? 'active' : ''} onClick={() => patch({ type: 'vase' })}>Vase</button>
      </div>
      <label className="number-row"><span>Height mm</span><input type="number" min="5" value={settings.heightMm} onChange={(e) => patch({ heightMm: Number(e.target.value) })} /></label>
      {settings.type === 'cylinder' ? (
        <label className="number-row"><span>Diameter mm</span><input type="number" min="5" value={settings.diameterMm} onChange={(e) => patch({ diameterMm: Number(e.target.value) })} /></label>
      ) : (
        <>
          <label className="number-row"><span>Bottom mm</span><input type="number" min="5" value={settings.bottomDiameterMm} onChange={(e) => patch({ bottomDiameterMm: Number(e.target.value) })} /></label>
          <label className="number-row"><span>Belly mm</span><input type="number" min="5" value={settings.middleDiameterMm} onChange={(e) => patch({ middleDiameterMm: Number(e.target.value) })} /></label>
          <label className="number-row"><span>Top mm</span><input type="number" min="5" value={settings.topDiameterMm} onChange={(e) => patch({ topDiameterMm: Number(e.target.value) })} /></label>
        </>
      )}
      <label className="number-row"><span>Wall mm</span><input type="number" min="0" step="0.2" value={settings.wallThicknessMm} onChange={(e) => patch({ wallThicknessMm: Number(e.target.value) })} /></label>
      <label className="number-row"><span>Bottom mm</span><input type="number" min="0.2" step="0.2" value={settings.bottomThicknessMm} onChange={(e) => patch({ bottomThicknessMm: Number(e.target.value) })} /></label>
      <div className="preset-row">
        {Object.entries(presets).map(([name, values]) => (
          <button type="button" key={name} onClick={() => patch(values)}>{name}</button>
        ))}
      </div>
      <label className="number-row"><span>Radial</span><input type="number" min="8" max="768" value={settings.radialSegments} onChange={(e) => patch({ radialSegments: Number(e.target.value) })} /></label>
      <label className="number-row"><span>Height seg.</span><input type="number" min="2" max="768" value={settings.heightSegments} onChange={(e) => patch({ heightSegments: Number(e.target.value) })} /></label>
      <label className="check-row"><input type="checkbox" checked={settings.openTop} onChange={(e) => patch({ openTop: e.target.checked })} /> Open top with rim</label>
      <label className="check-row"><input type="checkbox" checked={settings.addBottom} onChange={(e) => patch({ addBottom: e.target.checked })} /> Add bottom</label>
      {settings.radialSegments * settings.heightSegments * 2 > 220000 ? <p className="warning">High triangle count may export slowly.</p> : null}
    </section>
  );
}
