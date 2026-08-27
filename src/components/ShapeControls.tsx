import type { ShapeSettings } from '../lib/geometry/meshTypes';

type Props = {
  settings: ShapeSettings;
  imageAspectRatio: number | null;
  onChange: (settings: ShapeSettings) => void;
};

const presets = {
  Draft: { radialSegments: 128, heightSegments: 128 },
  Normal: { radialSegments: 256, heightSegments: 256 },
  High: { radialSegments: 512, heightSegments: 384 },
};

function clampNumber(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function arcRadiusFor(heightMm: number, aspectRatio: number, arcAngleDeg: number): number {
  const angle = Math.max(5, Math.min(330, arcAngleDeg)) * (Math.PI / 180);
  return Math.max(5, (heightMm * aspectRatio) / angle);
}

function diameterFor(heightMm: number, aspectRatio: number): number {
  return Math.max(5, (heightMm * aspectRatio) / Math.PI);
}

export function ShapeControls({ settings, imageAspectRatio, onChange }: Props) {
  const aspectRatio = imageAspectRatio && imageAspectRatio > 0 ? imageAspectRatio : settings.widthMm / Math.max(1, settings.heightMm);
  const patch = (partial: Partial<ShapeSettings>) => onChange({ ...settings, ...partial });
  const fitPanelToImage = (type: 'plane' | 'arc') => {
    const heightMm = 110;
    const next: Partial<ShapeSettings> = { type, heightMm };
    if (type === 'plane') {
      next.widthMm = heightMm * aspectRatio;
    } else {
      next.diameterMm = arcRadiusFor(heightMm, aspectRatio, settings.arcAngleDeg) * 2;
    }
    patch(next);
  };
  const updatePanelHeight = (heightMm: number) => {
    if (!settings.scaleLocked) {
      patch({ heightMm });
      return;
    }
    if (settings.type === 'cylinder') {
      patch({ heightMm, diameterMm: diameterFor(heightMm, aspectRatio) });
    } else if (settings.type === 'vase') {
      const nextMiddle = diameterFor(heightMm, aspectRatio);
      const scale = nextMiddle / Math.max(0.001, settings.middleDiameterMm);
      patch({
        heightMm,
        bottomDiameterMm: settings.bottomDiameterMm * scale,
        middleDiameterMm: nextMiddle,
        topDiameterMm: settings.topDiameterMm * scale,
      });
    } else if (settings.type === 'plane') {
      patch({ heightMm, widthMm: heightMm * aspectRatio });
    } else if (settings.type === 'arc') {
      patch({ heightMm, diameterMm: arcRadiusFor(heightMm, aspectRatio, settings.arcAngleDeg) * 2 });
    } else {
      patch({ heightMm });
    }
  };
  const updatePlaneWidth = (widthMm: number) => {
    patch(settings.scaleLocked ? { widthMm, heightMm: widthMm / aspectRatio } : { widthMm });
  };
  const updateCylinderDiameter = (diameterMm: number) => {
    patch(settings.scaleLocked ? { diameterMm, heightMm: (diameterMm * Math.PI) / aspectRatio } : { diameterMm });
  };
  const updateVaseDiameter = (field: 'bottomDiameterMm' | 'middleDiameterMm' | 'topDiameterMm', diameterMm: number) => {
    if (!settings.scaleLocked) {
      patch({ [field]: diameterMm });
      return;
    }
    const scale = diameterMm / Math.max(0.001, settings[field]);
    const nextMiddle = field === 'middleDiameterMm' ? diameterMm : settings.middleDiameterMm * scale;
    patch({
      bottomDiameterMm: field === 'bottomDiameterMm' ? diameterMm : settings.bottomDiameterMm * scale,
      middleDiameterMm: nextMiddle,
      topDiameterMm: field === 'topDiameterMm' ? diameterMm : settings.topDiameterMm * scale,
      heightMm: (nextMiddle * Math.PI) / aspectRatio,
    });
  };
  const updateArcRadius = (radiusMm: number) => {
    const angle = Math.max(5, Math.min(330, settings.arcAngleDeg)) * (Math.PI / 180);
    patch(settings.scaleLocked ? { diameterMm: radiusMm * 2, heightMm: (radiusMm * angle) / aspectRatio } : { diameterMm: radiusMm * 2 });
  };
  const updateArcAngle = (arcAngleDeg: number) => {
    patch(settings.scaleLocked ? { arcAngleDeg, diameterMm: arcRadiusFor(settings.heightMm, aspectRatio, arcAngleDeg) * 2 } : { arcAngleDeg });
  };
  const updateScaleLocked = (scaleLocked: boolean) => {
    if (!scaleLocked) {
      patch({ scaleLocked });
    } else if (settings.type === 'cylinder') {
      patch({ scaleLocked, diameterMm: diameterFor(settings.heightMm, aspectRatio) });
    } else if (settings.type === 'vase') {
      const nextMiddle = diameterFor(settings.heightMm, aspectRatio);
      const scale = nextMiddle / Math.max(0.001, settings.middleDiameterMm);
      patch({
        scaleLocked,
        bottomDiameterMm: settings.bottomDiameterMm * scale,
        middleDiameterMm: nextMiddle,
        topDiameterMm: settings.topDiameterMm * scale,
      });
    } else if (settings.type === 'plane') {
      patch({ scaleLocked, widthMm: settings.heightMm * aspectRatio });
    } else if (settings.type === 'arc') {
      patch({ scaleLocked, diameterMm: arcRadiusFor(settings.heightMm, aspectRatio, settings.arcAngleDeg) * 2 });
    } else {
      patch({ scaleLocked });
    }
  };

  return (
    <section className="panel-section">
      <h2>Shape</h2>
      <div className="segmented">
        <button type="button" className={settings.type === 'cylinder' ? 'active' : ''} onClick={() => patch({ type: 'cylinder' })}>Cylinder</button>
        <button type="button" className={settings.type === 'vase' ? 'active' : ''} onClick={() => patch({ type: 'vase' })}>Vase</button>
        <button type="button" className={settings.type === 'plane' ? 'active' : ''} onClick={() => fitPanelToImage('plane')}>Plane</button>
        <button type="button" className={settings.type === 'arc' ? 'active' : ''} onClick={() => fitPanelToImage('arc')}>Arc</button>
      </div>
      <label className="number-row"><span>Height mm</span><input type="number" min="5" value={settings.heightMm} onChange={(e) => updatePanelHeight(clampNumber(Number(e.target.value), settings.heightMm))} /></label>
      {settings.type === 'cylinder' ? (
        <label className="number-row"><span>Diameter mm</span><input type="number" min="5" value={settings.diameterMm} onChange={(e) => updateCylinderDiameter(clampNumber(Number(e.target.value), settings.diameterMm))} /></label>
      ) : settings.type === 'vase' ? (
        <>
          <label className="number-row"><span>Bottom mm</span><input type="number" min="5" value={settings.bottomDiameterMm} onChange={(e) => updateVaseDiameter('bottomDiameterMm', clampNumber(Number(e.target.value), settings.bottomDiameterMm))} /></label>
          <label className="number-row"><span>Belly mm</span><input type="number" min="5" value={settings.middleDiameterMm} onChange={(e) => updateVaseDiameter('middleDiameterMm', clampNumber(Number(e.target.value), settings.middleDiameterMm))} /></label>
          <label className="number-row"><span>Top mm</span><input type="number" min="5" value={settings.topDiameterMm} onChange={(e) => updateVaseDiameter('topDiameterMm', clampNumber(Number(e.target.value), settings.topDiameterMm))} /></label>
        </>
      ) : settings.type === 'arc' ? (
        <>
          <label className="number-row"><span>Radius mm</span><input type="number" min="5" value={settings.diameterMm / 2} onChange={(e) => updateArcRadius(clampNumber(Number(e.target.value), settings.diameterMm / 2))} /></label>
          <label className="number-row"><span>Arc deg.</span><input type="number" min="5" max="330" value={settings.arcAngleDeg} onChange={(e) => updateArcAngle(clampNumber(Number(e.target.value), settings.arcAngleDeg))} /></label>
        </>
      ) : (
        <label className="number-row"><span>Width mm</span><input type="number" min="5" value={settings.widthMm} onChange={(e) => updatePlaneWidth(clampNumber(Number(e.target.value), settings.widthMm))} /></label>
      )}
      <label className="check-row"><input type="checkbox" checked={settings.scaleLocked} onChange={(e) => updateScaleLocked(e.target.checked)} /> Scaling lock</label>
      <label className="number-row"><span>Wall mm</span><input type="number" min="0" step="0.2" value={settings.wallThicknessMm} onChange={(e) => patch({ wallThicknessMm: Number(e.target.value) })} /></label>
      {settings.type === 'cylinder' || settings.type === 'vase' ? (
        <label className="number-row"><span>Bottom mm</span><input type="number" min="0.2" step="0.2" value={settings.bottomThicknessMm} onChange={(e) => patch({ bottomThicknessMm: Number(e.target.value) })} /></label>
      ) : null}
      <div className="resolution-section">
        <h3>Image Mapping Resolution</h3>
        <p>Higher resolution means better quality, but also slower export and slicing</p>
        <div className="preset-row">
          {Object.entries(presets).map(([name, values]) => {
            const isActive = settings.radialSegments === values.radialSegments && settings.heightSegments === values.heightSegments;
            return <button type="button" className={isActive ? 'active' : ''} key={name} onClick={() => patch(values)}>{name}</button>;
          })}
        </div>
      </div>
      <label className="number-row"><span>{settings.type === 'plane' || settings.type === 'arc' ? 'Width seg.' : 'Radial'}</span><input type="number" min={settings.type === 'plane' || settings.type === 'arc' ? '1' : '8'} max="768" value={settings.radialSegments} onChange={(e) => patch({ radialSegments: Number(e.target.value) })} /></label>
      <label className="number-row"><span>Height seg.</span><input type="number" min="2" max="768" value={settings.heightSegments} onChange={(e) => patch({ heightSegments: Number(e.target.value) })} /></label>
      {settings.type === 'cylinder' || settings.type === 'vase' ? (
        <>
          <label className="check-row"><input type="checkbox" checked={settings.openTop} onChange={(e) => patch({ openTop: e.target.checked })} /> Open top with rim</label>
          <label className="check-row"><input type="checkbox" checked={settings.addBottom} onChange={(e) => patch({ addBottom: e.target.checked })} /> Add bottom</label>
        </>
      ) : null}
      {settings.radialSegments * settings.heightSegments * 2 > 220000 ? <p className="warning">High triangle count may export slowly.</p> : null}
    </section>
  );
}
