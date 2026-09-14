import { useMemo } from 'react';
import { Vector3 } from 'three';
import { meshBounds, transformModel, type CustomSettings } from '../lib/geometry/customModel';
import type { MeshData } from '../lib/geometry/meshTypes';

type Props = {
  model: MeshData | null; settings: CustomSettings; loading: boolean; error: string | null;
  onLoad: (file: File) => void; onChange: (settings: CustomSettings) => void;
};

export function CustomModelControls({ model, settings, loading, error, onLoad, onChange }: Props) {
  const size = useMemo(() => model ? meshBounds(transformModel(model, settings)).getSize(new Vector3()) : null, [model, settings.scale, settings.rotation]);
  const patch = (value: Partial<CustomSettings>) => onChange({ ...settings, ...value });
  const setScale = (scale: number) => { if (Number.isFinite(scale) && scale > 0) patch({ scale: Math.max(0.0001, Math.min(10000, scale)) }); };
  return <div className="custom-model-controls">
    <label className="file-button">
      <input aria-label="Load custom model" type="file" accept=".stl,.3mf,.obj" disabled={loading} onChange={event => {
        const file = event.target.files?.[0]; if (file) onLoad(file); event.target.value = '';
      }} />
      {loading ? 'Loading model…' : model ? 'Replace model…' : 'Load STL / 3MF / OBJ…'}
    </label>
    {error && <p className="warning" role="alert">{error}</p>}
    {!model ? <p className="helper-copy">Drop a model here or choose a file. Then add an image and place it in the preview.</p> : <>
      <p className="model-name">{model.name} <small>{model.triangles.length.toLocaleString()} source triangles</small></p>
      <label className="number-row"><span>Scale %</span><input type="number" min="0.01" step="5" value={Number((settings.scale * 100).toFixed(3))} onChange={e => setScale(Number(e.target.value) / 100)} /></label>
      {size && (['x', 'y', 'z'] as const).map((axis, i) => <label className="number-row" key={axis}>
        <span>{['Width', 'Height', 'Depth'][i]} mm</span><input type="number" min="0.01" step="1" value={Number(size[axis].toFixed(2))} disabled={size[axis] < 0.00001} onChange={e => setScale(settings.scale * Number(e.target.value) / size[axis])} />
      </label>)}
      <p className="helper-copy">Dimensions scale together. STL and OBJ assume millimeters and Z up; use rotation to correct orientation.</p>
      <div className="preset-row">{(['X', 'Y', 'Z'] as const).map((axis, i) => <button type="button" key={axis} onClick={() => {
        const rotation = [...settings.rotation] as CustomSettings['rotation']; rotation[i] = (rotation[i] + 90) % 360; patch({ rotation });
      }}>Rotate {axis} 90°</button>)}</div>
      <button type="button" onClick={() => patch({ scale: 1, rotation: [0, 0, 0] })}>Original size & orientation</button>
      <label className="field"><span>Image placement</span><select value={settings.projection} onChange={e => patch({ projection: e.target.value as CustomSettings['projection'] })}>
        <option value="planar">Place image from a view</option><option value="cylindrical">Wrap around vertical axis</option>
      </select></label>
      {settings.projection === 'planar' ? <>
        <label className="check-row"><input type="checkbox" checked={settings.visibleOnly} onChange={e => patch({ visibleOnly: e.target.checked })} /> Visible surfaces only</label>
        <label className="slider-row"><span>Image angle</span><input type="range" min="-180" max="180" value={settings.imageRotation} onChange={e => patch({ imageRotation: Number(e.target.value) })} /><output>{settings.imageRotation}°</output></label>
        <p className="helper-copy">Orbit to the desired side, then use “Project from view”. Enable “Move image” to drag its position. Hidden and steep surfaces keep the unpainted color.</p>
      </> : <p className="helper-copy">Wrap follows the model’s vertical axis. Use Image → Offset X to move the seam and Repeat horizontally for a continuous wrap.</p>}
      <label className="field"><span>Image detail</span><select value={settings.detail} onChange={e => patch({ detail: e.target.value as CustomSettings['detail'] })}>
        <option value="standard">Standard</option><option value="fine">Fine</option>
      </select></label>
      <p className="helper-copy">The preview shows the export colors. Imported paint and print settings are replaced by this project’s palette. Relief is available for simple shapes.</p>
    </>}
  </div>;
}
