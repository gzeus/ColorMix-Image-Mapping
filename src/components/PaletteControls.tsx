import type { PaletteColor } from '../lib/colorUtils';
import { makePaletteColor } from '../lib/colorUtils';

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
    next[index] = makePaletteColor(hex, index, next[index]?.name ?? `Material ${index + 1}`);
    onPaletteChange(next);
  };
  const updateColorMixFilament = (index: number, hex: string) => {
    const next = [...colorMixFilaments];
    next[index] = makePaletteColor(hex, index, next[index]?.name ?? `Filament ${index + 1}`);
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
  const activePalette = colorMixEnabled ? colorMixPalette : palette;

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
          <div className="mix-grid">
            {colorMixPalette.map((color, index) => (
              <div className="mix-chip" key={`${color.id}-${index}`}>
                <span style={{ background: color.hex }} />
                <small>{index + 1}</small>
              </div>
            ))}
          </div>
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
        <select value={Math.min(insideMaterialIndex, activePalette.length - 1)} onChange={(event) => onInsideMaterialChange(Number(event.target.value))}>
          {activePalette.map((color, index) => (
            <option key={color.id} value={index}>
              {index + 1} - {color.hex.toUpperCase()}
            </option>
          ))}
        </select>
      </label>
    </section>
  );
}
