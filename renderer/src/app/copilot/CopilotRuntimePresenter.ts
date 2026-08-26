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

function toolSummary(name: string, inputSummary: unknown): string {
  const labels: Record<string, string> = {
    request_clarification: '询问关键信息',
    inspect_runtime_capabilities: '检查本轮运行能力',
    canvas_list_nodes: '浏览画布',
    canvas_get_node: '读取节点',
    canvas_focus_nodes: '聚焦节点',
    inspect_model_catalog: '检查可用模型',
    list_recipes: '查找处理策略',
    load_recipe: '加载处理策略',
    canvas_create_node: '创建节点',
    canvas_update_node: '更新节点',
    canvas_connect_nodes: '连接节点',
    canvas_layout_nodes: '整理节点',
    canvas_delete_node: '删除节点',
    canvas_update_edge: '更新连线',
    canvas_start_generation: '启动生成',
    report_outcome: '核对完成结果',
    plan_write: '创建制作计划',
    plan_get_stage_status: '查看计划状态',
    plan_get_stage_detail: '查看阶段详情',
    plan_patch_stage: '更新阶段计划',
    plan_update_stage_state: '推进制作阶段',
  };
  return String(inputSummary || labels[name] || '执行处理步骤');
}

/** Converts domain runtime events into the single assistant-message presentation model. */
export class CopilotRuntimePresenter {
  streamed = '';
  turns = 0;
  readonly tools: RuntimeValue[] = [];
  readonly clarifications: RuntimeValue[] = [];
  plan: RuntimeValue | null = null;
  private structuralRevision = 0;
  private cachedStructuralRevision = -1;
  private cachedStructuralSnapshot: RuntimeValue = {};

  private changed(): void {
    this.structuralRevision += 1;
  }

  snapshot(patch: RuntimeValue = {}): RuntimeValue {
    if (this.cachedStructuralRevision !== this.structuralRevision) {
      this.cachedStructuralSnapshot = {
        toolCalls: cloneList(this.tools),
        clarifications: cloneList(this.clarifications),
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

  failRunningTools(): RuntimeValue[] {
    return this.tools.map((item) => ({
      ...item,
      status: item.status === 'running' ? 'error' : item.status,
    }));
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
      const id = 'context-compaction';
      let tool = this.tools.find((item) => item.id === id);
      if (!tool) {
        tool = { id, name: 'context_compaction', kind: 'system' };
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
        summary: toolSummary(name, event.inputSummary),
        status: 'running',
        runId: event.requestId,
        startedAt: event.startedAt,
      });
      this.changed();
      if (event.clarification) this.clarification(event);
      return { messagePatch: this.snapshot({
        title: toolActivity(name),
      }) };
    }
    if (event.type === 'subagent_started') {
      return { messagePatch: this.snapshot({ title: '正在并行分析' }) };
    }
    if (event.type === 'subagent_completed' || event.type === 'subagent_failed') {
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
      if (tool) Object.assign(tool, {
        pending: true,
        status: 'pending',
        runId: event.requestId,
        stepId: event.stepId,
        interactionId: event.interactionId,
        summary: `${event.title || '画布操作'} · ${event.actionCount || 0} 项，等待确认`,
      });
      if (tool) this.changed();
      return { messagePatch: this.snapshot({ title: '等待你确认画布操作', transient: false }), persist: true };
    }
    if (event.type === 'interaction_resolved' && event.kind === 'tool_confirmation') {
      const tool = this.tools.find((item) => item.id === event.toolCallId);
      if (tool) Object.assign(tool, { pending: false, status: event.approved ? 'running' : 'error' });
      if (tool) this.changed();
      return { messagePatch: this.snapshot({ title: event.approved ? '正在执行已确认的操作' : '正在调整处理方案' }) };
    }
    if (event.type === 'tool_end') {
      const tool = this.tools.find((item) => item.id === event.toolCallId)
        || [...this.tools].reverse().find((item) => item.name === event.toolName && item.status === 'running');
      if (tool) {
        let summary = String(tool.summary || event.toolName || '处理完成');
        if (event.error) summary = String(event.error);
        if (event.pending) summary = `已提交 ${event.requestedCount || 0} 项操作，等待确认`;
        Object.assign(tool, {
          status: event.isError ? 'error' : 'success',
          error: event.error || '',
          pending: event.pending === true,
          summary,
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
        summary: String(event.name || event.skillId || 'Skill'),
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
        summary: String(event.name || event.recipeId || 'Recipe'),
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
