import { t } from '@/i18n';
export type MediaImportFailure = { key: string; name: string; error: string };
export type MediaBatchResult = { imported: number; failures: MediaImportFailure[] };

/** Import independently, then place successful items in selection order in one transaction. */
export async function importMediaBatch<Input, Imported>(
  inputs: Array<{ key: string; name: string; value: Input }>,
  operations: {
    import: (input: Input) => Promise<Imported>;
    place?: (items: Imported[]) => Promise<void>;
    isLive: () => boolean;
  },
): Promise<MediaBatchResult> {
  const failures: MediaImportFailure[] = [];
  const ready: Array<{ key: string; name: string; item: Imported }> = [];
  for (const input of inputs) {
    try {
      if (!operations.isLive()) throw new Error(t("ui.mediaBatchImport.text.785f6e68"));
      const item = await operations.import(input.value);
      if (!operations.isLive()) throw new Error(t("ui.mediaBatchImport.text.785f6e68"));
      ready.push({ key: input.key, name: input.name, item });
    } catch (cause) {
      failures.push({ key: input.key, name: input.name, error: cause instanceof Error ? cause.message : String(cause) });
    }
  }
  if (ready.length && operations.place) {
    try {
      if (!operations.isLive()) throw new Error(t("ui.mediaBatchImport.text.785f6e68"));
      await operations.place(ready.map((entry) => entry.item));
    } catch (cause) {
      const error = t("ui.mediaBatchImport.text.5e343dea", { value0: cause instanceof Error ? cause.message : String(cause) });
      failures.push(...ready.map(({ key, name }) => ({ key, name, error })));
      return { imported: 0, failures };
    }
  }
  return { imported: ready.length, failures };
}
