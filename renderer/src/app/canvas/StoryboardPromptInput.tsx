import { useId, useRef, useState } from 'react';
import { Input } from 'antd';
import type { TextAreaRef } from 'antd/es/input/TextArea';
import { t } from '@/i18n';
import { insertStoryboardContextMention, storyboardContextReferences } from '@/services/storyboardScriptService';
import { IconSymbol } from '../components/IconSymbol';

type Mention = { start: number; end: number; query: string };

function readMention(text: string, start: number, end: number): Mention | null {
  if (start === 0 || start !== end) return null;
  const at = text.lastIndexOf('@', start - 1);
  const query = text.slice(at + 1, start);
  if (at < 0 || (at > 0 && /[\w.@]/u.test(text[at - 1] || '')) || /[\s@，。！？、,]/u.test(query)) return null;
  return { start: at, end, query };
}

export function StoryboardPromptInput({ nodeId, value, disabled, onChange, onSubmit }: {
  nodeId: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
}) {
  const textarea = useRef<TextAreaRef>(null);
  const composing = useRef(false);
  const [mention, setMention] = useState<Mention | null>(null);
  const [selection, setSelection] = useState(0);
  const listId = useId();
  const query = mention?.query.toLocaleLowerCase() || '';
  const choices = mention && !disabled ? storyboardContextReferences(nodeId).filter((item) =>
    [item.name, item.alias].some((text) => text?.toLocaleLowerCase().includes(query))) : [];
  const selected = Math.min(selection, Math.max(0, choices.length - 1));

  function syncMention(element: HTMLTextAreaElement) {
    if (composing.current || disabled) return;
    setMention(readMention(element.value, element.selectionStart, element.selectionEnd));
    setSelection(0);
  }

  function choose(sourceId: string) {
    if (!mention) return;
    const applied = insertStoryboardContextMention(nodeId, sourceId, mention.start, mention.end);
    setMention(null);
    if (!applied) return;
    const element = textarea.current?.resizableTextArea?.textArea;
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(applied.caret, applied.caret);
    });
  }

  return (
    <div className="storyboard-mention-box">
      <Input.TextArea
        ref={textarea}
        value={value}
        readOnly={disabled}
        autoSize={{ minRows: 2, maxRows: 4 }}
        placeholder={t('canvas.storyboard.composerPlaceholder')}
        aria-label={t('canvas.storyboard.sourceLabel')}
        aria-controls={mention ? listId : undefined}
        aria-activedescendant={mention && choices.length ? `${listId}-${selected}` : undefined}
        onCompositionStart={() => { composing.current = true; setMention(null); }}
        onCompositionEnd={(event) => { composing.current = false; syncMention(event.currentTarget); }}
        onChange={(event) => { onChange(event.target.value); syncMention(event.currentTarget); }}
        onSelect={(event) => syncMention(event.currentTarget)}
        onBlur={() => setMention(null)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || composing.current) return;
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            setMention(null);
            onSubmit();
            return;
          }
          if (!mention) return;
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            setMention(null);
          } else if (choices.length && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
            event.preventDefault();
            setSelection((selected + (event.key === 'ArrowDown' ? 1 : choices.length - 1)) % choices.length);
          } else if (choices[selected] && (event.key === 'Enter' || event.key === 'Tab')) {
            event.preventDefault();
            choose(choices[selected].id);
          }
        }}
      />
      {mention && !disabled ? (
        <div className="storyboard-mention-menu" id={listId} role="listbox" aria-label={t('canvas.storyboard.contextReferences')}>
          {choices.length ? choices.map((reference, index) => (
            <button key={reference.id} id={`${listId}-${index}`} type="button" role="option" tabIndex={-1}
              aria-selected={selected === index} onMouseDown={(event) => event.preventDefault()}
              onClick={(event) => { event.stopPropagation(); choose(reference.id); }}>
              <IconSymbol name={reference.kind === 'text' ? 'text' : 'image'} />
              <span>{reference.name}</span>
              {reference.alias ? <small>@{reference.alias}</small> : null}
            </button>
          )) : <p>{t('canvas.storyboard.noContextReferences')}</p>}
        </div>
      ) : null}
    </div>
  );
}
