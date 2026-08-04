import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, CompositionEvent } from "react";

/**
 * WebKit 在输入法确认候选词的 keydown 上可能只保留 229，
 * 因此不能仅依赖标准的 isComposing 字段判断组合输入。
 */
export function isImeKeyEvent(event: { isComposing?: boolean; keyCode?: number }) {
  return event.isComposing === true || event.keyCode === 229;
}

/**
 * 输入法组合期间由本地草稿驱动受控输入框，避免 React 用旧的
 * store 值覆盖正在输入的拼音。选字完成后再把最终文本写入项目。
 */
export function useImeCommit<T extends HTMLInputElement | HTMLTextAreaElement>(
  value: string,
  commit: (value: string) => void,
) {
  const composing = useRef(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    if (!composing.current) setDraft(value);
  }, [value]);

  return {
    value: draft,
    onCompositionStart: () => {
      composing.current = true;
    },
    onCompositionEnd: (event: CompositionEvent<T>) => {
      composing.current = false;
      const next = event.currentTarget.value;
      setDraft(next);
      commit(next);
    },
    onChange: (event: ChangeEvent<T>) => {
      setDraft(event.target.value);
      if (
        composing.current ||
        (event.nativeEvent as InputEvent).isComposing
      ) return;
      commit(event.target.value);
    },
  };
}
