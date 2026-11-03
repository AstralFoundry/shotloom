/**
 * 播放中每一帧的真实指针时间。
 *
 * 它故意不是 zustand 状态：`timeupdate` 由主时钟按动画帧派发，每帧写一次 store
 * 会让整条时间线（所有轨道、片段、胶片带、波形、工具条）跟着重渲染，指针就会一顿一顿的。
 * 视觉指针在自己的 rAF 里读这个值直接写 transform；store 里的 `playheadPosition`
 * 只按 PLAYHEAD_COMMIT_INTERVAL 节流提交，供 React 侧消费者（切分、吸附、
 * 走带跟随、时间码）使用。
 */
export const playheadLiveTime = { seconds: 0 };

/** store 提交的最小间隔（秒）。10Hz 对时间码与滚动跟随足够，比每帧少一个数量级。 */
export const PLAYHEAD_COMMIT_INTERVAL = 0.1;
