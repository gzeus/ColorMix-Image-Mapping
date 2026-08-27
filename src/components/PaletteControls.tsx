import type { PaletteColor } from '../lib/colorUtils';
import { makePaletteColor } from '../lib/colorUtils';

type ColorSelectProps = {
  colors: PaletteColor[];
  value: number;
  onChange: (index: number) => void;
};

function ColorSelect({ colors, value, onChange }: ColorSelectProps) {
  const safeValue = Math.max(0, Math.min(colors.length - 1, value));
  const selected = colors[safeValue] ?? colors[0];

  return (
    <div className="color-select">
      <span className="color-select-preview" style={{ background: selected?.hex ?? '#ffffff' }} />
      <select value={safeValue} onChange={(event) => onChange(Number(event.target.value))}>
        {colors.map((color, index) => (
          <option key={color.id} value={index}>
            {index + 1} - {color.name || `Filament ${index + 1}`}
          </option>
        ))}
      </select>
    </div>
  );
}

type Props = {
  colorCount: number;
  lockManualPalette: boolean;
  palette: PaletteColor[];
  colorMixEnabled: boolean;
  colorMixFilaments: PaletteColor[];
  colorMixPalette: PaletteColor[];
  insideMaterialIndex: number;
  onColorCountChange: (count: number) => void;
  onLockManualPaletteChange: (enabled: boolean) => void;
  onPaletteChange: (palette: PaletteColor[]) => void;
  onColorMixEnabledChange: (enabled: boolean) => void;
  onColorMixFilamentsChange: (palette: PaletteColor[]) => void;
  onInsideMaterialChange: (index: number) => void;
};

export function PaletteControls({
  colorCount,
  lockManualPalette,
  palette,
  colorMixEnabled,
  colorMixFilaments,
  colorMixPalette,
  insideMaterialIndex,
  onColorCountChange,
  onLockManualPaletteChange,
  onPaletteChange,
  onColorMixEnabledChange,
  onColorMixFilamentsChange,
  onInsideMaterialChange,
}: Props) {
  const updateColor = (index: number, hex: string) => {
    const next = [...palette];
    const updated = makePaletteColor(hex, index, next[index]?.name ?? `Material ${index + 1}`);
    // Keep the React key stable while the native color dialog emits live updates.
    next[index] = { ...updated, id: next[index]?.id ?? updated.id };
    onPaletteChange(next);
  };
  const updateColorMixFilament = (index: number, hex: string) => {
    const next = [...colorMixFilaments];
    const updated = makePaletteColor(hex, index, next[index]?.name ?? `Filament ${index + 1}`);
    // Changing a color must not recreate the input, or the browser closes its picker.
    next[index] = { ...updated, id: next[index]?.id ?? updated.id };
    onColorMixFilamentsChange(next);
  };
  const addColorMixFilament = () => {
    if (colorMixFilaments.length >= 8) {
      return;
    }
    onColorMixFilamentsChange([...colorMixFilaments, makePaletteColor('#dddddd', colorMixFilaments.length, `Filament ${colorMixFilaments.length + 1}`)]);
  };
  const removeColorMixFilament = (index: number) => {
    if (colorMixFilaments.length <= 2) {
      return;
    }
    onColorMixFilamentsChange(colorMixFilaments.filter((_, currentIndex) => currentIndex !== index).map((color, currentIndex) => ({ ...color, name: color.name || `Filament ${currentIndex + 1}` })));
    onInsideMaterialChange(0);
  };
  const insideMaterialOptions = colorMixEnabled ? colorMixFilaments : palette;

  return (
    <section className="panel-section">
      <h2>Color / MMU</h2>
      <label className="check-row"><input type="checkbox" checked={colorMixEnabled} onChange={(event) => onColorMixEnabledChange(event.target.checked)} /> Enable ColorMix</label>
      {colorMixEnabled ? (
        <>
          <div className="palette-grid">
            {colorMixFilaments.map((color, index) => (
              <label className="swatch-field" key={`${color.id}-${index}`}>
                <input type="color" value={color.hex} onChange={(event) => updateColorMixFilament(index, event.target.value)} />
                <span>{color.name.slice(0, 1) || index + 1}</span>
                <button type="button" title="Remove filament" disabled={colorMixFilaments.length <= 2} onClick={() => removeColorMixFilament(index)}>x</button>
              </label>
            ))}
          </div>
          <button type="button" onClick={addColorMixFilament} disabled={colorMixFilaments.length >= 8}>Add ColorMix filament</button>
          <p className="helper-copy">PrusaSlicer sliced preview may show physical source filament paths; the generated swatches are predicted blend colors.</p>
          <details className="virtual-extruders">
            <summary>Display Virtual Extruders</summary>
            <div className="mix-grid">
              {colorMixPalette.slice(colorMixFilaments.length).map((color, offset) => {
                const index = offset + colorMixFilaments.length;
                return (
                  <div className="mix-chip" key={`${color.id}-${index}`}>
                    <span style={{ background: color.hex }} />
                    <small>{index + 1}</small>
                  </div>
                );
              })}
            </div>
          </details>
        </>
      ) : (
        <>
          <label className="field">
            <span>Target colors</span>
            <select value={colorCount} onChange={(event) => onColorCountChange(Number(event.target.value))}>
              {[2, 3, 4, 5, 8, 16].map((count) => <option key={count} value={count}>{count}</option>)}
            </select>
          </label>
          <label className="check-row"><input type="checkbox" checked={lockManualPalette} onChange={(event) => onLockManualPaletteChange(event.target.checked)} /> Lock manual filament palette</label>
          <div className="palette-grid">
            {palette.map((color, index) => (
              <label className="swatch-field" key={`${color.id}-${index}`}>
                <input type="color" value={color.hex} onChange={(event) => updateColor(index, event.target.value)} />
                <span>{index + 1}</span>
              </label>
            ))}
          </div>
        </>
      )}
      <label className="field">
        <span>Inside / unpainted</span>
        <ColorSelect colors={insideMaterialOptions} value={insideMaterialIndex} onChange={onInsideMaterialChange} />
      </label>
    </section>
  );
}
