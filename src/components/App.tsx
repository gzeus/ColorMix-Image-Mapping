import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { generateArc, generatePlane } from '../lib/geometry/generatePanel';
import { generateVase } from '../lib/geometry/generateVase';
import type { ImageMappingSettings, MeshData, ReliefSettings, ShapeSettings } from '../lib/geometry/meshTypes';
import { validateMeshManifold, type MeshValidationResult } from '../lib/geometry/validateMesh';
import { createProcessedCanvas, drawMappedImagePreview, fileToCanvas, makeImageSampler } from '../lib/imageSampling';
import { quantizeCanvas } from '../lib/quantization';

const defaultMapping: ImageMappingSettings = { fitMode: 'stretch', offsetU: 0, offsetV: 0, scale: 1, mirrorX: false, flipY: false, repeatX: true, repeatY: false };
const defaultShape: ShapeSettings = {
  type: 'cylinder',
  heightMm: 110,
  widthMm: 90,
  diameterMm: 70,
  arcAngleDeg: 120,
  bottomDiameterMm: 54,
  middleDiameterMm: 82,
  topDiameterMm: 48,
  wallThicknessMm: 2,
  bottomThicknessMm: 2,
  radialSegments: 128,
  heightSegments: 128,
  openTop: true,
  addBottom: true,
  scaleLocked: true,
};
const defaultRelief: ReliefSettings = { enabled: false, strengthMm: 0, invert: false, blurPx: 0 };
const fallbackPalette = ['#f4efe5', '#263238', '#cf4b35', '#2e7d6f'].map((hex, index) => makePaletteColor(hex, index));

type EditableSnapshot = {
  mapping: ImageMappingSettings;
  shape: ShapeSettings;
  relief: ReliefSettings;
  colorCount: number;
  lockManualPalette: boolean;
  palette: PaletteColor[];
  colorMixEnabled: boolean;
  colorMixFilaments: PaletteColor[];
  insideMaterialIndex: number;
  triangulateBeforeExport: boolean;
};

function clonePalette(colors: PaletteColor[]): PaletteColor[] {
  return colors.map((color) => ({
    ...color,
    components: color.components?.map((component) => ({ ...component })),
  }));
}

function arcRadiusFor(heightMm: number, aspectRatio: number, arcAngleDeg: number): number {
  const angle = Math.max(5, Math.min(330, arcAngleDeg)) * (Math.PI / 180);
  return Math.max(5, (heightMm * aspectRatio) / angle);
}

function fitPanelShapeToImage(shape: ShapeSettings, canvas: HTMLCanvasElement): ShapeSettings {
  const aspectRatio = canvas.width / Math.max(1, canvas.height);
  const heightMm = 110;
  if (shape.type === 'plane') {
    return { ...shape, heightMm, widthMm: heightMm * aspectRatio };
  }
  if (shape.type === 'arc') {
    return { ...shape, heightMm, diameterMm: arcRadiusFor(heightMm, aspectRatio, shape.arcAngleDeg) * 2 };
  }
  return shape;
}

function defaultShapeForImage(type: ShapeSettings['type'], canvas: HTMLCanvasElement | null): ShapeSettings {
  const nextShape = { ...defaultShape, type };
  return canvas ? fitPanelShapeToImage(nextShape, canvas) : nextShape;
}

function fileTitleFromName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '').trim() || 'image';
}

function safeFileNamePart(value: string): string {
  return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim() || 'image';
}

