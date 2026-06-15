import { clamp, type Rgba } from './colorUtils';
import type { ImageMappingSettings } from './geometry/meshTypes';

export type ImageCanvas = HTMLCanvasElement | OffscreenCanvas;

const fallbackPixel: Rgba = { r: 238, g: 238, b: 238, a: 255 };

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

export async function fileToCanvas(file: File): Promise<HTMLCanvasElement> {
  if (!file.type.match(/^image\/(png|jpe?g|webp)$/)) {
    throw new Error('Please choose a PNG, JPG, or WebP image.');
  }

  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    canvas.getContext('2d')?.drawImage(image, 0, 0);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function createProcessedCanvas(source: HTMLCanvasElement, blurPx: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return canvas;
  }
  ctx.filter = blurPx > 0 ? `blur(${blurPx}px)` : 'none';
  ctx.drawImage(source, 0, 0);
  ctx.filter = 'none';
  return canvas;
}

export function drawMappedImagePreview(source: HTMLCanvasElement | null, settings: ImageMappingSettings): HTMLCanvasElement | null {
  if (!source) {
    return null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 180;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return canvas;
  }
  const imageData = ctx.createImageData(canvas.width, canvas.height);
  const sampler = makeImageSampler(source, settings);
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const color = sampler(x / (canvas.width - 1), y / (canvas.height - 1));
      const offset = (y * canvas.width + x) * 4;
      imageData.data[offset] = color.r;
      imageData.data[offset + 1] = color.g;
      imageData.data[offset + 2] = color.b;
      imageData.data[offset + 3] = color.a ?? 255;
    }
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

export function makeImageSampler(canvas: ImageCanvas, settings: ImageMappingSettings): (u: number, v: number) => Rgba {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx || canvas.width < 1 || canvas.height < 1) {
    return () => fallbackPixel;
  }
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const imageAspect = canvas.width / canvas.height;

  return (u: number, v: number): Rgba => {
    let mappedU = settings.mirrorX ? 1 - u : u;
    let mappedV = settings.flipY ? 1 - v : v;
    mappedU = (mappedU - 0.5) / settings.scale + 0.5 + settings.offsetU;
    mappedV = (mappedV - 0.5) / settings.scale + 0.5 + settings.offsetV;

    if (settings.fitMode !== 'stretch') {
      const surfaceAspect = 1;
      const ratio = settings.fitMode === 'contain' ? Math.max(imageAspect / surfaceAspect, 1) : Math.min(imageAspect / surfaceAspect, 1);
      if (imageAspect >= surfaceAspect) {
        mappedU = (mappedU - 0.5) * ratio + 0.5;
      } else {
        mappedV = (mappedV - 0.5) / ratio + 0.5;
      }
    }

    mappedU = settings.repeatX ? positiveModulo(mappedU, 1) : clamp(mappedU, 0, 1);
    mappedV = settings.repeatY ? positiveModulo(mappedV, 1) : clamp(mappedV, 0, 1);

    const x = clamp(Math.round(mappedU * (canvas.width - 1)), 0, canvas.width - 1);
    const y = clamp(Math.round(mappedV * (canvas.height - 1)), 0, canvas.height - 1);
    const offset = (y * canvas.width + x) * 4;
    return { r: data[offset], g: data[offset + 1], b: data[offset + 2], a: data[offset + 3] };
  };
}
