import { defaultCustomExportSettings, useCustomExport, type CustomExportSettings, type PreparedModel } from '../lib/geometry/useCustomExport';
import { CustomModelControls } from './CustomModelControls';
import { projectionFrame, transformModel, defaultCustomSettings, type CustomSettings, type ModelSource } from '../lib/geometry/customModel';
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
import { cleanupSmallColorIslands } from '../lib/geometry/cleanupColorIslands';
import { generateCylinder } from '../lib/geometry/generateCylinder';
import { generateArc, generatePlane } from '../lib/geometry/generatePanel';
import { generateVase } from '../lib/geometry/generateVase';
import type { ImageMappingSettings, MeshData, ReliefSettings, ShapeSettings } from '../lib/geometry/meshTypes';
import { validateMeshManifold, type MeshValidationResult } from '../lib/geometry/validateMesh';
import { createProcessedCanvas, drawMappedImagePreview, fileToCanvas, makeImageSampler } from '../lib/imageSampling';
import { quantizeCanvas } from '../lib/quantization';

const defaultMapping: ImageMappingSettings = { fitMode: 'stretch', offsetU: 0, offsetV: 0, scale: 1, mirrorX: false, flipY: false, repeatX: true, repeatY: false };
const defaultShape: ShapeSettings = {
  type: 'arc',
  heightMm: 110,
  widthMm: 90,
  diameterMm: 70,
  arcAngleDeg: 120,
  bottomDiameterMm: 54,
  middleDiameterMm: 82,
  topDiameterMm: 48,
  wallThicknessMm: 3,
  bottomThicknessMm: 2,
  radialSegments: 256,
  heightSegments: 256,
  openTop: true,
  addBottom: true,
  scaleLocked: true,
};
const defaultRelief: ReliefSettings = { enabled: false, strengthMm: 0, invert: false, blurPx: 0 };
const fallbackPalette = ['#f4efe5', '#263238', '#cf4b35', '#2e7d6f'].map((hex, index) => makePaletteColor(hex, index));

