import { describe, expect, it } from 'vitest';
import { buildRdoHtml } from '@process/task/rdo/pdfTemplate';

describe('RDO PDF template', () => {
  it('escapes user text and marks drafts', () => {
    const html = buildRdoHtml({
      status: 'draft', revision: 2, hash: null, approvedBy: null, approvedAt: null,
      snapshot: { entry: { project_name: '<script>alert(1)</script>', work_date: '2026-11-14', weather: 'clear', workforce_count: null, work_summary: 'Teste' }, services: [], evidence_manifest: [] },
    });
    expect(html).toContain('RASCUNHO');
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('NÃ£o informado');
  });

  it('prints approval identity and hash', () => {
    const html = buildRdoHtml({ status: 'approved', revision: 3, hash: 'abc123', approvedBy: 'Rafael - Engenheiro', approvedAt: 1,
      snapshot: { entry: { project_name: 'Obra', work_date: '2026-11-14', weather: 'cloudy', workforce_count: 5, work_summary: 'ConcluÃ­do' }, services: [], evidence_manifest: [] } });
    expect(html).toContain('abc123');
    expect(html).toContain('Rafael - Engenheiro');
    expect(html).not.toContain('RASCUNHO');
  });
});
