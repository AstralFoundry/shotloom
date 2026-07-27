import {
  checkForUpdate,
  downloadUpdate,
  executeUpdateRestart,
  updateStore,
} from "../../store/updateStore.js";
import type {
  UpdateDialogController,
  UpdateDialogData,
} from "../components/UpdateDialog";

export function updateDialogData(): UpdateDialogData & {
  open: boolean;
  checking: boolean;
} {
  const info = updateStore.info as UpdateDialogData["info"];
  const progress = updateStore.progress as UpdateDialogData["progress"];
  return {
    open: Boolean(updateStore.dialogOpen),
    checking: Boolean(updateStore.checking),
    phase: updateStore.phase,
    info: info ? { ...info } : null,
    progress: progress ? { ...progress } : null,
    error: updateStore.error || "",
  };
}

export const updateDialogController: UpdateDialogController = {
  close() {
    if (
      (updateStore.info as UpdateDialogData["info"])?.forceUpdate ||
      updateStore.phase === "downloading"
    ) return;
    updateStore.dialogOpen = false;
  },
  async check() {
    await checkForUpdate({ openWhenNone: true });
  },
  async download() {
    await downloadUpdate();
  },
  async installAndRestart() {
    await executeUpdateRestart();
  },
};
