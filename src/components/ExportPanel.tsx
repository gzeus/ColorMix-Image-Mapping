type Props = {
  canExport: boolean;
  isExporting: boolean;
  triangleCount: number;
  status: string;
  triangulateBeforeExport: boolean;
  onTriangulateBeforeExportChange: (enabled: boolean) => void;
  onExport: () => void;
};

export function ExportPanel({
  canExport,
  isExporting,
  triangleCount,
  status,
  triangulateBeforeExport,
  onTriangulateBeforeExportChange,
  onExport,
}: Props) {
  return (
    <section className="export-bar">
      <div>
        <strong>{triangleCount.toLocaleString()} triangles</strong>
        <p>{status}</p>
      </div>
      <div className="export-actions">
        <label className="check-row"><input type="checkbox" checked={triangulateBeforeExport} onChange={(event) => onTriangulateBeforeExportChange(event.target.checked)} /> Triangulate detail on export</label>
        <button type="button" className="primary-button" disabled={!canExport || isExporting} onClick={onExport}>
          {isExporting ? 'Exporting...' : 'Export 3MF'}
        </button>
      </div>
    </section>
  );
}
