import { useTranslation } from '@/shared/i18n/use-translation.ts';
import './dialogs.css';

const GROUPS: Array<{ title: string; items: Array<[string, string]> }> = [
    {
        title: '通用',
        items: [
            ['空格', '播放 / 暂停'],
            ['Ctrl / ⌘ + Z', '撤销'],
            ['Ctrl / ⌘ + Shift + Z', '重做'],
            ['Ctrl / ⌘ + B', '在播放头分割片段'],
            ['Ctrl / ⌘ + D', '复制选中对象'],
            ['/', '搜索场景对象或资产'],
            ['Delete', '删除选中片段或对象'],
        ],
    },
    {
        title: '对象编辑',
        items: [
            ['1 / 2 / 3', '移动 / 旋转 / 缩放'],
            ['F', '聚焦选中对象'],
        ],
    },
    {
        title: '布景视角 · 先点击布景',
        items: [
            ['W A S D', '前后左右移动'],
            ['Q / E', '左右转向'],
            ['R / F', '上升 / 下降'],
            ['鼠标左拖 / 右拖 / 滚轮', '环绕 / 平移 / 拉近拉远'],
        ],
    },
    {
        title: '时间线 / 走位',
        items: [
            ['拖动片段', '平移动作 / 路径'],
            ['拖动片段右缘', '调整时长'],
            ['点击标尺 / 轨道', '定位播放头'],
            ['Enter / Esc', '完成 / 取消走位绘制'],
        ],
    },
];

/** Static keyboard reference; it only lists shortcuts the React editor actually implements. */
export function HelpPanel() {
    const t = useTranslation();
    return (
        <div className="help-groups">
            <h2>{t('操作与快捷键')}</h2>
            {GROUPS.map((group) => (
                <section className="help-group" key={group.title}>
                    <h3>{t(group.title)}</h3>
                    <div className="help-group__items">
                        {group.items.map(([keys, description]) => (
                            <div className="help-shortcut" key={keys}>
                                <span>{t(description)}</span>
                                {/* Most rows are key glyphs, but mouse gestures ("拖动片段") are
                                    words and need translating too. */}
                                <kbd>{t(keys)}</kbd>
                            </div>
                        ))}
                    </div>
                </section>
            ))}
        </div>
    );
}
