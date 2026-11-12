import { AimOutlined, CaretRightOutlined, FileTextOutlined, StopOutlined } from '@ant-design/icons';
import { Alert, Button, Empty, Progress, Segmented, Select, Space, Switch, Tooltip } from 'antd';
import { useMemo, useRef, useState } from 'react';
import { spatialReportJson, spatialReportText, type SpatialIssue } from '@/core/spatial/checks.ts';
import { timecode } from '@/shared/lib/format.ts';
import { download } from '@/core/storage.ts';
import { notify, notifyError } from '@/shared/ui/feedback.ts';
import { useTranslation } from '@/shared/i18n/use-translation.ts';
import { NumberField } from '@/shared/ui/number-field.tsx';
import { session } from '@/state/editor-session.ts';
import { useEditorStore } from '@/state/editor-store.ts';
import { useProject } from '@/state/use-editor.ts';
import './spatial-check.css';

interface Report {
    issues: SpatialIssue[];
    truncated: boolean;
    samples: number;
    range: { start: number; end: number };
}

/**
 * Time-range spatial check.
 *
 * Composition errors that a still frame hides — two actors occupying the same floor space, a
 * character drifting out of the shot, a stand-in standing inside a wall — are cheap to detect
 * by sampling the real scene and expensive to notice by scrubbing frame by frame. Results are
 * a jump-list: every row seeks the playhead and selects the entities involved.
 */
