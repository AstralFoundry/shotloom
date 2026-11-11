import assert from 'node:assert/strict';
import test from 'node:test';
import { isCanvasDomEvent, isEditableCanvasEvent } from '../renderer/src/app/canvas/canvasEventScope.ts';

test('画布忽略从导演台聊天 Portal 传来的删除键和指针事件', () => {
  const canvas = {};
  const chatInput = {};
  const chatHost = {};
  const event = {
    target: chatHost,
    composedPath: () => [chatInput, chatHost, {}],
  };
  assert.equal(isCanvasDomEvent(event, canvas), false);
  assert.equal(isCanvasDomEvent({ composedPath: () => [canvas] }, canvas), true);
});

test('画布识别 ShadowRoot 事件路径中的真实文本输入框', () => {
  const previousHTMLElement = globalThis.HTMLElement;
  class TestElement {
    constructor(tag, editable = false) { this.tag = tag; this.isContentEditable = editable; }
    matches(selector) { return selector.split(',').includes(this.tag); }
  }
  globalThis.HTMLElement = TestElement;
  try {
    const canvas = new TestElement('section');
    const chatHost = new TestElement('div');
    const textarea = new TestElement('textarea');
    const shadowEvent = { target: chatHost, composedPath: () => [textarea, chatHost, canvas] };
    assert.equal(isEditableCanvasEvent(shadowEvent), true);
    assert.equal(isEditableCanvasEvent({ composedPath: () => [new TestElement('div', true), canvas] }), true);
    assert.equal(isEditableCanvasEvent({ composedPath: () => [canvas] }), false);
  } finally {
    if (previousHTMLElement === undefined) delete globalThis.HTMLElement;
    else globalThis.HTMLElement = previousHTMLElement;
  }
});