export default function App() {
  const [imageCanvas, setImageCanvas] = useState<HTMLCanvasElement | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageTitle, setImageTitle] = useState('image');
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
  const [meshValidation, setMeshValidation] = useState<MeshValidationResult | null>(null);
  const [status, setStatus] = useState('Ready for an image.');
  const [isExporting, setIsExporting] = useState(false);
  const [triangulateBeforeExport, setTriangulateBeforeExport] = useState(false);
  const undoStack = useRef<EditableSnapshot[]>([]);

  const processedCanvas = useMemo(() => (imageCanvas ? createProcessedCanvas(imageCanvas, relief.blurPx) : null), [imageCanvas, relief.blurPx]);
  const colorMixPalette = useMemo(() => buildColorMixPalette(colorMixFilaments), [colorMixFilaments]);
  const effectivePalette = colorMixEnabled ? colorMixPalette : palette;
  const padColor = effectivePalette[Math.max(0, Math.min(effectivePalette.length - 1, insideMaterialIndex))] ?? fallbackPalette[0];
  const imageAspectRatio = imageCanvas ? imageCanvas.width / Math.max(1, imageCanvas.height) : null;

  const snapshotEditableState = useCallback((): EditableSnapshot => ({
    mapping: { ...mapping },
    shape: { ...shape },
    relief: { ...relief },
    colorCount,
    lockManualPalette,
    palette: clonePalette(palette),
    colorMixEnabled,
    colorMixFilaments: clonePalette(colorMixFilaments),
    insideMaterialIndex,
    triangulateBeforeExport,
  }), [colorCount, colorMixEnabled, colorMixFilaments, insideMaterialIndex, lockManualPalette, mapping, palette, relief, shape, triangulateBeforeExport]);

  const pushUndo = useCallback(() => {
    undoStack.current.push(snapshotEditableState());
    if (undoStack.current.length > 80) {
      undoStack.current.shift();
    }
  }, [snapshotEditableState]);

  const undo = useCallback(() => {
    const previous = undoStack.current.pop();
    if (!previous) {
      return;
    }
    setMapping(previous.mapping);
    setShape(previous.shape);
    setRelief(previous.relief);
    setColorCount(previous.colorCount);
    setLockManualPalette(previous.lockManualPalette);
    setPalette(previous.palette);
    setColorMixEnabled(previous.colorMixEnabled);
    setColorMixFilaments(previous.colorMixFilaments);
    setInsideMaterialIndex(previous.insideMaterialIndex);
    setTriangulateBeforeExport(previous.triangulateBeforeExport);
    setStatus('Undid last change.');
  }, []);

  const commitMapping = useCallback((next: ImageMappingSettings) => {
    pushUndo();
    setMapping(next);
  }, [pushUndo]);

  const commitShape = useCallback((next: ShapeSettings) => {
    pushUndo();
    setShape(next);
  }, [pushUndo]);

  const commitRelief = useCallback((next: ReliefSettings) => {
    pushUndo();
    setRelief(next);
  }, [pushUndo]);

  const commitPalette = useCallback((next: PaletteColor[]) => {
    pushUndo();
    setPalette(next);
  }, [pushUndo]);

  const commitColorMixFilaments = useCallback((next: PaletteColor[]) => {
    pushUndo();
    setColorMixFilaments(next);
  }, [pushUndo]);

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
    const preview = drawMappedImagePreview(processedCanvas, mapping, padColor);
    if (!preview) {
      return;
    }
    const url = preview.toDataURL('image/png');
    setMappedPreviewUrl((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return url;
    });
  }, [mapping, padColor, processedCanvas]);

  const buildMesh = useCallback((mode: 'preview' | 'export' | 'highExport'): MeshData | null => {
    if (!processedCanvas || effectivePalette.length === 0) {
      return null;
    }
    const sampler = makeImageSampler(processedCanvas, mapping, padColor);
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
    switch (nextShape.type) {
      case 'cylinder':
        return generateCylinder(nextShape, sampler, relief, effectivePalette, insideMaterialIndex);
      case 'vase':
        return generateVase(nextShape, sampler, relief, effectivePalette, insideMaterialIndex);
      case 'plane':
        return generatePlane(nextShape, sampler, relief, effectivePalette, insideMaterialIndex);
      case 'arc':
        return generateArc(nextShape, sampler, relief, effectivePalette, insideMaterialIndex);
    }
  }, [effectivePalette, insideMaterialIndex, mapping, padColor, processedCanvas, relief, shape]);

  useEffect(() => {
    if (!processedCanvas || effectivePalette.length === 0) {
      setMesh(null);
      return;
    }
    setStatus('Generating preview...');
    const timer = window.setTimeout(() => {
      const nextMesh = buildMesh('preview');
      setMesh(nextMesh);
      setMeshValidation(nextMesh ? validateMeshManifold(nextMesh) : null);
      setStatus(nextMesh ? 'Preview ready. 3MF color compatibility depends on slicer support. Tested target: PrusaSlicer.' : 'Upload an image to generate the preview.');
    }, 220);
    return () => window.clearTimeout(timer);
  }, [buildMesh, effectivePalette.length, processedCanvas]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.shiftKey) {
        event.preventDefault();
        undo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo]);

  const loadImage = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setStatus('Drop an image file to load it.');
      return;
    }
    setStatus('Loading image...');
    try {
      const canvas = await fileToCanvas(file);
      if (imageUrl) URL.revokeObjectURL(imageUrl);
      setImageUrl(URL.createObjectURL(file));
      setImageTitle(fileTitleFromName(file.name));
      setImageCanvas(canvas);
      setShape((current) => fitPanelShapeToImage(current, canvas));
      setMesh(null);
      setMeshValidation(null);
      setStatus('Image loaded. Generating preview...');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Image failed to load.');
    }
  }, [imageUrl]);

  useEffect(() => {
    const preventDragDefault = (event: DragEvent) => {
      event.preventDefault();
    };
    const handleDrop = (event: DragEvent) => {
      event.preventDefault();
      const file = Array.from(event.dataTransfer?.files ?? []).find((candidate) => candidate.type.startsWith('image/'));
      if (file) {
        void loadImage(file);
      } else {
        setStatus('Drop an image file to load it.');
      }
    };
    window.addEventListener('dragover', preventDragDefault);
    window.addEventListener('drop', handleDrop);
    return () => {
      window.removeEventListener('dragover', preventDragDefault);
      window.removeEventListener('drop', handleDrop);
    };
  }, [loadImage]);

  const handleExport = async () => {
    const exportMesh = buildMesh(triangulateBeforeExport ? 'highExport' : 'export') ?? mesh;
    if (!exportMesh) {
      setStatus('Generate a mesh before exporting.');
      return;
    }
    setIsExporting(true);
    const exportValidation = validateMeshManifold(exportMesh);
    const exportName = `${safeFileNamePart(imageTitle)}_${shape.type}`;
    const namedExportMesh: MeshData = { ...exportMesh, name: exportName };
    setStatus('Exporting 3MF...');
    try {
      await export3mf(namedExportMesh, `${exportName}.3MF`);
      setStatus(exportValidation.boundaryEdges || exportValidation.nonManifoldEdges
        ? `Exported 3MF, but validation found ${exportValidation.boundaryEdges} boundary and ${exportValidation.nonManifoldEdges} non-manifold edges.`
        : 'Exported 3MF with face material colors and Prusa metadata.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '3MF export failed.');
    } finally {
      setIsExporting(false);
    }
  };

  const handleResetSettings = useCallback(() => {
    pushUndo();
    setMapping(defaultMapping);
    setShape(defaultShapeForImage(shape.type, imageCanvas));
    setRelief(defaultRelief);
    setColorCount(4);
    setLockManualPalette(false);
    setPalette(fallbackPalette);
    setColorMixEnabled(false);
    setColorMixFilaments(defaultColorMixFilaments());
    setInsideMaterialIndex(1);
    setTriangulateBeforeExport(false);
    setMesh(null);
    setMeshValidation(null);
    setStatus(imageCanvas ? 'Settings reset. Generating preview...' : 'Settings reset. Ready for an image.');
  }, [imageCanvas, pushUndo, shape.type]);

  const handleColorCountChange = (count: number) => {
    pushUndo();
    setColorCount(count);
    if (lockManualPalette) {
      const next = [...palette];
      while (next.length < count) next.push(makePaletteColor('#dddddd', next.length));
      setPalette(next.slice(0, count));
    }
    setInsideMaterialIndex((current) => Math.min(current, count - 1));
  };

  const validationWarning = meshValidation && (meshValidation.boundaryEdges || meshValidation.nonManifoldEdges || meshValidation.duplicateTriangles)
    ? `${meshValidation.boundaryEdges} boundary edges, ${meshValidation.nonManifoldEdges} non-manifold edges, ${meshValidation.duplicateTriangles} duplicate triangles.`
    : null;

  return (
    <main className="app-shell">
      <aside className="control-panel">
        <header>
          <p className="eyebrow">Client-side 3MF generator</p>
          <h1>ColorMix Image Mapper</h1>
          <div className="header-actions">
            <button type="button" onClick={handleResetSettings}>
              Reset settings
            </button>
            <button type="button" className="primary-button" onClick={handleExport} disabled={isExporting || (!mesh && !processedCanvas)}>
              {isExporting ? 'Exporting...' : 'Export 3MF'}
            </button>
          </div>
        </header>
        <ImageControls mapping={mapping} mappedPreviewUrl={mappedPreviewUrl} onImageChange={loadImage} onMappingChange={commitMapping} />
        <ShapeControls settings={shape} imageAspectRatio={imageAspectRatio} onChange={commitShape} />
        <PaletteControls
          colorCount={colorCount}
          palette={palette}
          colorMixEnabled={colorMixEnabled}
          colorMixFilaments={colorMixFilaments}
          colorMixPalette={colorMixPalette}
          insideMaterialIndex={insideMaterialIndex}
          lockManualPalette={lockManualPalette}
          onColorCountChange={handleColorCountChange}
          onLockManualPaletteChange={(enabled) => {
            pushUndo();
            setLockManualPalette(enabled);
          }}
          onPaletteChange={commitPalette}
          onColorMixEnabledChange={(enabled) => {
            pushUndo();
            setColorMixEnabled(enabled);
            setLockManualPalette(enabled || lockManualPalette);
            setInsideMaterialIndex(0);
          }}
          onColorMixFilamentsChange={commitColorMixFilaments}
          onInsideMaterialChange={(index) => {
            pushUndo();
            setInsideMaterialIndex(index);
          }}
        />
        <ReliefControls settings={relief} onChange={commitRelief} />
      </aside>
      <section className="work-area">
        <Preview3D mesh={mesh} />
        <ExportPanel
          canExport={Boolean(mesh || processedCanvas)}
          isExporting={isExporting}
          triangleCount={mesh?.triangles.length ?? 0}
          status={status}
          validationWarning={validationWarning}
          triangulateBeforeExport={triangulateBeforeExport}
          onTriangulateBeforeExportChange={(enabled) => {
            pushUndo();
            setTriangulateBeforeExport(enabled);
          }}
          onExport={handleExport}
        />
      </section>
    </main>
  );
}
