import { describe, expect, it } from 'vitest';
import { buildRdoHtml } from '@process/task/rdo/pdfTemplate';

describe('RDO PDF template', () => {
  it('escapes user text and marks drafts', () => {
    const html = buildRdoHtml({
      status: 'draft',
      revision: 2,
      hash: null,
      approvedBy: null,
      approvedAt: null,
      snapshot: {
        entry: {
          project_name: '<script>alert(1)</script>',
          work_date: '2026-11-14',
          weather: 'clear',
          workforce_count: null,
          work_summary: 'Teste',
        },
        services: [],
        evidence_manifest: [],
      },
    });
    expect(html).toContain('RASCUNHO');
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('Não informado');
  });

  it('prints approval identity and hash', () => {
    const html = buildRdoHtml({
      status: 'approved',
      revision: 3,
      hash: 'abc123',
      approvedBy: 'Rafael - Engenheiro',
      approvedAt: 1,
      snapshot: {
        entry: {
          project_name: 'Obra',
          work_date: '2026-11-14',
          weather: 'cloudy',
          workforce_count: 5,
          work_summary: 'Concluído',
        },
        services: [],
        evidence_manifest: [],
      },
    });
    expect(html).toContain('abc123');
    expect(html).toContain('Rafael - Engenheiro');
    expect(html).not.toContain('RASCUNHO');
  });

  it('imprime identificação, clima, efetivo, equipes, recursos e ocorrências', () => {
    const html = buildRdoHtml({
      status: 'approved',
      revision: 4,
      hash: 'abc123',
      approvedBy: 'Rafael - Engenheiro',
      approvedAt: 1,
      snapshot: {
        entry: {
          project_name: 'Obra Alfa',
          work_date: '2026-11-14',
          weather: 'rain',
          weather_notes: 'Chuva das 14h às 16h',
          workforce_count: 9,
          workforce_notes: '2 pedreiros, 6 serventes, 1 encarregado',
          work_summary: 'Alvenaria do térreo',
          equipment: 'Betoneira 400 L',
          materials: '20 sacos de cimento',
          occurrences: 'Parada por chuva',
          safety_notes: 'DDS realizado',
          visitors: 'Fiscalização às 10h',
        },
        services: [{ title: 'Alvenaria', status: 'Em execução' }],
        evidence_manifest: [{ original_name: 'foto.jpg', sha256: 'b'.repeat(64) }],
      },
    });

    expect(html).toContain('Chuva das 14h às 16h');
    expect(html).toContain('2 pedreiros, 6 serventes, 1 encarregado');
    expect(html).toContain('Betoneira 400 L');
    expect(html).toContain('20 sacos de cimento');
    expect(html).toContain('Parada por chuva');
    expect(html).toContain('DDS realizado');
    expect(html).toContain('Fiscalização às 10h');
    expect(html).toContain('Alvenaria');
    expect(html).toContain('b'.repeat(64));
    // Efetivo é impresso como registrado, não convertido.
    expect(html).toContain('<dd>9</dd>');
  });
});
