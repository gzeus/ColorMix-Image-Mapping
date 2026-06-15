type Props = {
  canExport: boolean;
  isExporting: boolean;
  triangleCount: number;
  status: string;
  onExport: () => void;
};

export function ExportPanel({ canExport, isExporting, triangleCount, status, onExport }: Props) {
  return (
    <section className="export-bar">
      <div>
        <strong>{triangleCount.toLocaleString()} triangles</strong>
        <p>{status}</p>
      </div>
      <button type="button" className="primary-button" disabled={!canExport || isExporting} onClick={onExport}>
        {isExporting ? 'Exporting...' : 'Export 3MF'}
      </button>
    </section>
  );
}
