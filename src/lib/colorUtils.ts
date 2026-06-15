export type Rgba = { r: number; g: number; b: number; a?: number };

export type PaletteColor = {
  id: string;
  name: string;
  r: number;
  g: number;
  b: number;
  hex: string;
};

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function rgbToHex({ r, g, b }: Rgba): string {
  return `#${[r, g, b].map((channel) => clamp(Math.round(channel), 0, 255).toString(16).padStart(2, '0')).join('')}`;
}

export function hexToRgb(hex: string): Rgba {
  const normalized = hex.replace('#', '').padEnd(6, '0').slice(0, 6);
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
    a: 255,
  };
}

export function makePaletteColor(hex: string, index: number, name = `Material ${index + 1}`): PaletteColor {
  const rgb = hexToRgb(hex);
  return { id: `mat-${index}-${hex.replace('#', '')}`, name, r: rgb.r, g: rgb.g, b: rgb.b, hex: rgbToHex(rgb) };
}

export function colorDistanceSq(a: Rgba, b: Rgba): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return dr * dr + dg * dg + db * db;
}

export function nearestPaletteIndex(color: Rgba, palette: PaletteColor[]): number {
  let nearest = 0;
  let best = Number.POSITIVE_INFINITY;
  palette.forEach((entry, index) => {
    const distance = colorDistanceSq(color, entry);
    if (distance < best) {
      best = distance;
      nearest = index;
    }
  });
  return nearest;
}

export function brightness(color: Rgba): number {
  return (color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722) / 255;
}
