import { t } from '@/i18n';
import { type MouseEvent, useRef, useState } from 'react';
import { App, Button, Dropdown, Input, Modal, type InputRef, type MenuProps } from 'antd';
import { ContextMenu } from '../components/ContextMenu';
import { IconSymbol } from '../components/IconSymbol';
import type { MaterialItem } from '../components/MaterialGrid';
import { AssetLibraryBrowser, type AssetLibraryScope, type AssetLibrarySelection } from '../components/AssetLibraryBrowser';
import { assetCategories } from '../../domain/asset/assetCategories';
import { useAppStore } from '../store/appStore';

export interface AssetsController {
  preview: (item: MaterialItem, src: string, kind: "image" | "video") => void;
  showFile: (item: MaterialItem) => void | Promise<void>;
  rename: (
    item: MaterialItem,
    name: string,
  ) => boolean | void | Promise<boolean | void>;
  deleteProjectAsset: (item: MaterialItem) => boolean | void | Promise<boolean | void>;
  deleteLocalAsset: (
    item: MaterialItem,
  ) => boolean | void | Promise<boolean | void>;
  promoteLocal: (item: MaterialItem) => void | Promise<void>;
  referenceProject: (item: MaterialItem) => void | Promise<void>;
  copyProject: (item: MaterialItem) => void | Promise<void>;
  openLocalStorage: () => void | Promise<void>;
  importPackage: () => void | Promise<void>;
  exportPackage: () => void | Promise<void>;
  exportSelected: (items: MaterialItem[]) => void | Promise<void>;
  moveProjectAssets: (items: MaterialItem[], category: string) => void | Promise<void>;
  importFiles: () => void | Promise<void>;
}

export function AssetsView({ projectAssets, localAssets, controller }: {
  projectAssets: MaterialItem[]; localAssets: MaterialItem[]; assetMaterialIds: Set<string>; controller: AssetsController;
}) {
  const { modal } = App.useApp();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [renameItem, setRenameItem] = useState<MaterialItem | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const renameInput = useRef<InputRef>(null);
  const setRoute = useAppStore(state => state.setRoute);
  async function confirmRename() {
    if (!renameItem) return;
    if (await controller.rename(renameItem, renameDraft) !== false) setRenameItem(null);
  }
  function remove(selection: AssetLibrarySelection[]) {
    modal.confirm({
      title: t('ui.AssetsView.text.cf156401', { value0: selection.length }),
      okButtonProps: { danger: true },
      onOk: async () => {
        for (const { item, scope } of selection) {
          await (scope === 'library' ? controller.deleteProjectAsset(item) : controller.deleteLocalAsset(item));
        }
      },
    });
  }
  function action(name: string, item: MaterialItem, scope: AssetLibraryScope) {
    if (name === 'show-file') void controller.showFile(item);
    if (name === 'promote-local') void controller.promoteLocal(item);
    if (name === 'copy-project') void controller.copyProject(item);
    if (name === 'rename-item') { setRenameItem(item); setRenameDraft(String(item.name || '')); }
    if (name === 'delete-item') remove([{ item, scope }]);
  }
  const menuItems: MenuProps['items'] = [
    { key: 'materials', label: t('ui.AssetsView.text.bab3c9ce') },
    { key: 'import-files', label: t('ui.AssetsView.text.f1d24597') },
    { key: 'import-package', label: t('ui.AssetsView.text.3f035ce8') },
    { key: 'export-package', label: t('ui.AssetsView.text.ca8c07de') },
    { key: 'open-local', label: t('ui.AssetsView.text.6521c13f') },
  ];
  function onMenuClick(key: string) {
    setMenu(null);
    if (key === 'materials') setRoute('materials');
    if (key === 'import-files') void controller.importFiles();
    if (key === 'import-package') void controller.importPackage();
    if (key === 'export-package') void controller.exportPackage();
    if (key === 'open-local') void controller.openLocalStorage();
  }
  function openMenu(event: MouseEvent<HTMLDivElement>) {
    if ((event.target as Element).closest('.material-node-wrap, .ant-dropdown')) return;
    event.preventDefault(); setMenu({ x: event.clientX, y: event.clientY });
  }
  return <>
    <div className="asset-library-page" onContextMenu={openMenu}>
      <AssetLibraryBrowser sources={[
        { id: 'library', label: t('ui.ProjectSearch.text.96cb64ae'), icon: 'folder', items: projectAssets },
        { id: 'local', label: t('ui.CreationView.text.d2199cbf'), icon: 'archive', items: localAssets },
      ]} onPreview={controller.preview} onAction={action} onImport={controller.importFiles}
        headerActions={<Dropdown menu={{ items: menuItems, onClick: ({ key }) => onMenuClick(key) }}><Button type="text" aria-label={t('assets.browser.actions')} icon={<IconSymbol name="more" />} /></Dropdown>}
        selectionActions={selection => selection.length ? <>
          <Button onClick={() => void controller.exportSelected(selection.map(entry => entry.item))}>{t('ui.MediaViewer.text.2b9d0131')}</Button>
          {selection.every(entry => entry.scope === 'library') && <Dropdown menu={{ items: assetCategories.map(category => ({ key: category.id, label: category.label })), onClick: ({ key }) => void controller.moveProjectAssets(selection.map(entry => entry.item), key) }}><Button>{t('ui.AssetsView.text.48df919a')}</Button></Dropdown>}
          <Button danger onClick={() => remove(selection)}>{t('ui.MaterialGrid.title.3755f56f')}</Button>
        </> : null}
      />
      <ContextMenu point={menu} items={menuItems} onSelect={onMenuClick} onClose={() => setMenu(null)} />
    </div>
      <Modal
        open={Boolean(renameItem)}
        centered
        width={430}
        title={t("ui.AssetsView.text.29e63aed")}
        okText={t("ui.MediaViewer.text.fadf24db")}
        cancelText={t("ui.ImageWatermarkEditor.text.4d0b4688")}
        onCancel={() => {
          setRenameItem(null);
          setRenameDraft("");
        }}
        onOk={() => void confirmRename()}
        afterOpenChange={(open) => {
          if (open) renameInput.current?.focus();
        }}
      >
        {renameItem && (
          <div className="rename-dialog-body">
            <p className="rename-dialog-current">{renameItem.name || t("ui.canvasMediaSelection.text.b61b7f74")}</p>
            <Input
              ref={renameInput}
              value={renameDraft}
              onChange={(event) => setRenameDraft(event.target.value)}
              placeholder={t("ui.AssetsView.placeholder.a7426356")}
              onPressEnter={() => void confirmRename()}
            />
          </div>
        )}
      </Modal>
  </>;
}
