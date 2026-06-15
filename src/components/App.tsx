import { useCallback, useEffect, useMemo, useState } from 'react';
import { ExportPanel } from './ExportPanel';
import { ImageControls } from './ImageControls';
import { PaletteControls } from './PaletteControls';
import { Preview3D } from './Preview3D';
import { ReliefControls } from './ReliefControls';
import { ShapeControls } from './ShapeControls';
import { buildColorMixPalette, defaultColorMixFilaments } from '../lib/colorMix';
import { makePaletteColor, type PaletteColor } from '../lib/colorUtils';
import { export3mf } from '../lib/export/export3mf';
import { generateCylinder } from '../lib/geometry/generateCylinder';
import { generateVase } from '../lib/geometry/generateVase';
import type { ImageMappingSettings, MeshData, ReliefSettings, ShapeSettings } from '../lib/geometry/meshTypes';
import { createProcessedCanvas, drawMappedImagePreview, fileToCanvas, makeImageSampler } from '../lib/imageSampling';
import { quantizeCanvas } from '../lib/quantization';

const defaultMapping: ImageMappingSettings = { fitMode: 'stretch', offsetU: 0, offsetV: 0, scale: 1, mirrorX: false, flipY: false, repeatX: true, repeatY: false };
const defaultShape: ShapeSettings = {
  type: 'cylinder',
  heightMm: 110,
  diameterMm: 70,
  bottomDiameterMm: 54,
  middleDiameterMm: 82,
  topDiameterMm: 48,
  wallThicknessMm: 1.2,
  radialSegments: 128,
  heightSegments: 128,
  openTop: true,
  addBottom: true,
};
const defaultRelief: ReliefSettings = { enabled: false, strengthMm: 0, invert: false, blurPx: 0 };
const fallbackPalette = ['#f4efe5', '#263238', '#cf4b35', '#2e7d6f'].map((hex, index) => makePaletteColor(hex, index));

