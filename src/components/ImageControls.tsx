import type { ChangeEvent } from 'react';
import type { ImageMappingSettings } from '../lib/geometry/meshTypes';

type Props = {
  imageUrl: string | null;
  mapping: ImageMappingSettings;
  mappedPreviewUrl: string | null;
  onImageChange: (file: File) => void;
  onMappingChange: (settings: ImageMappingSettings) => void;
};

export function ImageControls({ imageUrl, mapping, mappedPreviewUrl, onImageChange, onMappingChange }: Props) {
  const patch = (partial: Partial<ImageMappingSettings>) => onMappingChange({ ...mapping, ...partial });
  const handleFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      onImageChange(file);
    }
    event.target.value = '';
  };

  return (
    <section className="panel-section">
      <div className="section-title">
        <h2>Image</h2>
        <label className="file-button">
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleFile} />
          Choose
        </label>
      </div>
      <div className="image-strip">
        {imageUrl ? <img src={imageUrl} alt="Uploaded source" /> : <div className="empty-preview">No image</div>}
        {mappedPreviewUrl ? <img src={mappedPreviewUrl} alt="Mapped preview" /> : <div className="empty-preview">Mapping</div>}
      </div>
      <label className="field">
        <span>Fit</span>
        <select value={mapping.fitMode} onChange={(event) => patch({ fitMode: event.target.value as ImageMappingSettings['fitMode'] })}>
          <option value="stretch">Stretch</option>
          <option value="contain">Contain</option>
          <option value="cover">Cover</option>
        </select>
      </label>
      <label className="slider-row">
        <span>Scale</span>
        <input type="range" min="0.25" max="3" step="0.01" value={mapping.scale} onChange={(event) => patch({ scale: Number(event.target.value) })} />
        <output>{mapping.scale.toFixed(2)}</output>
      </label>
      <label className="slider-row">
        <span>Offset X</span>
        <input type="range" min="-1" max="1" step="0.01" value={mapping.offsetU} onChange={(event) => patch({ offsetU: Number(event.target.value) })} />
        <output>{mapping.offsetU.toFixed(2)}</output>
      </label>
      <label className="slider-row">
        <span>Offset Y</span>
        <input type="range" min="-1" max="1" step="0.01" value={mapping.offsetV} onChange={(event) => patch({ offsetV: Number(event.target.value) })} />
        <output>{mapping.offsetV.toFixed(2)}</output>
      </label>
      <label className="check-row"><input type="checkbox" checked={mapping.mirrorX} onChange={(event) => patch({ mirrorX: event.target.checked })} /> Mirror horizontally</label>
      <label className="check-row"><input type="checkbox" checked={mapping.flipY} onChange={(event) => patch({ flipY: event.target.checked })} /> Flip vertically</label>
      <label className="check-row"><input type="checkbox" checked={mapping.repeatX} onChange={(event) => patch({ repeatX: event.target.checked })} /> Repeat horizontally</label>
    </section>
  );
}
