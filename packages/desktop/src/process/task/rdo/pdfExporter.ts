export type PdfPage = {
  loadHtml(html: string): Promise<void>;
  printToPdf(): Promise<Uint8Array>;
  destroy(): void;
};

export type RdoPdfExporter = { export(html: string): Promise<Uint8Array> };

export function createRdoPdfExporter(createPage: () => PdfPage): RdoPdfExporter {
  let queue = Promise.resolve();
  return {
    export(html) {
      const run = async () => {
        const page = createPage();
        try {
          await page.loadHtml(html);
          return await page.printToPdf();
        } finally {
          page.destroy();
        }
      };
      const result = queue.then(run, run);
      queue = result.then((): void => undefined, (): void => undefined);
      return result;
    },
  };
}
