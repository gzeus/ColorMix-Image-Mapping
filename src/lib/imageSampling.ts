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

export function drawMappedImagePreview(source: HTMLCanvasElement | null, settings: ImageMappingSettings, padColor: Rgba = fallbackPixel, surfaceAspect?: number): HTMLCanvasElement | null {
  if (!source) {
    return null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = surfaceAspect ? Math.max(32, Math.min(640, Math.round(320 / surfaceAspect))) : 180;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return canvas;
  }
  const imageData = ctx.createImageData(canvas.width, canvas.height);
  const sampler = makeImageSampler(source, settings, padColor, surfaceAspect);
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const color = sampler(x / (canvas.width - 1), 1 - y / (canvas.height - 1));
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

export function makeImageSampler(canvas: ImageCanvas, settings: ImageMappingSettings, padColor: Rgba = fallbackPixel, surfaceAspect?: number): (u: number, v: number) => Rgba {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx || canvas.width < 1 || canvas.height < 1) {
    return () => fallbackPixel;
  }
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  return makePixelSampler({ data, width: canvas.width, height: canvas.height }, settings, padColor, surfaceAspect);
}

export type ImagePixels = { data: Uint8ClampedArray; width: number; height: number };

export function makeImageCoordinateMapper(imageAspect: number, settings: ImageMappingSettings, surfaceAspect?: number) {

  return (u: number, v: number) => {
    let mappedU = settings.mirrorX ? 1 - u : u;
    let mappedV = settings.flipY ? v : 1 - v;
    mappedU = (mappedU - 0.5) / settings.scale + 0.5 + settings.offsetU;
    mappedV = (mappedV - 0.5) / settings.scale + 0.5 + settings.offsetV;

    if (surfaceAspect !== undefined && settings.fitMode !== 'stretch') {
      const ratio = imageAspect / surfaceAspect;
      if (settings.fitMode === 'contain') {
        if (ratio > 1) mappedV = (mappedV - 0.5) * ratio + 0.5;
        else mappedU = (mappedU - 0.5) / ratio + 0.5;
      } else {
        if (ratio > 1) mappedU = (mappedU - 0.5) / ratio + 0.5;
        else mappedV = (mappedV - 0.5) * ratio + 0.5;
      }
    } else if (settings.fitMode !== 'stretch') {
      const surfaceAspect = 1;
      const ratio = settings.fitMode === 'contain' ? Math.max(imageAspect / surfaceAspect, 1) : Math.min(imageAspect / surfaceAspect, 1);
      if (imageAspect >= surfaceAspect) {
        mappedU = (mappedU - 0.5) * ratio + 0.5;
      } else {
        mappedV = (mappedV - 0.5) / ratio + 0.5;
      }
    }

    return { u: mappedU, v: mappedV };
  };
}

export function makePixelSampler(canvas: ImagePixels, settings: ImageMappingSettings, padColor: Rgba = fallbackPixel, surfaceAspect?: number): (u: number, v: number) => Rgba {
  const data = canvas.data;
  const coordinates = makeImageCoordinateMapper(canvas.width / canvas.height, settings, surfaceAspect);
  return (u: number, v: number): Rgba => {
    const mapped = coordinates(u, v);
    let mappedU = mapped.u, mappedV = mapped.v;
    if (settings.repeatX) {
      mappedU = positiveModulo(mappedU, 1);
    } else if (mappedU < 0 || mappedU > 1) {
      return padColor;
    }

    if (settings.repeatY) {
      mappedV = positiveModulo(mappedV, 1);
    } else if (mappedV < 0 || mappedV > 1) {
      return padColor;
    }

    const x = clamp(Math.round(mappedU * (canvas.width - 1)), 0, canvas.width - 1);
    const y = clamp(Math.round(mappedV * (canvas.height - 1)), 0, canvas.height - 1);
    const offset = (y * canvas.width + x) * 4;
    return { r: data[offset], g: data[offset + 1], b: data[offset + 2], a: data[offset + 3] };
  };
}
