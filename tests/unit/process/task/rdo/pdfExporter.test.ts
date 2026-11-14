import { describe, expect, it, vi } from 'vitest';
import { createRdoPdfExporter } from '@process/task/rdo/pdfExporter';

describe('RDO PDF exporter', () => {
  it('destroys the isolated page after success and failure', async () => {
    const destroy = vi.fn();
    const exporter = createRdoPdfExporter(() => ({
      loadHtml: async () => undefined,
      printToPdf: async () => new Uint8Array([1, 2, 3]),
      destroy,
    }));
    await expect(exporter.export('<html></html>')).resolves.toEqual(new Uint8Array([1, 2, 3]));
    expect(destroy).toHaveBeenCalledOnce();

    const failedDestroy = vi.fn();
    const failed = createRdoPdfExporter(() => ({
      loadHtml: async () => undefined,
      printToPdf: async () => {
        throw new Error('print failed');
      },
      destroy: failedDestroy,
    }));
    await expect(failed.export('<html></html>')).rejects.toThrow('print failed');
    expect(failedDestroy).toHaveBeenCalledOnce();
  });
});
