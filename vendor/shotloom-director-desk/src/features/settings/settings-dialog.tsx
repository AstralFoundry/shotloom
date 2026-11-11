import { Button, Col, Divider, Modal, Row, Segmented, Select, Slider, Switch } from 'antd';
import { useEffect, useState } from 'react';
import { editorPreferences, preferenceRanges, type PreferenceKey } from '@/core/editor/preferences.ts';
import { DEFAULT_SHOT_BACKGROUND } from '@/core/lighting/model.ts';
import { useTranslation } from '@/shared/i18n/use-translation.ts';
import { getEditorTheme, setEditorTheme, type EditorTheme } from '@/app/providers/theme.ts';
import { usePreferences } from '@/state/use-preferences.ts';
import './settings-dialog.css';

type Category = 'view' | 'editing' | 'layout';

/**
 * Editor preferences.
 *
 * Every control writes straight to `editorPreferences`, which persists and republishes;
 * there is no local draft and no Apply button, so the viewport reflects a change while the
 * dialog is still open. That is the point of these settings — they are all things you tune
 * by looking at the stage.
 */
export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
    const t = useTranslation();
    const preferences = usePreferences();
    const [category, setCategory] = useState<Category>('view');
    const [theme, setTheme] = useState<EditorTheme>(getEditorTheme);

    // The theme can also be changed from the top bar while the dialog is open.
    useEffect(() => {
        if (!open) return;
        setTheme(getEditorTheme());
    }, [open, preferences]);

    const set = <K extends PreferenceKey>(key: K, value: (typeof preferences)[K]) => {
        editorPreferences.set(key, value);
    };

    const applyTheme = (value: EditorTheme) => {
        setTheme(value);
        setEditorTheme(value);
    };

    const categories: Array<{ key: Category; label: string }> = [
        { key: 'view', label: t('操作与视角') },
        { key: 'editing', label: t('编辑辅助') },
        { key: 'layout', label: t('工作区布局') },
    ];

    const slider = (key: PreferenceKey, label: string, step = 0.05, suffix?: string) => {
        const range = preferenceRanges[key]!;
        return (
            <label className="settings-row" key={key}>
                <span className="settings-row__label">
                    {label}
                    <small>
                        {Number(preferences[key]).toFixed(step < 1 ? 2 : 0)}
                        {suffix ?? ''}
                    </small>
                </span>
                <Slider
                    min={range[0]}
                    max={range[1]}
                    step={step}
                    value={Number(preferences[key])}
                    onChange={(value) => set(key, value as never)}
                />
            </label>
        );
    };

    const toggle = (key: PreferenceKey, label: string, hint?: string) => (
        <div className="settings-row settings-row--inline" key={key}>
            <span className="settings-row__label">
                {label}
                {hint ? <small>{hint}</small> : null}
            </span>
            <Switch
                size="small"
                checked={Boolean(preferences[key])}
                onChange={(checked) => set(key, checked as never)}
            />
        </div>
    );

    const choose = (key: PreferenceKey, label: string, options: Array<{ value: string; label: string }>) => (
        <div className="settings-row settings-row--inline" key={key}>
            <span className="settings-row__label">{label}</span>
            <Select
                size="small"
                value={String(preferences[key])}
                onChange={(value) => set(key, value as never)}
                options={options}
                style={{ minWidth: 148 }}
            />
        </div>
    );

    return (
        <Modal open={open} onCancel={onClose} title={t('设置')} width={640} footer={null} className="settings-dialog">
            <div className="settings-split">
                <nav className="settings-nav" aria-label={t('设置分类')}>
                    {categories.map((item) => (
                        <button
                            type="button"
                            key={item.key}
                            className={category === item.key ? 'is-active' : ''}
                            aria-current={category === item.key}
                            onClick={() => setCategory(item.key)}
                        >
                            {item.label}
                        </button>
                    ))}
                </nav>

                <div className="settings-body">
                    {category === 'view' ? (
                        <>
                            <p className="settings-section-title">{t('视角')}</p>
                            {slider('navigationSpeed', t('键盘移动速度 / 米每秒'), 0.1)}
                            {slider('navigationBoost', t('加速倍率 / Shift'), 0.1)}
                            {slider('rotationSpeed', t('旋转灵敏度'), 0.05)}
                            {slider('panSpeed', t('平移灵敏度'), 0.05)}
                            {slider('zoomSpeed', t('滚轮缩放灵敏度'), 0.05)}
                            {toggle('viewDamping', t('视角惯性'))}
                            {toggle('showNavigationHint', t('布景操作提示'))}
                            <Divider plain />
                            <p className="settings-section-title">{t('界面语言')}</p>
                            {choose('previewQuality', t('预览质量'), [
                                { value: 'full', label: t('完整') },
                                { value: 'draft', label: t('草稿 · 更流畅') },
                            ])}
                            <div className="settings-row settings-row--inline">
                                <span className="settings-row__label">{t('界面主题')}</span>
                                <Segmented
                                    size="small"
                                    value={theme}
                                    onChange={(value) => applyTheme(value as EditorTheme)}
                                    options={[
                                        { value: 'dark', label: t('深色') },
                                        { value: 'light', label: t('浅色') },
                                    ]}
                                />
                            </div>
                        </>
                    ) : null}

                    {category === 'editing' ? (
                        <>
                            <p className="settings-section-title">{t('编辑辅助')}</p>
                            {choose('placementSnap', t('网格吸附'), [
                                { value: '0', label: t('网格吸附关') },
                                { value: '0.1', label: t('吸附 0.1m') },
                                { value: '0.5', label: t('吸附 0.5m') },
                                { value: '1', label: t('吸附 1m') },
                            ])}
                            {toggle('objectSnap', t('物体吸附'), t('拖动道具时贴合附近表面与边界'))}
                            {slider('gizmoSize', t('变换手柄大小'), 0.02)}
                            <Divider plain />
                            <p className="settings-section-title">{t('机位取景辅助')}</p>
                            {toggle('showThirds', t('三分线'))}
                            {toggle('showCenterCross', t('中心十字'))}
                            {toggle('showSafeArea', t('安全框'))}
                            {toggle('showPreviousShot', t('上一镜构图叠加'))}
                            <Divider plain />
                            <p className="settings-section-title">{t('对象标签')}</p>
                            {choose('labelMode', t('对象标签显示'), [
                                { value: 'off', label: t('关闭') },
                                { value: 'selected', label: t('仅选中对象') },
                                { value: 'all', label: t('全部对象') },
                            ])}
                        </>
                    ) : null}

                    {category === 'layout' ? (
                        <>
                            <p className="settings-section-title">{t('工作区布局')}</p>
                            <p className="settings-hint">{t('拖动面板边缘即可调整宽高，双击手柄可恢复默认值。')}</p>
                            <Row gutter={12} className="settings-metrics">
                                <Col span={8}>
                                    <span>{t('左侧资源栏宽度')}</span>
                                    <strong>{preferences.sidebarWidth ?? t('自适应')}</strong>
                                </Col>
                                <Col span={8}>
                                    <span>{t('右侧属性栏宽度')}</span>
                                    <strong>{preferences.inspectorWidth ?? t('自适应')}</strong>
                                </Col>
                                <Col span={8}>
                                    <span>{t('时间轴高度')}</span>
                                    <strong>{preferences.timelineHeight ?? t('自适应')}</strong>
                                </Col>
                            </Row>
                            <div className="settings-actions">
                                <Button size="small" onClick={() => editorPreferences.resetLayout()}>
                                    {t('重置布局')}
                                </Button>
                                <Button
                                    size="small"
                                    danger
                                    onClick={() => {
                                        editorPreferences.reset();
                                        applyTheme('dark');
                                    }}
                                >
                                    {t('恢复操作偏好默认值')}
                                </Button>
                            </div>
                            <Divider plain />
                            <p className="settings-section-title">{t('首选项存储')}</p>
                            <p className="settings-hint">{t('这些偏好在本地保存，不写入工程文件。')}</p>
                            <p className="settings-hint">
                                {t('机位视角背景沿用工程环境色')}：{DEFAULT_SHOT_BACKGROUND}
                            </p>
                        </>
                    ) : null}
                </div>
            </div>
        </Modal>
    );
}
