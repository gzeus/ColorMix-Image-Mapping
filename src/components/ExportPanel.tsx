type Props = {
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
    <section className="export-bar">
      <div>
        <strong>{triangleCount.toLocaleString()} triangles</strong>
        <p>{status}</p>
        {validationWarning ? <p className="warning">{validationWarning}</p> : null}
      </div>
      <div className="export-actions">
        <label className="check-row"><input type="checkbox" checked={triangulateBeforeExport} onChange={(event) => onTriangulateBeforeExportChange(event.target.checked)} /> Triangulate detail on export</label>
        <label className="check-row"><input type="checkbox" checked={cleanupColorIslands} onChange={(event) => onCleanupColorIslandsChange(event.target.checked)} /> Clean small color islands</label>
        {cleanupColorIslands ? (
          <label className="export-number-row">
            <span>Max island tris</span>
            <input type="number" min={1} max={500} step={1} value={colorIslandMaxTriangles} onChange={(event) => onColorIslandMaxTrianglesChange(Number(event.target.value))} />
          </label>
        ) : null}
        <button type="button" className="primary-button" disabled={!canExport || isExporting} onClick={onExport}>
          {isExporting ? 'Exporting...' : 'Export 3MF'}
        </button>
      </div>
    </section>
  );
}
