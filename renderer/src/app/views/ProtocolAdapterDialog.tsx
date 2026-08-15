import { useState } from "react";
import {
  compileProviderModels,
  type ProviderProtocolAdapter,
} from "../../domain/provider/ProviderAdapterContract";
import { IconSymbol } from "../components/IconSymbol";

function createAdapterDraft(): ProviderProtocolAdapter {
  return {
    kind: "adapter",
    id: "custom-protocol",
    name: "自定义协议",
    type: "imageGeneration",
    defaultMode: "generate",
    modes: [
      {
        id: "generate",
        label: "图片生成",
        endpoint: {
          method: "POST",
          path: "/images/generations",
          scope: "root",
        },
        inputConstraints: {},
        outputConstraints: {},
        params: [],
        requestTemplate: {
          model: "{{model}}",
          prompt: "{{prompt}}",
        },
        resultUrlPath: "data.*.url",
      },
    ],
  };
}

export function ProtocolAdapterDialog({
  adapter,
  existingIds,
  onClose,
  onSave,
}: {
  adapter?: ProviderProtocolAdapter | null;
  existingIds: string[];
  onClose: () => void;
  onSave: (adapter: ProviderProtocolAdapter) => void | Promise<void>;
}) {
  const initial = adapter || createAdapterDraft();
  const [json, setJson] = useState(() => JSON.stringify(initial, null, 2));
  const [error, setError] = useState("");

  function formatJson() {
    try {
      setJson(JSON.stringify(JSON.parse(json), null, 2));
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "JSON 格式错误");
    }
  }

  async function submit() {
    let parsed: ProviderProtocolAdapter;
    try {
      parsed = JSON.parse(json) as ProviderProtocolAdapter;
    } catch (cause) {
      return setError(cause instanceof Error ? cause.message : "JSON 格式错误");
    }
    if (parsed.kind !== "adapter" || !parsed.id) {
      return setError("协议必须是包含 kind:adapter 和 id 的 JSON 对象");
    }
    if (parsed.id !== adapter?.id && existingIds.includes(parsed.id)) {
      return setError(`协议 ID “${parsed.id}” 已存在`);
    }
    try {
      compileProviderModels("__protocol_editor__", [parsed], []);
      setError("");
      await onSave(parsed);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "协议校验失败");
    }
  }

  return (
    <div
      className="recipe-dialog-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        className="recipe-dialog protocol-adapter-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={adapter ? "编辑协议" : "新建协议"}
      >
        <header>
          <div>
            <h3>{adapter ? "编辑协议" : "新建协议"}</h3>
            <p className="recipe-dialog-change-summary">
              协议是全局能力，可被任意 API 厂商的多个模型复用。
            </p>
          </div>
          <button className="icon-action" type="button" onClick={onClose}>
            <IconSymbol name="x" />
          </button>
        </header>
        <div className="recipe-dialog-body">
          <label className="recipe-field recipe-prompt-field">
            <span className="provider-model-json-heading">
              <span>Adapter JSON</span>
              <button type="button" onClick={formatJson}>
                格式化 JSON
              </button>
            </span>
            <textarea
              value={json}
              rows={24}
              spellCheck={false}
              onChange={(event) => {
                setJson(event.target.value);
                setError("");
              }}
            />
            <small>
              Adapter 定义
              endpoint、输入语义、参数控件、请求模板、结果解析和异步流程，不包含具体模型
              ID。
            </small>
          </label>
          {error && <p className="recipe-dialog-error">{error}</p>}
        </div>
        <footer>
          <button className="button ghost" type="button" onClick={onClose}>
            取消
          </button>
          <button
            className="button primary"
            type="button"
            onClick={() => void submit()}
          >
            保存协议
          </button>
        </footer>
      </section>
    </div>
  );
}