type EditableSnapshot = {
  customExportSettings: CustomExportSettings;
  modelSource: ModelSource;
  customModel: MeshData | null;
  customSettings: CustomSettings;
  mapping: ImageMappingSettings;
  shape: ShapeSettings;
  relief: ReliefSettings;
  colorCount: number;
  lockManualPalette: boolean;
  palette: PaletteColor[];
  colorMixEnabled: boolean;
  colorMixFilaments: PaletteColor[];
  insideMaterialIndex: number;
  cleanupColorIslands: boolean;
  colorIslandMaxTriangles: number;
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
  const [customExportSettings, setCustomExportSettings] = useState(defaultCustomExportSettings);
  const [showingExportPreview, setShowingExportPreview] = useState(false);
  const { preparing: preparingExport, prepare: prepareCustomExport, cancel: cancelExportPreparation } = useCustomExport();
  const preparedExport = useRef<{ key: object; result: PreparedModel } | null>(null);
  const [modelSource, setModelSource] = useState<ModelSource>('simple');
  const [customModel, setCustomModel] = useState<MeshData | null>(null);
  const [customSettings, setCustomSettings] = useState<CustomSettings>(defaultCustomSettings);
  const [modelLoading, setModelLoading] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);
  const [isBuilding, setIsBuilding] = useState(false);
  const importSequence = useRef(0);
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
  const [colorMixEnabled, setColorMixEnabled] = useState(true);
  const [colorMixFilaments, setColorMixFilaments] = useState<PaletteColor[]>(defaultColorMixFilaments());
  const [insideMaterialIndex, setInsideMaterialIndex] = useState(3);
  const [mesh, setMesh] = useState<MeshData | null>(null);
  const [meshValidation, setMeshValidation] = useState<MeshValidationResult | null>(null);
  const [status, setStatus] = useState('Ready for an image.');
  const [isExporting, setIsExporting] = useState(false);
  const [cleanupColorIslands, setCleanupColorIslands] = useState(true);
  const [colorIslandMaxTriangles, setColorIslandMaxTriangles] = useState(8);
  const [triangulateBeforeExport, setTriangulateBeforeExport] = useState(true);
  const undoStack = useRef<EditableSnapshot[]>([]);

  const processedCanvas = useMemo(() => (imageCanvas ? createProcessedCanvas(imageCanvas, relief.blurPx) : null), [imageCanvas, relief.blurPx]);
  const colorMixPalette = useMemo(() => buildColorMixPalette(colorMixFilaments), [colorMixFilaments]);
  const effectivePalette = colorMixEnabled ? colorMixPalette : palette;
  const insideMaterialLimit = colorMixEnabled ? colorMixFilaments.length : effectivePalette.length;
  const effectiveInsideMaterialIndex = Math.max(0, Math.min(Math.max(0, insideMaterialLimit - 1), insideMaterialIndex));
  const padColor = effectivePalette[effectiveInsideMaterialIndex] ?? fallbackPalette[0];
  const exportKey = useMemo(() => ({}), [customModel, customSettings, mapping, processedCanvas, effectivePalette, effectiveInsideMaterialIndex, customExportSettings, triangulateBeforeExport, cleanupColorIslands, modelSource]);
  const latestExportKey = useRef(exportKey);
  latestExportKey.current = exportKey;
  const customSurfaceAspect = useMemo(() => {
    if (modelSource !== 'custom' || !customModel) return undefined;
    const frame = projectionFrame(transformModel(customModel, customSettings), customSettings);
    return frame.width / frame.height;
  }, [modelSource, customModel, customSettings]);
  const imageAspectRatio = imageCanvas ? imageCanvas.width / Math.max(1, imageCanvas.height) : null;

  const snapshotEditableState = useCallback((): EditableSnapshot => ({
    customExportSettings: { ...customExportSettings },
    modelSource, customModel, customSettings: { ...customSettings },
    mapping: { ...mapping },
    shape: { ...shape },
    relief: { ...relief },
    colorCount,
    lockManualPalette,
    palette: clonePalette(palette),
    colorMixEnabled,
    colorMixFilaments: clonePalette(colorMixFilaments),
    insideMaterialIndex,
    cleanupColorIslands,
    colorIslandMaxTriangles,
    triangulateBeforeExport,
  }), [customExportSettings, modelSource, customModel, customSettings, cleanupColorIslands, colorCount, colorIslandMaxTriangles, colorMixEnabled, colorMixFilaments, insideMaterialIndex, lockManualPalette, mapping, palette, relief, shape, triangulateBeforeExport]);

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
    importSequence.current++;
    setModelLoading(false);
    setCustomExportSettings(previous.customExportSettings);
    setModelSource(previous.modelSource);
    setCustomModel(previous.customModel);
    setCustomSettings(previous.customSettings);
    setMapping(previous.mapping);
    setShape(previous.shape);
    setRelief(previous.relief);
    setColorCount(previous.colorCount);
    setLockManualPalette(previous.lockManualPalette);
    setPalette(previous.palette);
    setColorMixEnabled(previous.colorMixEnabled);
    setColorMixFilaments(previous.colorMixFilaments);
    setInsideMaterialIndex(previous.insideMaterialIndex);
    setCleanupColorIslands(previous.cleanupColorIslands);
    setColorIslandMaxTriangles(previous.colorIslandMaxTriangles);
    setTriangulateBeforeExport(previous.triangulateBeforeExport);
    setStatus('Undid last change.');
  }, []);

  const commitCustomSettings = useCallback((next: CustomSettings) => {
    pushUndo();
    setCustomSettings(next);
  }, [pushUndo]);

  const changeModelSource = (next: ModelSource) => {
    pushUndo();
    importSequence.current++;
    setModelLoading(false);
    setModelSource(next);
    if (next === 'custom' && !customModel) setMapping(current => ({ ...current, fitMode: 'contain', repeatX: false, repeatY: false }));
  };

  const loadModel = useCallback(async (file: File) => {
    const sequence = ++importSequence.current;
    setModelSource('custom');
    setModelLoading(true);
    setModelError(null);
    try {
      const { importModel } = await import('../lib/geometry/importModel');
      const imported = await importModel(file);
      if (sequence !== importSequence.current) return;
      pushUndo();
      setCustomModel(imported);
      setCustomSettings(defaultCustomSettings);
      setModelSource('custom');
      setMapping(current => ({ ...current, fitMode: 'contain', repeatX: false, repeatY: false, scale: 1, offsetU: 0, offsetV: 0 }));
      setStatus('Model loaded. Preparing preview...');
    } catch (error) {
      if (sequence === importSequence.current) setModelError(error instanceof Error ? error.message : 'Could not load the model.');
    } finally {
      if (sequence === importSequence.current) setModelLoading(false);
    }
  }, [pushUndo]);

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
    const preview = drawMappedImagePreview(processedCanvas, mapping, padColor, customSurfaceAspect);
    if (!preview) {
      return;
    }
    const url = preview.toDataURL('image/png');
    setMappedPreviewUrl((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return url;
    });
  }, [mapping, padColor, processedCanvas, customSurfaceAspect]);

  const buildMesh = useCallback((mode: 'preview' | 'export' | 'highExport'): MeshData | null => {
    if (!processedCanvas || effectivePalette.length === 0) {
      return null;
    }
    const sampler = makeImageSampler(processedCanvas, mapping, padColor);
    const nextShape = mode === 'highExport'
      ? {
          ...shape,
          radialSegments: Math.min(1024, Math.round(shape.radialSegments * 2)),
          heightSegments: Math.min(1024, Math.round(shape.heightSegments * 2)),
        }
      : shape;
    switch (nextShape.type) {
      case 'cylinder':
        return generateCylinder(nextShape, sampler, relief, effectivePalette, effectiveInsideMaterialIndex);
      case 'vase':
        return generateVase(nextShape, sampler, relief, effectivePalette, effectiveInsideMaterialIndex);
      case 'plane':
        return generatePlane(nextShape, sampler, relief, effectivePalette, effectiveInsideMaterialIndex);
      case 'arc':
        return generateArc(nextShape, sampler, relief, effectivePalette, effectiveInsideMaterialIndex);
    }
  }, [effectiveInsideMaterialIndex, effectivePalette, mapping, padColor, processedCanvas, relief, shape]);

  useEffect(() => {
    preparedExport.current = null;
    setShowingExportPreview(false);
    if (modelSource === 'custom') {
      setMeshValidation(null);
      if (!customModel) { setMesh(null); setIsBuilding(false); setStatus('Load an STL, 3MF, or OBJ model.'); return; }
      setIsBuilding(true);
      setStatus('Preparing model and image detail...');
      const worker = new Worker(new URL('../lib/geometry/projection.worker.ts', import.meta.url), { type: 'module' });
      const pixels = processedCanvas?.getContext('2d', { willReadFrequently: true })?.getImageData(0, 0, processedCanvas.width, processedCanvas.height);
      worker.onmessage = ({ data }) => {
        setIsBuilding(false);
        if (data.error) { setMesh(null); setStatus(data.error); return; }
        setMesh(data.mesh);
        setMeshValidation(data.validation);
        setStatus(!processedCanvas ? 'Model ready. Add an image to paint it.' : data.limited
          ? 'Preview ready. Detail reached the triangle limit; some image features may be coarse.'
          : data.painted === 0 ? 'No image colors visible. Adjust placement or choose Project from view.'
          : 'Preview ready. Use Preview export to check extra detail and cleanup.');
      };
      worker.onerror = () => { setMesh(null); setIsBuilding(false); setStatus('Model processing failed. Try a smaller model.'); };
      const timer = window.setTimeout(() => worker.postMessage({ source: customModel, settings: customSettings, mapping,
        pixels: pixels ? { data: pixels.data, width: pixels.width, height: pixels.height } : null,
        palette: effectivePalette, baseIndex: effectiveInsideMaterialIndex,
      }), 180);
      return () => { window.clearTimeout(timer); worker.terminate(); };
    }
    setIsBuilding(false);
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
  }, [buildMesh, effectivePalette, processedCanvas, modelSource, customModel, customSettings, mapping, effectiveInsideMaterialIndex, exportKey]);

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
      if (modelSource === 'simple') setMesh(null);
      setMeshValidation(null);
      setStatus('Image loaded. Generating preview...');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Image failed to load.');
    }
  }, [imageUrl, modelSource]);

  useEffect(() => {
    const preventDragDefault = (event: DragEvent) => {
      event.preventDefault();
    };
    const handleDrop = (event: DragEvent) => {
      event.preventDefault();
      const files = Array.from(event.dataTransfer?.files ?? []);
      const modelFile = files.find(candidate => /\.(stl|3mf|obj)$/i.test(candidate.name));
      if (modelFile) void loadModel(modelFile);
      const file = files.find((candidate) => candidate.type.startsWith('image/'));
      if (file) {
        void loadImage(file);
      } else if (!modelFile) {
        setStatus('Drop an image, STL, 3MF, or OBJ file.');
      }
    };
    window.addEventListener('dragover', preventDragDefault);
    window.addEventListener('drop', handleDrop);
    return () => {
      window.removeEventListener('dragover', preventDragDefault);
      window.removeEventListener('drop', handleDrop);
    };
  }, [loadImage, loadModel]);

  const prepareExportModel = async (): Promise<PreparedModel> => {
    if (!customModel) throw new Error('Load a custom model first.');
    if (preparedExport.current?.key === exportKey) return preparedExport.current.result;
    const pixels = processedCanvas?.getContext('2d', { willReadFrequently: true })?.getImageData(0, 0, processedCanvas.width, processedCanvas.height);
    setStatus('Preparing export detail and color cleanup...');
    const result = await prepareCustomExport({
      source: customModel, settings: customSettings, mapping,
      pixels: pixels ? { data: pixels.data, width: pixels.width, height: pixels.height } : null,
      palette: effectivePalette, baseIndex: effectiveInsideMaterialIndex,
      refinement: triangulateBeforeExport ? { multiplier: customExportSettings.multiplier, budget: customExportSettings.budget } : undefined,
      cleanupAreaMm2: cleanupColorIslands ? customExportSettings.islandAreaMm2 : undefined,
    });
    if (latestExportKey.current !== exportKey) throw new Error('Settings changed. Prepare the export again.');
    preparedExport.current = { key: exportKey, result };
    return result;
  };

  const exportDetailStatus = (result: PreparedModel) => {
    const cleanup = result.cleanup?.replacedIslandCount
      ? ` Cleaned ${result.cleanup.replacedIslandCount} islands (${result.cleanup.replacedTriangleCount} triangles).`
      : result.cleanup ? ' No small color islands found.' : '';
    return `${result.mesh.triangles.length.toLocaleString()} triangles.${result.limited ? ' Triangle budget reached; some detail remains coarse.' : ''}${cleanup}`;
  };

  const handlePreviewExport = async () => {
    if (isBuilding || modelLoading || isExporting || preparingExport) return;
    try {
      const result = await prepareExportModel();
      setMesh(result.mesh);
      setMeshValidation(result.validation);
      setShowingExportPreview(true);
      setStatus(`Export preview ready. ${exportDetailStatus(result)}`);
    } catch (error) { setStatus(error instanceof Error ? error.message : 'Export preview failed.'); }
  };

  const handleExport = async () => {
    if (isBuilding || modelLoading || isExporting || preparingExport) return;
    setIsExporting(true);
    try {
      const customResult = modelSource === 'custom' ? await prepareExportModel() : null;
      const exportMesh = customResult?.mesh ?? buildMesh(triangulateBeforeExport ? 'highExport' : 'export') ?? mesh;
      if (!exportMesh) throw new Error('Generate a mesh before exporting.');
      const exportName = `${safeFileNamePart(imageTitle)}_${modelSource === 'custom' ? safeFileNamePart(customModel?.name ?? 'model') : shape.type}`;
      const cleanupResult = modelSource === 'simple' && cleanupColorIslands ? cleanupSmallColorIslands(exportMesh, colorIslandMaxTriangles) : null;
      const namedExportMesh: MeshData = { ...(cleanupResult?.mesh ?? exportMesh), name: exportName };
      const exportValidation = customResult?.validation ?? validateMeshManifold(namedExportMesh);
      setStatus('Writing 3MF...');
      await export3mf(namedExportMesh, `${exportName}.3MF`);
      const cleanupStatus = customResult ? ` ${exportDetailStatus(customResult)}` : cleanupResult && cleanupResult.replacedTriangleCount > 0
        ? ` Cleaned ${cleanupResult.replacedIslandCount} color islands (${cleanupResult.replacedTriangleCount} triangles).`
        : cleanupColorIslands ? ' No small color islands found.' : '';
      setStatus((exportValidation.boundaryEdges || exportValidation.nonManifoldEdges
        ? `Exported 3MF, but validation found ${exportValidation.boundaryEdges} boundary and ${exportValidation.nonManifoldEdges} non-manifold edges.`
        : 'Exported 3MF with face material colors and Prusa metadata.') + cleanupStatus);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '3MF export failed.');
    } finally { setIsExporting(false); }
  };

  const handleResetSettings = useCallback(() => {
    pushUndo();
    importSequence.current++;
    setModelLoading(false);
    setModelError(null);
    setModelSource('simple');
    setCustomSettings(defaultCustomSettings);
    setCustomExportSettings(defaultCustomExportSettings);
    setShowingExportPreview(false);
    setMapping(defaultMapping);
    setShape(defaultShapeForImage(defaultShape.type, imageCanvas));
    setRelief(defaultRelief);
    setColorCount(4);
    setLockManualPalette(false);
    setPalette(fallbackPalette);
    setColorMixEnabled(true);
    setColorMixFilaments(defaultColorMixFilaments());
    setInsideMaterialIndex(3);
    setCleanupColorIslands(true);
    setColorIslandMaxTriangles(8);
    setTriangulateBeforeExport(true);
    setMesh(null);
    setMeshValidation(null);
    setStatus(imageCanvas ? 'Settings reset. Generating preview...' : 'Settings reset. Ready for an image.');
  }, [imageCanvas, pushUndo]);

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
      <aside className="control-panel" inert={preparingExport || isExporting}>
        <header>
          <p className="eyebrow">Client-side 3MF generator</p>
          <h1>ColorMix Image Mapper</h1>
          <div className="header-actions">
            <button type="button" onClick={handleResetSettings}>
              Reset settings
            </button>
            <button type="button" className="primary-button" onClick={handleExport} disabled={isExporting || preparingExport || isBuilding || modelLoading || (modelSource === 'custom' ? !mesh : (!mesh && !processedCanvas))}>
              {isExporting ? 'Exporting...' : 'Export 3MF'}
            </button>
          </div>
        </header>
        <ImageControls surfaceAspect={customSurfaceAspect} mapping={mapping} mappedPreviewUrl={mappedPreviewUrl} onImageChange={loadImage} onMappingChange={commitMapping} />
        <ShapeControls source={modelSource} onSourceChange={changeModelSource}
          customControls={<CustomModelControls model={customModel} settings={customSettings} loading={modelLoading} error={modelError} onLoad={loadModel} onChange={commitCustomSettings} />}
          settings={shape} imageAspectRatio={imageAspectRatio} onChange={commitShape} />
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
        {modelSource === 'simple' && <ReliefControls settings={relief} onChange={commitRelief} />}
      </aside>
      <section className="work-area">
        <Preview3D mesh={mesh} customSettings={modelSource === 'custom' ? customSettings : undefined}
          imageAspect={imageAspectRatio} mapping={mapping} onMappingChange={commitMapping} onProjectionChange={commitCustomSettings} busy={isBuilding || modelLoading || preparingExport || isExporting} />
        <ExportPanel
          customModel={modelSource === 'custom'}
          customSettings={customExportSettings}
          onCustomSettingsChange={next => { pushUndo(); setCustomExportSettings(next); }}
          preparingExport={preparingExport}
          showingExportPreview={modelSource === 'custom' && showingExportPreview}
          onPreviewExport={handlePreviewExport}
          onCancelPreparation={cancelExportPreparation}
          canExport={!isBuilding && !modelLoading && (modelSource === 'custom' ? Boolean(mesh) : Boolean(mesh || processedCanvas))}
          isExporting={isExporting}
          triangleCount={mesh?.triangles.length ?? 0}
          status={status}
          validationWarning={validationWarning}
          cleanupColorIslands={cleanupColorIslands}
          colorIslandMaxTriangles={colorIslandMaxTriangles}
          triangulateBeforeExport={triangulateBeforeExport}
          onCleanupColorIslandsChange={(enabled) => {
            pushUndo();
            setCleanupColorIslands(enabled);
          }}
          onColorIslandMaxTrianglesChange={(count) => {
            pushUndo();
            setColorIslandMaxTriangles(Math.max(1, Math.min(500, Math.round(count) || 1)));
          }}
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
