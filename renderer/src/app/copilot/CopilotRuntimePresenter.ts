type RuntimeValue = Record<string, any>;

export interface RuntimePresentationEffect {
  textChanged?: boolean;
  contextUsage?: RuntimeValue;
  messagePatch?: RuntimeValue;
  persist?: boolean;
}

const cloneList = (items: RuntimeValue[]) => items.map((item) => ({
  ...item,
  ...(item.options ? { options: [...item.options] } : {}),
  ...(item.evidence ? { evidence: [...item.evidence] } : {}),
  ...(item.previews ? { previews: [...item.previews] } : {}),
}));

function toolActivity(name: string): string {
  if (name === 'request_clarification') return '需要你的选择';
  if (name === 'inspect_runtime_capabilities') return '正在检查 Agent 能力';
  if (name === 'canvas_list_nodes' || name === 'canvas_get_node') return '正在查看画布';
  if (name === 'inspect_model_catalog') return '正在检查可用模型';
  if (name === 'list_recipes' || name === 'load_recipe') return '正在准备处理方法';
  if (name === 'report_outcome') return '正在核对结果';
  if (name.startsWith('plan_')) return '正在规划制作画布';
  if (/canvas|node|edge|task|layout/.test(name)) return '正在整理画布';
  return '正在处理任务';
}

function toolSummary(inputSummary: unknown): string {
  return String(inputSummary || '');
}

/**
 * 工具没有自己声明产出时，用回执里真实影响的对象数量回答"这一步做了什么"。
 * 只统计回执中的真实 ID，不从工具名或文本猜结果。
 */
function receiptOutcome(receipt: RuntimeValue | undefined): string {
  const counted: Array<[unknown, string]> = [
    [receipt?.nodeIds, '节点'],
    [receipt?.edgeIds, '连线'],
    [receipt?.taskIds, '任务'],
  ];
  const parts: string[] = [];
  for (const [value, label] of counted) {
    const total = Array.isArray(value) ? value.filter(Boolean).length : 0;
    if (total) parts.push(`${total} 个${label}`);
  }
  const skipped = Number(receipt?.skippedCount || 0);
  if (skipped) parts.push(`跳过 ${skipped} 项`);
  return parts.join(' · ');
}

/** Converts domain runtime events into the single assistant-message presentation model. */
export class CopilotRuntimePresenter {
  streamed = '';
  turns = 0;
  readonly tools: RuntimeValue[] = [];
  readonly clarifications: RuntimeValue[] = [];
  readonly subagents: RuntimeValue[] = [];
  readonly artifactRefs = { nodeIds: [] as string[], taskIds: [] as string[] };
  plan: RuntimeValue | null = null;
  private structuralRevision = 0;
  private cachedStructuralRevision = -1;
  private cachedStructuralSnapshot: RuntimeValue = {};
  private seq = 0;

  private changed(): void {
    this.structuralRevision += 1;
  }

  /**
   * 每一行都带执行者身份和到达顺序。身份让界面按会话把子 Agent 的步骤归到它的
   * 任务下，顺序让子任务标题插在父级步骤之间，而不是全部堆到轨迹末尾。
   */
  private rowIdentity(event: RuntimeValue): RuntimeValue {
    return {
      agentId: String(event.agentId || ''),
      agentSessionId: String(event.agentSessionId || ''),
      seq: (this.seq += 1),
    };
  }

  snapshot(patch: RuntimeValue = {}): RuntimeValue {
    if (this.cachedStructuralRevision !== this.structuralRevision) {
      this.cachedStructuralSnapshot = {
        toolCalls: cloneList(this.tools),
        clarifications: cloneList(this.clarifications),
        subagents: cloneList(this.subagents),
        artifactRefs: {
          nodeIds: [...this.artifactRefs.nodeIds],
          taskIds: [...this.artifactRefs.taskIds],
        },
        agentTurnCount: this.turns,
        ...(this.plan ? { productionPlan: JSON.parse(JSON.stringify(this.plan)) } : {}),
      };
      this.cachedStructuralRevision = this.structuralRevision;
    }
    return {
      ...this.cachedStructuralSnapshot,
      typing: true,
      ...patch,
    };
  }

  /**
   * 运行中断时，仍未结束的工具和子任务都要落到失败态：
   * 只结算工具会让子 Agent 的"执行中"永远挂在界面上。
   */
  failRunning(): RuntimeValue {
    const settle = (item: RuntimeValue) => ({
      ...item,
      status: item.status === 'running' ? 'error' : item.status,
    });
    return { toolCalls: this.tools.map(settle), subagents: this.subagents.map(settle) };
  }

