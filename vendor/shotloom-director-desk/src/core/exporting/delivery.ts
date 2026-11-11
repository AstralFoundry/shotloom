import { download } from '../storage.ts';
import type { ExportJob } from './plan.ts';
import type { ExportDestination } from './batch.ts';

export type SaveMode = 'download' | 'disk';
interface Pickers {
    showSaveFilePicker(options: unknown): Promise<FileSystemFileHandle>;
}
/** Browser-only delivery: save through the File System Access API, or download. */
export async function videoDestination(mode: SaveMode, jobs: ExportJob[]): Promise<ExportDestination> {
    const pickers = window as unknown as Pickers;
    const single =
        mode === 'disk'
            ? await pickers.showSaveFilePicker({
                  suggestedName: jobs[0].filename,
                  types: [
                      {
                          description: '参考视频',
                          accept: {
                              [jobs[0].options.format === 'mp4' ? 'video/mp4' : 'video/webm']: [
                                  '.' + jobs[0].options.format,
                              ],
                          },
                      },
                  ],
              })
            : undefined;
    let actualName = '';
    return {
        async open(job) {
            actualName = single?.name ?? job.filename;
            return single;
        },
        async save(job, blob) {
            if (blob) download(blob, job.filename);
            return actualName;
        },
        async discard() {},
    };
}