export function SpatialCheckPanel() {
    const t = useTranslation();
    const project = useProject();
    const playhead = useEditorStore((state) => state.time);
    const cameras = useMemo(() => project.entities.filter((entity) => entity.kind === 'camera'), [project]);
    const [start, setStart] = useState(0);
    const [end, setEnd] = useState(project.duration);
    const [sampleRate, setSampleRate] = useState(4);
    const [cameraId, setCameraId] = useState('program');
    const [includeObstacles, setIncludeObstacles] = useState(true);
    const [includeFraming, setIncludeFraming] = useState(true);
    const [running, setRunning] = useState(false);
    const [progress, setProgress] = useState(0);
    const [report, setReport] = useState<Report | null>(null);
    const abortRef = useRef<AbortController | null>(null);

    const run = async () => {
        if (!session.engineOrNull || running) return;
        setRunning(true);
        setProgress(0);
        setReport(null);
        const controller = new AbortController();
        abortRef.current = controller;
        try {
            // Go through the session, not the sampler directly: the session holds the renderer
            // lease, so this sweep cannot interleave with thumbnails or an export.
            const result = await session.runSpatialCheck(
                {
                    start,
                    end,
                    sampleRate,
                    cameraId,
                    includeObstacles,
                    includeFraming,
                },
                controller.signal,
                setProgress,
            );
            setReport({ ...result, range: { start, end } });
            if (!result.issues.length) notify(t('此采样范围内未发现待确认情况'));
        } catch (error) {
            if ((error as Error).name === 'AbortError') notify(t('已取消，工程和播放位置保持原状。'));
            else notifyError((error as Error).message);
        } finally {
            abortRef.current = null;
            setRunning(false);
        }
    };

    const cancel = () => abortRef.current?.abort();

    const exportReport = (format: 'json' | 'txt') => {
        if (!report) return;
        const text =
            format === 'json'
                ? spatialReportJson(report.issues, project, report.range)
                : spatialReportText(report.issues, project, report.range);
        const type = format === 'json' ? 'application/json' : 'text/plain';
        download(new Blob([text], { type }), `${project.name}-空间检查.${format}`);
    };

    const jump = (issue: SpatialIssue) => {
        session.seek(issue.time);
        if (issue.ids.length) session.selectEntity(issue.ids[0], true);
    };

    const label = (kind: SpatialIssue['kind']) =>
        kind === 'overlap'
            ? t('身体或对象相交')
            : kind === 'crowd'
              ? t('距离过近')
              : kind === 'outOfFrame'
                ? t('不在画面内')
                : kind === 'cameraInSolid'
                  ? t('机位在物体内部')
                  : kind === 'unsupported'
                    ? t('悬空')
                    : t('被遮挡');

    return (
        <div className="spatial-check">
            <div className="spatial-check__form">
                <label className="field-row">
                    <span className="field-row__label">{t('检查一段时间')}</span>
                    <Space.Compact block>
                        <NumberField
                            value={start}
                            min={0}
                            max={project.duration}
                            step={0.5}
                            precision={2}
                            aria-label={t('开始 / 秒')}
                            onCommit={setStart}
                        />
                        <NumberField
                            value={end}
                            min={0}
                            max={project.duration}
                            step={0.5}
                            precision={2}
                            aria-label={t('结束 / 秒')}
                            onCommit={setEnd}
                        />
                    </Space.Compact>
                </label>

                <div className="button-row">
                    <Button
                        size="small"
                        disabled={running}
                        onClick={() => {
                            setStart(0);
                            setEnd(project.duration);
                        }}
                    >
                        {t('整场')}
                    </Button>
                    <Button
                        size="small"
                        disabled={running}
                        onClick={() => {
                            setStart(Math.max(0, playhead - 2));
                            setEnd(Math.min(project.duration, playhead + 2));
                        }}
                    >
                        {t('播放头前后 2 秒')}
                    </Button>
                </div>

                <label className="field-row">
                    <span className="field-row__label">{t('采样密度')}</span>
                    <Segmented
                        size="small"
                        block
                        value={String(sampleRate)}
                        disabled={running}
                        onChange={(value) => setSampleRate(Number(value))}
                        options={[
                            { value: '2', label: t('稀疏 · 快') },
                            { value: '4', label: t('标准') },
                            { value: '10', label: t('密集 · 慢') },
                        ]}
                    />
                </label>

                <label className="field-row">
                    <span className="field-row__label">{t('检查机位')}</span>
                    <Select
                        size="small"
                        value={cameraId}
                        disabled={running}
                        aria-label={t('检查机位')}
                        onChange={setCameraId}
                        options={[
                            { value: 'program', label: t('按切镜') },
                            ...cameras.map((camera) => ({ value: camera.id, label: camera.name })),
                        ]}
                    />
                </label>

                <div className="field-row field-row--inline">
                    <span className="field-row__label">{t('同时检查与道具、墙体的相交')}</span>
                    <Switch size="small" checked={includeObstacles} disabled={running} onChange={setIncludeObstacles} />
                </div>
                <div className="field-row field-row--inline">
                    <span className="field-row__label">{t('同时检查是否在画面内')}</span>
                    <Switch size="small" checked={includeFraming} disabled={running} onChange={setIncludeFraming} />
                </div>
            </div>

            <div className="button-row">
                {running ? (
                    <Button size="small" danger icon={<StopOutlined />} onClick={cancel}>
                        {t('取消检查')}
                    </Button>
                ) : (
                    <Button size="small" type="primary" icon={<CaretRightOutlined />} onClick={() => void run()}>
                        {t('开始检查')}
                    </Button>
                )}
            </div>

            {running ? <Progress percent={Math.round(progress * 100)} size="small" /> : null}

            {report ? (
                <div className="spatial-check__result">
                    {report.truncated ? (
                        <Alert type="warning" showIcon title={t('结果达到上限，请缩小范围重查。')} />
                    ) : null}
                    <div className="spatial-check__summary">
                        <span>
                            {report.samples} {t('个采样')} · {report.issues.length} {t('项')}
                        </span>
                        <span className="spatial-check__export">
                            <Tooltip title={t('导出完整 JSON')}>
                                <Button
                                    size="small"
                                    type="text"
                                    icon={<FileTextOutlined />}
                                    aria-label={t('导出完整 JSON')}
                                    onClick={() => exportReport('json')}
                                />
                            </Tooltip>
                            <Tooltip title={t('导出完整 TXT')}>
                                <Button size="small" type="text" onClick={() => exportReport('txt')}>
                                    TXT
                                </Button>
                            </Tooltip>
                        </span>
                    </div>
                    {report.issues.length ? (
                        <ul className="spatial-check__list">
                            {report.issues.map((issue, index) => (
                                <li key={`${issue.kind}-${issue.ids.join('-')}-${index}`}>
                                    <button
                                        type="button"
                                        className={`spatial-issue spatial-issue--${issue.severity}`}
                                        onClick={() => jump(issue)}
                                    >
                                        <span className="spatial-issue__time">{timecode(issue.time, project.fps)}</span>
                                        <span className="spatial-issue__kind">{label(issue.kind)}</span>
                                        <span className="spatial-issue__message">{issue.message}</span>
                                        <AimOutlined className="spatial-issue__jump" />
                                    </button>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('此采样范围内未发现待确认情况')} />
                    )}
                    <p className="muted small">{t('检查完成，可定位后修改并重新检查。')}</p>
                </div>
            ) : null}
        </div>
    );
}