  /**
   * 子任务按 childSessionId 聚合。状态沿用工具行的 running/success/error，
   * 界面就只需要一套状态文案。
   */
  private subagent(event: RuntimeValue): void {
    const id = String(event.childSessionId || '');
    if (!id) return;
    let item = this.subagents.find((value) => value.id === id);
    if (!item) {
      item = { id };
      this.subagents.push(item);
    }
    if (event.type === 'subagent_started') {
      Object.assign(item, {
        // childAgentId 是"这条事件说的是哪个子 Agent"，与发出事件的父级身份分开保存。
        agentId: String(event.childAgentId || ''),
        title: String(event.title || ''),
        task: String(event.task || ''),
        status: 'running',
        runId: String(event.parentRunId || event.requestId || ''),
        seq: (this.seq += 1),
      });
    } else {
      Object.assign(item, {
        status: event.type === 'subagent_completed' ? 'success' : 'error',
        summary: String(event.summary || ''),
        error: String(event.error || ''),
      });
    }
    this.changed();
  }

  private clarification(event: RuntimeValue): void {
    const interactionId = String(event.interactionId || event.clarification?.interactionId || '');
    const runId = String(event.runId || event.requestId || event.clarification?.runId || '');
    let item = this.clarifications.find((value) => interactionId && value.interactionId === interactionId);
    if (!item) {
      item = { interactionId, runId, questions: [] };
      this.clarifications.push(item);
    }
    Object.assign(item, event.clarification || {}, {
      ...(Array.isArray(event.questions) ? { questions: event.questions } : {}),
      ...(Array.isArray(event.answers) ? { answers: event.answers, answered: true } : {}),
      ...(event.skipped ? { skipped: true, answered: true } : {}),
    });
    this.changed();
  }