export default function App() {
  const [imageCanvas, setImageCanvas] = useState<HTMLCanvasElement | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [mappedPreviewUrl, setMappedPreviewUrl] = useState<string | null>(null);
  const [mapping, setMapping] = useState(defaultMapping);
  const [shape, setShape] = useState(defaultShape);
  const [relief, setRelief] = useState(defaultRelief);
  const [colorCount, setColorCount] = useState(4);
  const [lockManualPalette, setLockManualPalette] = useState(false);
  const [palette, setPalette] = useState<PaletteColor[]>(fallbackPalette);
  const [colorMixEnabled, setColorMixEnabled] = useState(false);
  const [colorMixFilaments, setColorMixFilaments] = useState<PaletteColor[]>(defaultColorMixFilaments());
  const [insideMaterialIndex, setInsideMaterialIndex] = useState(1);
  const [mesh, setMesh] = useState<MeshData | null>(null);
  const [status, setStatus] = useState('Ready for an image.');
  const [isExporting, setIsExporting] = useState(false);
  const [triangulateBeforeExport, setTriangulateBeforeExport] = useState(false);

  const processedCanvas = useMemo(() => (imageCanvas ? createProcessedCanvas(imageCanvas, relief.blurPx) : null), [imageCanvas, relief.blurPx]);
  const colorMixPalette = useMemo(() => buildColorMixPalette(colorMixFilaments), [colorMixFilaments]);
  const effectivePalette = colorMixEnabled ? colorMixPalette : palette;

  useEffect(() => {
    if (!processedCanvas || lockManualPalette || colorMixEnabled) {
      return;
    }
    setStatus('Quantizing image...');
    setPalette(quantizeCanvas(processedCanvas, colorCount));
  }, [colorCount, colorMixEnabled, lockManualPalette, processedCanvas]);

  useEffect(() => {
    if (!processedCanvas) {
      return;
    }
    const preview = drawMappedImagePreview(processedCanvas, mapping);
    if (!preview) {
      return;
    }
    const url = preview.toDataURL('image/png');
    setMappedPreviewUrl((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return url;
    });
  }, [mapping, processedCanvas]);

  const buildMesh = useCallback((mode: 'preview' | 'export' | 'highExport'): MeshData | null => {
    if (!processedCanvas || effectivePalette.length === 0) {
      return null;
    }
    const sampler = makeImageSampler(processedCanvas, mapping);
    const nextShape = mode === 'preview'
      ? {
          ...shape,
          radialSegments: Math.min(160, Math.round(shape.radialSegments)),
          heightSegments: Math.min(160, Math.round(shape.heightSegments)),
        }
      : mode === 'highExport'
      ? {
          ...shape,
          radialSegments: Math.min(1024, Math.round(shape.radialSegments * 2)),
          heightSegments: Math.min(1024, Math.round(shape.heightSegments * 2)),
        }
      : shape;
    return nextShape.type === 'cylinder'
      ? generateCylinder(nextShape, sampler, relief, effectivePalette, insideMaterialIndex)
      : generateVase(nextShape, sampler, relief, effectivePalette, insideMaterialIndex);
  }, [effectivePalette, insideMaterialIndex, mapping, processedCanvas, relief, shape]);

  useEffect(() => {
    if (!processedCanvas || effectivePalette.length === 0) {
      setMesh(null);
      return;
    }
    setStatus('Generating preview...');
    const timer = window.setTimeout(() => {
      const nextMesh = buildMesh('preview');
      setMesh(nextMesh);
      setStatus(nextMesh ? 'Preview ready. 3MF color compatibility depends on slicer support. Tested target: PrusaSlicer.' : 'Upload an image to generate the preview.');
    }, 220);
    return () => window.clearTimeout(timer);
  }, [buildMesh, effectivePalette.length, processedCanvas]);

  const loadImage = async (file: File) => {
    setStatus('Loading image...');
    try {
      const canvas = await fileToCanvas(file);
      if (imageUrl) URL.revokeObjectURL(imageUrl);
      setImageUrl(URL.createObjectURL(file));
      setImageCanvas(canvas);
      setMesh(null);
      setStatus('Image loaded. Generating preview...');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Image failed to load.');
    }
  };

  const handleExport = async () => {
    const exportMesh = buildMesh(triangulateBeforeExport ? 'highExport' : 'export') ?? mesh;
    if (!exportMesh) {
      setStatus('Generate a mesh before exporting.');
      return;
    }
    setIsExporting(true);
    setStatus('Exporting 3MF...');
    try {
      await export3mf(exportMesh, exportMesh.name);
      setStatus('Exported 3MF with face material colors and Prusa metadata.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '3MF export failed.');
    } finally {
      setIsExporting(false);
    }
  };

  const handleColorCountChange = (count: number) => {
    setColorCount(count);
    if (lockManualPalette) {
      const next = [...palette];
      while (next.length < count) next.push(makePaletteColor('#dddddd', next.length));
      setPalette(next.slice(0, count));
    }
    setInsideMaterialIndex((current) => Math.min(current, count - 1));
  };

  return (
    <main className="app-shell">
      <aside className="control-panel">
        <header>
          <p className="eyebrow">Client-side 3MF generator</p>
          <h1>3D Image Mapper</h1>
          <div className="header-actions">
            <button type="button" className="primary-button" onClick={handleExport} disabled={isExporting || (!mesh && !processedCanvas)}>
              {isExporting ? 'Exporting...' : 'Export 3MF'}
            </button>
          </div>
        </header>
        <ImageControls imageUrl={imageUrl} mapping={mapping} mappedPreviewUrl={mappedPreviewUrl} onImageChange={loadImage} onMappingChange={setMapping} />
        <ShapeControls settings={shape} onChange={setShape} />
        <PaletteControls
          colorCount={colorCount}
          palette={palette}
          colorMixEnabled={colorMixEnabled}
          colorMixFilaments={colorMixFilaments}
          colorMixPalette={colorMixPalette}
          insideMaterialIndex={insideMaterialIndex}
          lockManualPalette={lockManualPalette}
          onColorCountChange={handleColorCountChange}
          onLockManualPaletteChange={setLockManualPalette}
          onPaletteChange={setPalette}
          onColorMixEnabledChange={(enabled) => {
            setColorMixEnabled(enabled);
            setLockManualPalette(enabled || lockManualPalette);
            setInsideMaterialIndex(0);
          }}
          onColorMixFilamentsChange={setColorMixFilaments}
          onInsideMaterialChange={setInsideMaterialIndex}
        />
        <ReliefControls settings={relief} onChange={setRelief} />
      </aside>
      <section className="work-area">
        <Preview3D mesh={mesh} />
        <ExportPanel
          canExport={Boolean(mesh || processedCanvas)}
          isExporting={isExporting}
          triangleCount={mesh?.triangles.length ?? 0}
          status={status}
          triangulateBeforeExport={triangulateBeforeExport}
          onTriangulateBeforeExportChange={setTriangulateBeforeExport}
          onExport={handleExport}
        />
      </section>
    </main>
  );
}
