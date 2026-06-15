import { colorDistanceSq, hexToRgb, makePaletteColor, rgbToHex, type PaletteColor } from './colorUtils';

type RGB = { r: number; g: number; b: number };
type LAB = { L: number; a: number; b: number };
type FilamentPart = { hex: string; ratio: number };

const DEFAULT_CMYWK = ['#009bc3', '#c9378c', '#f6b921', '#252e2e', '#e4e4e5'];
const PAIR_RATIOS = [0.25, 0.5, 0.75];

function srgbToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(c: number): number {
  const x = Math.max(0, Math.min(1, c));
  const v = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
  return v * 255;
}

function rgbToXyz(rgb: RGB): { x: number; y: number; z: number } {
  const r = srgbToLinear(rgb.r);
  const g = srgbToLinear(rgb.g);
  const b = srgbToLinear(rgb.b);
  return {
    x: r * 0.4124564 + g * 0.3575761 + b * 0.1804375,
    y: r * 0.2126729 + g * 0.7151522 + b * 0.072175,
    z: r * 0.0193339 + g * 0.119192 + b * 0.9503041,
  };
}

function xyzToLab(x: number, y: number, z: number): LAB {
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x / 0.95047);
  const fy = f(y);
  const fz = f(z / 1.08883);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

function labToXyz(lab: LAB): { x: number; y: number; z: number } {
  const fy = (lab.L + 16) / 116;
  const fx = lab.a / 500 + fy;
  const fz = fy - lab.b / 200;
  const finv = (t: number) => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787);
  return { x: 0.95047 * finv(fx), y: finv(fy), z: 1.08883 * finv(fz) };
}

function xyzToRgb(x: number, y: number, z: number): RGB {
  return {
    r: linearToSrgb(x * 3.2404542 + y * -1.5371385 + z * -0.4985314),
    g: linearToSrgb(x * -0.969266 + y * 1.8760108 + z * 0.041556),
    b: linearToSrgb(x * 0.0556434 + y * -0.2040259 + z * 1.0572252),
  };
}

function hexToLab(hex: string): LAB {
  const xyz = rgbToXyz(hexToRgb(hex));
  return xyzToLab(xyz.x, xyz.y, xyz.z);
}

function labToHex(lab: LAB): string {
  const xyz = labToXyz(lab);
  return rgbToHex(xyzToRgb(xyz.x, xyz.y, xyz.z));
}

function yuleNielsenMix(parts: FilamentPart[], n = 3): RGB {
  let r = 0;
  let g = 0;
  let b = 0;
  parts.forEach((part) => {
    const rgb = hexToRgb(part.hex);
    r += srgbToLinear(rgb.r) ** (1 / n) * part.ratio;
    g += srgbToLinear(rgb.g) ** (1 / n) * part.ratio;
    b += srgbToLinear(rgb.b) ** (1 / n) * part.ratio;
  });
  return { r: linearToSrgb(Math.max(0, r) ** n), g: linearToSrgb(Math.max(0, g) ** n), b: linearToSrgb(Math.max(0, b) ** n) };
}

export function mixFilaments(parts: FilamentPart[]): { hex: string; lab: LAB; rgb: RGB } {
  const total = parts.reduce((sum, part) => sum + part.ratio, 0);
  const normalized = parts.map((part) => ({ ...part, ratio: part.ratio / total }));
  const pure = normalized.find((part) => part.ratio >= 0.9999);
  if (pure) {
    return { hex: rgbToHex(hexToRgb(pure.hex)), lab: hexToLab(pure.hex), rgb: hexToRgb(pure.hex) };
  }

  const baseRgb = yuleNielsenMix(normalized, 3);
  const baseLab = hexToLab(rgbToHex(baseRgb));
  const lightnesses = normalized.map((part) => hexToLab(part.hex).L);
  const lGap = Math.max(...lightnesses) - Math.min(...lightnesses);
  const n = normalized.length;
  const ratioProduct = normalized.reduce((product, part) => product * part.ratio, 1);
  const weight = Math.max(0, Math.min(1, n ** n * ratioProduct)) * 1.375;
  let dL = -0.0477 * lGap - 2.112;
  if (lGap > 15) {
    dL += -0.06 * (lGap - 15);
  }
  const newL = baseLab.L + dL * weight;
  const baseC = Math.hypot(baseLab.a, baseLab.b);
  let a = baseLab.a;
  let b = baseLab.b;
  if (baseC >= 0.01) {
    const newC = Math.max(0, baseC + (0.278 * newL - 15.58) * weight);
    const scale = newC / baseC;
    a *= scale;
    b *= scale;
  }
  const chroma = Math.hypot(a, b);
  if (chroma >= 1) {
    const hue = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
    const distance = Math.abs(hue - 210);
    if (distance < 30) {
      const hueRad = (((hue + 10.38 * (1 - distance / 30) * weight) % 360) * Math.PI) / 180;
      a = chroma * Math.cos(hueRad);
      b = chroma * Math.sin(hueRad);
    }
  }
  const lab = { L: newL, a, b };
  const hex = labToHex(lab);
  return { hex, lab, rgb: hexToRgb(hex) };
}

export function defaultColorMixFilaments(): PaletteColor[] {
  return DEFAULT_CMYWK.map((hex, index) => makePaletteColor(hex, index, ['Cyan', 'Magenta', 'Yellow', 'Black', 'White'][index]));
}

export function buildColorMixPalette(filaments: PaletteColor[]): PaletteColor[] {
  const materials: PaletteColor[] = filaments.map((filament, index) => ({ ...filament, name: filament.name || `Filament ${index + 1}`, components: [{ extruder: index + 1, ratio: 1 }] }));
  for (let i = 0; i < filaments.length; i += 1) {
    for (let j = i + 1; j < filaments.length; j += 1) {
      PAIR_RATIOS.forEach((secondRatio) => {
        const firstRatio = 1 - secondRatio;
        const mix = mixFilaments([
          { hex: filaments[i].hex, ratio: firstRatio },
          { hex: filaments[j].hex, ratio: secondRatio },
        ]);
        materials.push({
          ...makePaletteColor(mix.hex, materials.length, `${i + 1}:${j + 1} ${Math.round(firstRatio * 100)}/${Math.round(secondRatio * 100)}`),
          components: [
            { extruder: i + 1, ratio: firstRatio },
            { extruder: j + 1, ratio: secondRatio },
          ],
        });
      });
    }
  }
  for (let i = 0; i < filaments.length; i += 1) {
    for (let j = i + 1; j < filaments.length; j += 1) {
      for (let k = j + 1; k < filaments.length; k += 1) {
        [i, j, k].forEach((dominant) => {
          const parts = [i, j, k].map((filamentIndex) => ({
            hex: filaments[filamentIndex].hex,
            ratio: filamentIndex === dominant ? 0.5 : 0.25,
          }));
          const mix = mixFilaments(parts);
          materials.push({
            ...makePaletteColor(mix.hex, materials.length, `${i + 1}:${j + 1}:${k + 1} ${dominant + 1} dominant`),
            components: [i, j, k].map((filamentIndex) => ({
              extruder: filamentIndex + 1,
              ratio: filamentIndex === dominant ? 0.5 : 0.25,
            })),
          });
        });
      }
    }
  }
  const pure = materials.slice(0, filaments.length);
  const mixes = materials.slice(filaments.length).sort((a, b) => colorDistanceSq({ r: 255, g: 255, b: 255 }, a) - colorDistanceSq({ r: 255, g: 255, b: 255 }, b));
  return [...pure, ...mixes];
}