  consume(event: RuntimeValue): RuntimePresentationEffect {
    if (event.type === 'production_plan_updated' && event.plan) {
      this.plan = event.plan;
      this.changed();
      return { messagePatch: this.snapshot({ title: '正在按制作计划推进' }), persist: true };
    }
    if (event.type === 'text_delta') {
      this.streamed += event.delta || '';
      return { textChanged: true, messagePatch: { title: '正在组织回答', typing: true } };
    }
    if (event.type === 'context_usage') {
      return { contextUsage: {
        estimatedTokens: Number(event.estimatedTokens) || 0,
        inputLimit: Number(event.inputLimit) || 0,
        inputBudget: Number(event.inputBudget) || 0,
        outputReserve: Number(event.outputReserve) || 0,
        ratio: Number(event.ratio) || 0,
      } };
    }
    if (event.type === 'context_compaction') {
      const row = { ...this.rowIdentity(event) };
      // 子 Agent 有独立的上下文窗口，压缩行必须按会话分开，否则并行时互相覆盖。
      const id = `context-compaction:${row.agentSessionId}`;
      let tool = this.tools.find((item) => item.id === id);
      if (!tool) {
        tool = { id, name: 'context_compaction', kind: 'system', ...row };
        this.tools.push(tool);
      }
      const completed = event.status === 'completed';
      Object.assign(tool, {
        status: completed ? 'success' : 'running',
        summary: completed ? '上下文已压缩，保留近期对话继续执行' : '正在压缩较早的对话与工具结果',
      });
      this.changed();
      return {
        messagePatch: this.snapshot({ title: completed ? '上下文已压缩，正在继续' : '正在整理上下文' }),
        persist: completed,
      };
    }
    if (event.type === 'turn_start') {
      this.turns = Math.max(this.turns + 1, Number(event.turn) || 0);
      this.changed();
      return { messagePatch: this.snapshot({
        title: '正在分析任务',
        meta: [],
      }) };
    }
    if (event.type === 'tool_start') {
      const name = String(event.toolName || '');
      this.tools.push({
        id: event.toolCallId || `runtime-tool-${this.tools.length + 1}`,
        name: name || 'tool',
        kind: 'tool',
        effect: String(event.effect || ''),
        summary: toolSummary(event.inputSummary),
        status: 'running',
        runId: event.requestId,
        startedAt: event.startedAt,
        ...this.rowIdentity(event),
      });
      this.changed();
      if (event.clarification) this.clarification(event);
      return { messagePatch: this.snapshot({
        title: toolActivity(name),
      }) };
    }
    if (event.type === 'subagent_started') {
      this.subagent(event);
      return { messagePatch: this.snapshot({ title: '正在并行分析' }) };
    }
    if (event.type === 'subagent_completed' || event.type === 'subagent_failed') {
      this.subagent(event);
      return { messagePatch: this.snapshot({
        title: event.type === 'subagent_completed' ? '正在汇总分析结果' : '正在调整处理方案',
      }) };
    }
    if (event.type === 'session_stalled') {
      return { messagePatch: this.snapshot({
        title: event.stalled === false
          ? 'Agent 已恢复响应'
          : event.watchdog === 'hard_cap'
          ? 'Agent 已运行较长时间，可停止后重试'
          : 'Agent 暂时没有新进展，可继续等待或停止',
        stalled: event.stalled !== false,
        stall: event.stalled === false ? undefined : {
          silentMs: Number(event.silentMs || 0),
          watchdog: String(event.watchdog || 'no_progress'),
        },
      }), persist: true };
    }
    if (event.type === 'interaction_requested' && event.kind === 'tool_confirmation') {
      const tool = this.tools.find((item) => item.id === event.toolCallId);
      const actionCount = Number(event.actionCount || 0);
      // 循环拦截没有"项"数，标题也必须通用：它可能来自画布操作，也可能来自重复调用拦截。
      const summary = actionCount > 0
        ? `${event.title || '画布操作'} · ${actionCount} 项，等待确认`
        : `${event.title || '画布操作'}，等待确认`;
      if (tool) Object.assign(tool, {
        pending: true,
        status: 'pending',
        runId: event.requestId,
        stepId: event.stepId,
        interactionId: event.interactionId,
        summary,
        pendingArgs: event.pendingArgs,
      });
      if (tool) this.changed();
      return { messagePatch: this.snapshot({ title: '等待你确认操作', transient: false }), persist: true };
    }
    if (event.type === 'interaction_resolved' && event.kind === 'tool_confirmation') {
      const tool = this.tools.find((item) => item.id === event.toolCallId);
      if (tool) Object.assign(tool, { pending: false, status: event.approved ? 'running' : 'error' });
      if (tool) this.changed();
      return { messagePatch: this.snapshot({ title: event.approved ? '正在执行已确认的操作' : '正在调整处理方案' }) };
    }
    if (event.type === 'tool_end') {
      const receipt = event.receipt;
      if (receipt?.success && receipt.applied &&
          ['canvas_write', 'project_write', 'media_generation'].includes(receipt.effect)) {
        for (const key of ['nodeIds', 'taskIds'] as const) {
          for (const id of Array.isArray(receipt[key]) ? receipt[key] : []) {
            if (typeof id === 'string' && id && !this.artifactRefs[key].includes(id)) {
              this.artifactRefs[key].push(id);
            }
          }
        }
        this.changed();
      }
      const tool = this.tools.find((item) => item.id === event.toolCallId)
        || [...this.tools].reverse().find((item) => item.name === event.toolName && item.status === 'running');
      if (tool) {
        let summary = String(tool.summary || '');
        if (event.error) summary = String(event.error);
        if (event.pending) summary = `已提交 ${event.requestedCount || 0} 项操作，等待确认`;
        const display = receipt?.display;
        Object.assign(tool, {
          status: event.isError ? 'error' : 'success',
          error: event.error || '',
          pending: event.pending === true,
          summary,
          output: event.isError || event.pending ? '' : String(display?.summary || receiptOutcome(receipt)),
          previews: event.isError ? undefined : display?.previews,
        });
        this.changed();
      }
      return { messagePatch: this.snapshot({
        title: event.pending ? '等待你确认画布操作'
          : event.isError ? '一个处理步骤失败'
          : '正在继续处理',
      }) };
    }
    if (event.type === 'clarification_required' || event.type === 'clarification_resolved') {
      this.clarification(event);
      return { messagePatch: this.snapshot({
        title: event.type === 'clarification_required'
          ? '等待你的回答'
          : '正在根据回答继续处理',
      }) };
    }
    if (event.type === 'skill_used') {
      const id = `skill:${String(event.skillId || event.name || this.tools.length + 1)}`;
      if (!this.tools.some((item) => item.id === id)) this.tools.push({
        id,
        name: String(event.name || event.skillId || 'Skill'),
        kind: 'skill',
        status: 'success',
        title: '加载技能',
        summary: String(event.name || event.skillId || 'Skill'),
        ...this.rowIdentity(event),
      });
      this.changed();
      return { messagePatch: this.snapshot({ title: '正在准备处理方法' }) };
    }
    if (event.type === 'recipe_used') {
      const id = `recipe:${String(event.recipeId || event.name || this.tools.length + 1)}`;
      if (!this.tools.some((item) => item.id === id)) this.tools.push({
        id,
        name: String(event.name || event.recipeId || 'Recipe'),
        kind: 'recipe',
        status: 'success',
        title: '读取提示词模板',
        summary: String(event.name || event.recipeId || 'Recipe'),
        ...this.rowIdentity(event),
      });
      this.changed();
      return { messagePatch: this.snapshot({ title: '正在准备处理方法' }) };
    }
    return { messagePatch: this.snapshot({
      title: event.type === 'action_delta'
        ? '正在整理画布'
        : event.type === 'agent_error' || event.type === 'runtime_warning'
        ? '正在处理异常'
        : '正在处理任务',
    }) };
  }
}
