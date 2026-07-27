import { showToast as showReactToast } from '@/app/store/overlayStore';

/**
 * 显示全局 toast 通知，2.4 秒后自动消失。
 * 可在任何位置独立调用，无需组件上下文。
 * @param {string} message - 要显示的提示文本
 */
export function showToast(message) {
  showReactToast(message);
}
