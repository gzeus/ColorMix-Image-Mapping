import type { PaletteColor } from '../lib/colorUtils';
import { makePaletteColor } from '../lib/colorUtils';

type Props = {
  colorCount: number;
  useFilamentPalette: boolean;
  palette: PaletteColor[];
  onColorCountChange: (count: number) => void;
  onUseFilamentPaletteChange: (enabled: boolean) => void;
  onPaletteChange: (palette: PaletteColor[]) => void;
};

export function PaletteControls({ colorCount, useFilamentPalette, palette, onColorCountChange, onUseFilamentPaletteChange, onPaletteChange }: Props) {
  const updateColor = (index: number, hex: string) => {
    const next = [...palette];
    next[index] = makePaletteColor(hex, index, next[index]?.name ?? `Material ${index + 1}`);
    onPaletteChange(next);
  };
  return (
    <section className="panel-section">
      <h2>Color / MMU</h2>
      <label className="field">
        <span>Target colors</span>
        <select value={colorCount} onChange={(event) => onColorCountChange(Number(event.target.value))}>
          {[2, 3, 4, 5, 8, 16].map((count) => <option key={count} value={count}>{count}</option>)}
        </select>
      </label>
      <label className="check-row"><input type="checkbox" checked={useFilamentPalette} onChange={(event) => onUseFilamentPaletteChange(event.target.checked)} /> Use actual filament palette</label>
      <div className="palette-grid">
        {palette.map((color, index) => (
          <label className="swatch-field" key={`${color.id}-${index}`}>
            <input type="color" value={color.hex} onChange={(event) => updateColor(index, event.target.value)} />
            <span>{index + 1}</span>
          </label>
        ))}
      </div>
    </section>
  );
}
