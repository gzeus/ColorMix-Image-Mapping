import type { CustomExportSettings } from '../lib/geometry/useCustomExport';

type Props = {
  customModel?: boolean;
  customSettings: CustomExportSettings;
  onCustomSettingsChange: (settings: CustomExportSettings) => void;
  onPreviewExport: () => void;
  onCancelPreparation: () => void;
  preparingExport: boolean;
  showingExportPreview: boolean;
  canExport: boolean;
  isExporting: boolean;
  triangleCount: number;
  status: string;
  validationWarning: string | null;
  cleanupColorIslands: boolean;
  colorIslandMaxTriangles: number;
  triangulateBeforeExport: boolean;
  onCleanupColorIslandsChange: (enabled: boolean) => void;
  onColorIslandMaxTrianglesChange: (count: number) => void;
  onTriangulateBeforeExportChange: (enabled: boolean) => void;
  onExport: () => void;
};

export function ExportPanel({
  customModel,
  customSettings,
  onCustomSettingsChange,
  onPreviewExport,
  onCancelPreparation,
  preparingExport,
  showingExportPreview,
  canExport,
  isExporting,
  triangleCount,
  status,
  validationWarning,
  cleanupColorIslands,
  colorIslandMaxTriangles,
  triangulateBeforeExport,
  onCleanupColorIslandsChange,
  onColorIslandMaxTrianglesChange,
  onTriangulateBeforeExportChange,
  onExport,
}: Props) {
  return (
    <section className={`export-bar${customModel ? ' custom-export' : ''}`}>
      <div>
        <strong>{triangleCount.toLocaleString()} triangles{showingExportPreview ? ' · export preview' : ''}</strong>
        <p>{status}</p>
        {validationWarning ? <p className="warning">{validationWarning}</p> : null}
      </div>
      <div className="export-actions">
        <label className="check-row"><input type="checkbox" disabled={isExporting || preparingExport} checked={triangulateBeforeExport} onChange={(event) => onTriangulateBeforeExportChange(event.target.checked)} /> Triangulate detail on export</label>
        {customModel && triangulateBeforeExport && <>
          <label className="field"><span>Export detail</span><select disabled={isExporting || preparingExport} value={customSettings.multiplier} onChange={e => onCustomSettingsChange({ ...customSettings, multiplier: Number(e.target.value) })}>
            <option value={2}>2× finer</option><option value={4}>4× finer</option>
          </select></label>
          <label className="field"><span>Triangle budget</span><select disabled={isExporting || preparingExport} value={customSettings.budget} onChange={e => onCustomSettingsChange({ ...customSettings, budget: Number(e.target.value) })}>
            <option value={1000000}>1 million</option><option value={2000000}>2 million · more memory</option>
          </select></label>
        </>}
        <label className="check-row"><input type="checkbox" disabled={isExporting || preparingExport} checked={cleanupColorIslands} onChange={(event) => onCleanupColorIslandsChange(event.target.checked)} /> Clean small color islands</label>
        {cleanupColorIslands ? (
          <label className="export-number-row">
            <span>{customModel ? 'Max island mm²' : 'Max island tris'}</span>
            <input type="number" disabled={isExporting || preparingExport} min={customModel ? 0.001 : 1} max={customModel ? 10 : 500} step={customModel ? 0.01 : 1} value={customModel ? customSettings.islandAreaMm2 : colorIslandMaxTriangles} onChange={(event) => {
              const value = Number(event.target.value);
              if (customModel) onCustomSettingsChange({ ...customSettings, islandAreaMm2: Math.max(0.001, Math.min(10, value || 0.001)) });
              else onColorIslandMaxTrianglesChange(value);
            }} />
          </label>
        ) : null}
        {customModel && <>
          <span className="helper-copy">Extra detail resamples the image. Cleanup can remove tiny lettering; preview the export to check it. Larger budgets take more time and memory.</span>
          <button type="button" disabled={!canExport || isExporting || preparingExport} onClick={onPreviewExport}>Preview export</button>
        </>}
        {preparingExport && <button type="button" onClick={onCancelPreparation}>Cancel preparation</button>}
        <button type="button" className="primary-button" disabled={!canExport || isExporting || preparingExport} onClick={onExport}>
          {isExporting ? 'Exporting...' : 'Export 3MF'}
        </button>
      </div>
    </section>
  );
}
