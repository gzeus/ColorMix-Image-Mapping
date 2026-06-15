import { colorDistanceSq, makePaletteColor, rgbToHex, type PaletteColor, type Rgba } from './colorUtils';

function averageColor(colors: Rgba[]): Rgba {
  const sum = colors.reduce((acc, color) => {
    acc.r += color.r;
    acc.g += color.g;
    acc.b += color.b;
    return acc;
  }, { r: 0, g: 0, b: 0 });
  return { r: sum.r / colors.length, g: sum.g / colors.length, b: sum.b / colors.length, a: 255 };
}

function channelRange(colors: Rgba[], channel: 'r' | 'g' | 'b'): number {
  let min = 255;
  let max = 0;
  colors.forEach((color) => {
    min = Math.min(min, color[channel]);
    max = Math.max(max, color[channel]);
  });
  return max - min;
}

export function quantizeCanvas(canvas: HTMLCanvasElement, colorCount: number): PaletteColor[] {
  const size = Math.min(256, Math.max(canvas.width, canvas.height));
  const scale = size / Math.max(canvas.width, canvas.height);
  const sampleCanvas = document.createElement('canvas');
  sampleCanvas.width = Math.max(1, Math.round(canvas.width * scale));
  sampleCanvas.height = Math.max(1, Math.round(canvas.height * scale));
  const ctx = sampleCanvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return [makePaletteColor('#e8e2d5', 0), makePaletteColor('#20242a', 1)];
  }
  ctx.drawImage(canvas, 0, 0, sampleCanvas.width, sampleCanvas.height);
  const data = ctx.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height).data;
  const pixels: Rgba[] = [];
  for (let index = 0; index < data.length; index += 16) {
    if (data[index + 3] > 24) {
      pixels.push({ r: data[index], g: data[index + 1], b: data[index + 2], a: data[index + 3] });
    }
  }
  if (pixels.length === 0) {
    return [makePaletteColor('#e8e2d5', 0), makePaletteColor('#20242a', 1)];
  }

  let buckets: Rgba[][] = [pixels];
  while (buckets.length < colorCount) {
    buckets.sort((a, b) => b.length - a.length);
    const bucket = buckets.shift();
    if (!bucket || bucket.length <= 1) {
      break;
    }
    const ranges = { r: channelRange(bucket, 'r'), g: channelRange(bucket, 'g'), b: channelRange(bucket, 'b') };
    const channel = Object.entries(ranges).sort((a, b) => b[1] - a[1])[0][0] as 'r' | 'g' | 'b';
    bucket.sort((a, b) => a[channel] - b[channel]);
    const midpoint = Math.floor(bucket.length / 2);
    buckets.push(bucket.slice(0, midpoint), bucket.slice(midpoint));
  }

  let centroids = buckets.map(averageColor);
  for (let iteration = 0; iteration < 6; iteration += 1) {
    const groups = centroids.map((): Rgba[] => []);
    pixels.forEach((pixel) => {
      let nearest = 0;
      let best = Number.POSITIVE_INFINITY;
      centroids.forEach((centroid, index) => {
        const distance = colorDistanceSq(pixel, centroid);
        if (distance < best) {
          best = distance;
          nearest = index;
        }
      });
      groups[nearest].push(pixel);
    });
    centroids = centroids.map((centroid, index) => (groups[index].length > 0 ? averageColor(groups[index]) : centroid));
  }

  return centroids
    .slice(0, colorCount)
    .map((color, index) => makePaletteColor(rgbToHex(color), index))
    .sort((a, b) => (b.r + b.g + b.b) - (a.r + a.g + a.b));
}
