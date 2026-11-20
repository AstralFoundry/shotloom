import { InboxOutlined } from '@ant-design/icons';
import { Alert, Button, Col, ConfigProvider, Input, InputNumber, Modal, Row, Select, Upload, type ThemeConfig } from 'antd';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { reportHostModelImport } from '@/app/host-bridge.ts';
import { type Vec3 } from '@/core/model.ts';
import { packModelFilesAsync } from '@/core/resources/model-import-worker.ts';
import { modelResourceId, type ModelResource } from '@/core/resources/project-resources.ts';
import type { SceneModels } from '@/core/resources/scene-models.ts';
import { useTranslation } from '@/shared/i18n/use-translation.ts';
import { notifyError, notifySuccess } from '@/shared/ui/feedback.ts';
import { session } from '@/state/editor-session.ts';
import { inspectImportedModel, placeImportedModel, pruneImportedModels } from './import-model.ts';

type Inspection = ReturnType<SceneModels['inspection']>;

interface PlacementForm {
    name: string;
    kind: 'prop' | 'actor';
    appearance: 'original' | 'white' | 'color';
    units: string;
    up: string;
    facing: number;
    license: string;
    source: string;
}

const MODEL_EXTENSION = /\.(glb|gltf|fbx|obj)$/i;
const filePath = (file: File) => (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
const importControlSize = { height: 40, fontSize: 14 };
const importActionStyle = { ...importControlSize, paddingInline: 20 };
const mainFileSelectTheme: ThemeConfig = {
    components: {
        Select: {
            controlHeight: importControlSize.height,
            fontSize: importControlSize.fontSize,
            optionHeight: importControlSize.height,
            optionFontSize: importControlSize.fontSize,
        },
    },
};

/**
 * Import GLB / glTF / FBX / OBJ with their sidecar files.
 *
 * Two steps: collect files and pack/parse them in the worker, then choose how the model is
 * placed (kind, appearance, unit/orientation correction) before it becomes an entity.
 */
export function ModelImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
    const t = useTranslation();
    const [files, setFiles] = useState<File[]>([]);
    const [entry, setEntry] = useState('');
    const [step, setStep] = useState<'pick' | 'place'>('pick');
    const [resource, setResource] = useState<ModelResource | null>(null);
    const [inspection, setInspection] = useState<Inspection | null>(null);
    const [size, setSize] = useState<Vec3 | null>(null);
    const [reading, setReading] = useState(false);
    const [error, setError] = useState('');
    const [form, setForm] = useState<PlacementForm>({
        name: '',
        kind: 'prop',
        appearance: 'original',
        units: '1',
        up: '0',
        facing: 0,
        license: '',
        source: '',
    });
    const abortRef = useRef<AbortController | null>(null);
    const placedRef = useRef(false);

    useLayoutEffect(() => {
        if (!open) return;
        reportHostModelImport(true);
        return () => reportHostModelImport(false);
    }, [open]);

    const entries = files.map(filePath).filter((path) => MODEL_EXTENSION.test(path));

    const prune = pruneImportedModels;

    const addFiles = (incoming: File[]) => {
        setFiles((previous) => {
            const map = new Map(previous.map((file) => [filePath(file), file]));
            for (const file of incoming) map.set(filePath(file), file);
            const next = [...map.values()];
            const nextEntries = next.map(filePath).filter((path) => MODEL_EXTENSION.test(path));
            setEntry((current) => (nextEntries.includes(current) ? current : (nextEntries[0] ?? '')));
            return next;
        });
    };

    const orientation = (): Vec3 => [(Number(form.up) * Math.PI) / 180, (Number(form.facing) * Math.PI) / 180, 0];

    useEffect(() => {
        if (step !== 'place' || !resource) return;
        const engine = session.engineOrNull;
        if (!engine) return;
        try {
            setSize(engine.externalModels.measure(resource, Number(form.units), orientation()));
        } catch {
            /* keep the last measured size */
        }
    }, [step, resource, form.units, form.up, form.facing]);

    const close = () => {
        abortRef.current?.abort();
        if (step === 'place' && !placedRef.current) prune();
        setFiles([]);
        setEntry('');
        setStep('pick');
        setResource(null);
        setInspection(null);
        setSize(null);
        setError('');
        setReading(false);
        placedRef.current = false;
        onClose();
    };

    async function readModel() {
        const engine = session.engineOrNull;
        if (!engine || reading) return;
        if (!entry) {
            setError(t('请先选择模型主文件'));
            return;
        }
        abortRef.current?.abort();
        prune();
        const controller = new AbortController();
        abortRef.current = controller;
        const original = session.project;
        setReading(true);
        setError('');
        session.setBusy(true);
        try {
            const source: Array<{ path: string; bytes: Uint8Array }> = [];
            for (const file of files) {
                controller.signal.throwIfAborted();
                source.push({ path: filePath(file), bytes: new Uint8Array(await file.arrayBuffer()) });
            }
            const pack = await packModelFilesAsync(entry, source, controller.signal);
            const nextResource = { id: await modelResourceId(pack, controller.signal), name: entry.split('/').at(-1)!.replace(MODEL_EXTENSION, ''), package: pack, copyright: '', license: '', source: '' };
            if (session.project !== original) throw Error('读取期间工程已变化，请重新导入');
            const { inspection: info, size: measured } = await inspectImportedModel(nextResource, controller.signal);
            setResource(nextResource);
            setInspection(info);
            setSize(measured);
            setForm((current) => ({
                ...current,
                name: nextResource.name,
                kind: info.skins ? 'actor' : 'prop',
                license: nextResource.license,
                source: nextResource.source,
            }));
            setStep('place');
        } catch (cause) {
            prune();
            if ((cause as Error).name !== 'AbortError') setError((cause as Error).message);
        } finally {
            abortRef.current = null;
            setReading(false);
            session.setBusy(false);
        }
    }

    function place() {
        const engine = session.engineOrNull;
        if (!engine || !resource) return;
        resource.license = form.license;
        resource.source = form.source;
        try {
            placeImportedModel(resource, { name: form.name, kind: form.kind, appearance: form.appearance, unitScale: Number(form.units), orientation: orientation() });
        } catch (cause) {
            notifyError((cause as Error).message);
            prune();
            return;
        }
        placedRef.current = true;
        notifySuccess('模型已添加');
        close();
    }

    const description = inspection
        ? [
              `${inspection.meshes} ${t('个网格')}`,
              inspection.bones.length ? `${inspection.bones.length} ${t('个骨骼')}` : '',
              `${inspection.animations.length} ${t('段动画')}`,
          ]
              .filter(Boolean)
              .join(' · ')
        : '';

    return (
        <Modal
            open={open}
            title={t('导入模型')}
            width={640}
            mask={{ closable: !reading }}
            closable={!reading}
            onCancel={() => {
                if (!reading) close();
            }}
            footer={
                step === 'pick' ? (
                    <>
                        <Button style={importActionStyle} onClick={close} disabled={reading}>
                            {t('取消')}
                        </Button>
                        <Button style={importActionStyle} type="primary" loading={reading} disabled={!entry} onClick={() => void readModel()}>
                            {t('读取模型')}
                        </Button>
                    </>
                ) : (
                    <>
                        <Button style={importActionStyle} onClick={() => setStep('pick')}>
                            {t('返回')}
                        </Button>
                        <Button style={importActionStyle} type="primary" onClick={place}>
                            {t('放入场景')}
                        </Button>
                    </>
                )
            }
        >
            {step === 'pick' ? (
                <div className="stack">
                    <Alert
                        type="info"
                        showIcon
                        title={t('支持 GLB、glTF、FBX、OBJ')}
                        description={t('请同时选择关联 BIN、MTL 和贴图，或选择包含它们的文件夹。')}
                    />
                    <Row gutter={8}>
                        <Col span={12}>
                            <Upload
                                multiple
                                showUploadList={false}
                                beforeUpload={(file) => {
                                    addFiles([file as File]);
                                    return false;
                                }}
                            >
                                <Button block style={importActionStyle} icon={<InboxOutlined />}>
                                    {t('选择文件')}
                                </Button>
                            </Upload>
                        </Col>
                        <Col span={12}>
                            <Upload
                                directory
                                multiple
                                showUploadList={false}
                                beforeUpload={(file) => {
                                    addFiles([file as File]);
                                    return false;
                                }}
                            >
                                <Button block style={importActionStyle} icon={<InboxOutlined />}>
                                    {t('选择文件夹')}
                                </Button>
                            </Upload>
                        </Col>
                    </Row>
                    <label className="export-field">
                        <span>{t('模型主文件')}</span>
                        <ConfigProvider theme={mainFileSelectTheme}>
                            <Select
                                value={entry || undefined}
                                placeholder={entries.length ? t('选择主文件') : t('先选择文件')}
                                onChange={(value) => setEntry(value)}
                                options={entries.map((path) => ({ value: path, label: path }))}
                            />
                        </ConfigProvider>
                    </label>
                    <p className="muted small">
                        {t('已选择')} {files.length} {t('个文件')}
                    </p>
                    {error ? <Alert type="error" showIcon title={error} /> : null}
                </div>
            ) : (
                <div className="stack">
                    <Row gutter={8}>
                        <Col span={12}>
                            <label className="export-field">
                                <span>{t('名称')}</span>
                                <Input
                                    value={form.name}
                                    maxLength={80}
                                    onChange={(event) => setForm({ ...form, name: event.target.value })}
                                />
                            </label>
                        </Col>
                        <Col span={12}>
                            <label className="export-field">
                                <span>{t('用途')}</span>
                                <Select<'prop' | 'actor'>
                                    value={form.kind}
                                    onChange={(kind) => setForm({ ...form, kind })}
                                    options={[
                                        { value: 'prop', label: t('家具／道具／建筑') },
                                        ...(inspection?.skins ? [{ value: 'actor' as const, label: t('人物') }] : []),
                                    ]}
                                />
                            </label>
                        </Col>
                    </Row>
                    <Row gutter={8}>
                        <Col span={12}>
                            <label className="export-field">
                                <span>{t('显示方式')}</span>
                                <Select
                                    value={form.appearance}
                                    onChange={(appearance) => setForm({ ...form, appearance })}
                                    options={[
                                        { value: 'original', label: t('原材质') },
                                        { value: 'white', label: t('白模') },
                                        { value: 'color', label: t('识别色') },
                                    ]}
                                />
                            </label>
                        </Col>
                        <Col span={12}>
                            <label className="export-field">
                                <span>{t('校正单位')}</span>
                                <Select
                                    value={form.units}
                                    onChange={(units) => setForm({ ...form, units })}
                                    options={[
                                        { value: '1', label: t('米') },
                                        { value: '0.01', label: t('厘米') },
                                        { value: '0.001', label: t('毫米') },
                                        { value: '0.0254', label: t('英寸') },
                                    ]}
                                />
                            </label>
                        </Col>
                    </Row>
                    <Row gutter={8}>
                        <Col span={12}>
                            <label className="export-field">
                                <span>{t('校正向上轴')}</span>
                                <Select
                                    value={form.up}
                                    onChange={(up) => setForm({ ...form, up })}
                                    options={[
                                        { value: '0', label: '+Y' },
                                        { value: '-90', label: '+Z' },
                                        { value: '90', label: '−Z' },
                                        { value: '180', label: '−Y' },
                                    ]}
                                />
                            </label>
                        </Col>
                        <Col span={12}>
                            <label className="export-field">
                                <span>{t('朝向校正 / 度')}</span>
                                <InputNumber
                                    value={form.facing}
                                    step={90}
                                    style={{ width: '100%' }}
                                    onChange={(value) => setForm({ ...form, facing: Number(value) || 0 })}
                                />
                            </label>
                        </Col>
                    </Row>
                    <p className="muted small">
                        {description}
                        {size
                            ? ` · ${t('宽')} ${size[0].toFixed(3)} × ${t('高')} ${size[1].toFixed(3)} × ${t('深')} ${size[2].toFixed(3)} m`
                            : ''}
                    </p>
                    <Row gutter={8}>
                        <Col span={12}>
                            <label className="export-field">
                                <span>{t('许可备注')}</span>
                                <Input
                                    value={form.license}
                                    maxLength={1000}
                                    onChange={(event) => setForm({ ...form, license: event.target.value })}
                                />
                            </label>
                        </Col>
                        <Col span={12}>
                            <label className="export-field">
                                <span>{t('来源备注')}</span>
                                <Input
                                    value={form.source}
                                    maxLength={1000}
                                    onChange={(event) => setForm({ ...form, source: event.target.value })}
                                />
                            </label>
                        </Col>
                    </Row>
                    {error ? <Alert type="error" showIcon title={error} /> : null}
                </div>
            )}
        </Modal>
    );
}
