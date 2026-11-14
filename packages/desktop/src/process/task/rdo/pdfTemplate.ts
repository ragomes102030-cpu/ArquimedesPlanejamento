type PdfSnapshot = {
  entry: Record<string, unknown>;
  services: Array<Record<string, unknown>>;
  evidence_manifest: Array<Record<string, unknown>>;
};

export type RdoPdfView = {
  status: 'draft' | 'approved';
  revision: number;
  hash: string | null;
  approvedBy: string | null;
  approvedAt: number | null;
  snapshot: PdfSnapshot;
};

const escapeHtml = (value: unknown): string => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const shown = (value: unknown): string => value === null || value === undefined || value === '' ? 'NÃ£o informado' : escapeHtml(value);

export function buildRdoHtml(view: RdoPdfView): string {
  const entry = view.snapshot.entry;
  const services = view.snapshot.services.map((service) => `<li><strong>${shown(service.title)}</strong> â€” ${shown(service.status)}</li>`).join('');
  const evidence = view.snapshot.evidence_manifest.map((item) => `<li>${shown(item.original_name)} â€” SHA-256 ${shown(item.sha256)}</li>`).join('');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>
    @page{size:A4;margin:16mm}body{font:12px Arial,sans-serif;color:#1f2937}h1{font-size:20px}h2{font-size:14px;border-bottom:1px solid #ddd;padding-bottom:4px}.draft{color:#b45309;border:2px solid #b45309;padding:8px;text-align:center}.meta{font-size:10px;color:#6b7280}dt{font-weight:700;margin-top:8px}dd{margin:2px 0 0}li{margin:5px 0}
  </style></head><body>
    ${view.status === 'draft' ? '<div class="draft">RASCUNHO â€” NÃƒO APROVADO</div>' : ''}
    <h1>RelatÃ³rio DiÃ¡rio de Obra â€” ${shown(entry.project_name)}</h1>
    <p class="meta">Data ${shown(entry.work_date)} Â· RevisÃ£o ${view.revision}</p>
    <h2>IdentificaÃ§Ã£o e condiÃ§Ãµes</h2><dl><dt>Clima</dt><dd>${shown(entry.weather)}</dd><dt>Efetivo</dt><dd>${shown(entry.workforce_count)}</dd></dl>
    <h2>ServiÃ§os executados</h2><p>${shown(entry.work_summary)}</p><ul>${services || '<li>NÃ£o informado</li>'}</ul>
    <h2>EvidÃªncias</h2><ul>${evidence || '<li>NÃ£o informado</li>'}</ul>
    <h2>AprovaÃ§Ã£o interna</h2><p>ResponsÃ¡vel: ${shown(view.approvedBy)}</p><p>Data: ${view.approvedAt ? new Date(view.approvedAt).toLocaleString('pt-BR') : 'NÃ£o informado'}</p><p class="meta">Hash SHA-256: ${shown(view.hash)}</p>
  </body></html>`;
}
