import { editorMessage } from "../../../shotloom-mode";
import React, { useState, useEffect, useCallback } from "react";
import { Plug, Eye, EyeOff, Copy, RefreshCw, Wifi } from "@/icons/lucide-compat";
import { ToolcraftSwitchControl } from "@openreel/ui";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftIconButton as IconButton } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { useSettingsStore } from "../../../stores/settings-store";
import { toast } from "../../../stores/notification-store";
import type { OpenReelMcpStatus } from "../../../types/global";

const isDesktop = (): boolean =>
  typeof window !== "undefined" && window.openreel?.platform === "desktop";

function clientConfigSnippet(shimPath: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        openreel: {
          command: "node",
          args: [shimPath || "<path to openreel-mcp shim>"],
        },
      },
    },
    null,
    2,
  );
}

async function copy(value: string, label: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(editorMessage("editor.mcp.copied", { label }));
  } catch {
    toast.error(editorMessage("editor.mcp.copyFailed"), editorMessage("editor.mcp.clipboard"));
  }
}

export const McpPanel: React.FC = () => {
  const mcpAutoAllow = useSettingsStore((s) => s.mcpAutoAllowTrustedLocal);
  const setMcpAutoAllow = useSettingsStore((s) => s.setMcpAutoAllowTrustedLocal);

  const [status, setStatus] = useState<OpenReelMcpStatus | null>(null);
  const [toolCount, setToolCount] = useState<number | null>(null);
  const [revealToken, setRevealToken] = useState(false);
  const [testing, setTesting] = useState(false);

  const refresh = useCallback(async () => {
    const bridge = window.openreel?.mcp;
    if (!bridge) return;
    try {
      const nextStatus = await bridge.getStatus();
      setStatus(nextStatus);
      if (nextStatus.running) {
        const connection = await bridge.testConnection();
        setToolCount(connection.ok ? (connection.toolCount ?? 0) : null);
      } else {
        setToolCount(null);
      }
    } catch {
      setStatus(null);
      setToolCount(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleRotate = useCallback(async () => {
    const bridge = window.openreel?.mcp;
    if (!bridge) return;
    try {
      setStatus(await bridge.rotateToken());
      toast.success(editorMessage("editor.mcp.rotated"), editorMessage("editor.mcp.rotateHelp"));
    } catch (err) {
      toast.error(editorMessage("editor.mcp.rotateFailed"), err instanceof Error ? err.message : editorMessage("editor.mcp.unknown"));
    }
  }, []);

  const handleTest = useCallback(async () => {
    const bridge = window.openreel?.mcp;
    if (!bridge) return;
    setTesting(true);
    try {
      const result = await bridge.testConnection();
      if (result.ok) {
        setToolCount(result.toolCount ?? 0);
        toast.success(
          editorMessage("editor.mcp.connected"),
          editorMessage("editor.mcp.toolResponse", { count: result.toolCount ?? 0 }),
        );
      } else {
        setToolCount(null);
        toast.error(editorMessage("editor.mcp.failed"), result.message ?? editorMessage("editor.mcp.noResponse"));
      }
    } catch (err) {
      toast.error(editorMessage("editor.mcp.failed"), err instanceof Error ? err.message : editorMessage("editor.mcp.unknown"));
    } finally {
      setTesting(false);
    }
  }, []);

  if (!isDesktop()) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Plug size={28} className="mb-3 text-text-muted" />
        <Text type="body" color="primary" className="text-sm font-medium">{editorMessage("editor.mcp.desktop")}</Text>
        <Text type="supporting" color="secondary" className="mt-1 max-w-sm text-xs">{editorMessage("editor.mcp.desktopHelp")}</Text>
      </div>
    );
  }

  const tokenDisplay = status?.token
    ? revealToken
      ? status.token
      : "•".repeat(32)
    : "—";

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div>
          <Text type="body" color="primary" className="text-sm font-medium">{editorMessage("editor.mcp.server")}</Text>
          <Text type="supporting" color="secondary" className="mt-0.5 text-xs">{editorMessage("editor.mcp.serverHelp")}</Text>
        </div>

        <div className="flex items-center gap-2">
          <Text type="supporting" color="secondary" className="w-20 shrink-0 text-xs">{editorMessage("editor.mcp.status")}</Text>
          <Text
            type="supporting"
            className={`inline-flex items-center gap-1.5 text-xs font-medium ${
              status?.running ? "text-status-success" : "text-text-muted"
            }`}
          >
            <i
              aria-hidden
              className={`h-1.5 w-1.5 rounded-full ${
                status?.running ? "bg-status-success" : "bg-text-muted"
              }`}
            />
            {status?.running ? editorMessage("editor.mcp.running") : editorMessage("editor.mcp.stopped")}
          </Text>
        </div>

        <div className="flex items-center gap-2">
          <Text type="supporting" color="secondary" className="w-20 shrink-0 text-xs">{editorMessage("editor.mcp.tools")}</Text>
          <Text type="supporting" color="secondary" className="text-xs">
            {toolCount === null
              ? status?.running
                ? editorMessage("editor.mcp.checking")
                : "—"
              : editorMessage("editor.mcp.available", { count: toolCount })}
          </Text>
        </div>

        <div className="flex items-center gap-2">
          <Text type="supporting" color="secondary" className="w-20 shrink-0 text-xs">{editorMessage("editor.mcp.url")}</Text>
          <code className="flex-1 font-mono text-xs bg-background rounded px-3 py-2 text-text-secondary truncate">
            {status?.url || "—"}
          </code>
          <IconButton
            label={editorMessage("editor.mcp.copyUrl")}
            onClick={() => status?.url && copy(status.url, editorMessage("editor.mcp.url"))}
            variant="ghost"
            size="sm"
            icon={<Copy size={14} aria-hidden />}
            className="text-text-muted hover:bg-background-tertiary hover:text-text-primary"
          />
        </div>

        <div className="flex items-center gap-2">
          <Text type="supporting" color="secondary" className="w-20 shrink-0 text-xs">{editorMessage("editor.mcp.token")}</Text>
          <code className="flex-1 font-mono text-xs bg-background rounded px-3 py-2 text-text-secondary truncate">
            {tokenDisplay}
          </code>
          <IconButton
            label={revealToken ? editorMessage("editor.mcp.hideToken") : editorMessage("editor.mcp.showToken")}
            onClick={() => setRevealToken((v) => !v)}
            variant="ghost"
            size="sm"
            icon={revealToken ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
            className="text-text-muted hover:bg-background-tertiary hover:text-text-primary"
          />
          <IconButton
            label={editorMessage("editor.mcp.copyToken")}
            onClick={() => status?.token && copy(status.token, editorMessage("editor.mcp.token"))}
            variant="ghost"
            size="sm"
            icon={<Copy size={14} aria-hidden />}
            className="text-text-muted hover:bg-background-tertiary hover:text-text-primary"
          />
          <IconButton
            label={editorMessage("editor.mcp.rotateToken")}
            onClick={handleRotate}
            variant="ghost"
            size="sm"
            icon={<RefreshCw size={14} aria-hidden />}
            className="text-text-muted hover:bg-background-tertiary hover:text-text-primary"
          />
        </div>

        <Button
          label={testing ? editorMessage("editor.mcp.testing") : editorMessage("editor.mcp.test")}
          size="sm"
          variant="secondary"
          onClick={handleTest}
          isDisabled={testing}
          icon={<Wifi size={14} aria-hidden />}
        />
      </div>

      <div className="h-px bg-border" />

      <div className="space-y-3">
        <div>
          <Text type="body" color="primary" className="text-sm font-medium">{editorMessage("editor.mcp.workflows")}</Text>
          <Text type="supporting" color="secondary" className="mt-0.5 text-xs">{editorMessage("editor.mcp.workflowsHelp")}</Text>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {[
            [editorMessage("editor.mcp.video"), editorMessage("editor.mcp.videoHelp")],
            [editorMessage("editor.mcp.motion"), editorMessage("editor.mcp.motionHelp")],
            [editorMessage("editor.mcp.creation"), editorMessage("editor.mcp.creationHelp")],
            [editorMessage("editor.mcp.operations"), editorMessage("editor.mcp.operationsHelp")],
          ].map(([label, description]) => (
            <div key={label} className="rounded-md border border-border bg-background px-3 py-2.5">
              <Text type="supporting" color="primary" className="text-xs font-medium">
                {label}
              </Text>
              <Text type="supporting" color="secondary" className="mt-1 text-[11px] leading-4">
                {description}
              </Text>
            </div>
          ))}
        </div>
      </div>

      <div className="h-px bg-border" />

      <div className="space-y-4">
        <div>
          <Text type="body" color="primary" className="text-sm font-medium">{editorMessage("editor.mcp.setup")}</Text>
          <Text type="supporting" color="secondary" className="mt-0.5 text-xs">{editorMessage("editor.mcp.setupHelp")}</Text>
        </div>
        <div className="relative">
          <pre className="overflow-x-auto rounded bg-background px-3 py-2 font-mono text-[11px] text-text-secondary">
            {clientConfigSnippet(status?.shimPath ?? "")}
          </pre>
          <IconButton
            label={editorMessage("editor.mcp.copyConfig")}
            onClick={() =>
              copy(clientConfigSnippet(status?.shimPath ?? ""), editorMessage("editor.mcp.config"))
            }
            variant="ghost"
            size="sm"
            icon={<Copy size={14} aria-hidden />}
            className="absolute right-2 top-2 text-text-muted hover:bg-background-tertiary hover:text-text-primary"
          />
        </div>
      </div>

      <div className="h-px bg-border" />

      <div className="space-y-4">
        <Text type="body" color="primary" className="text-sm font-medium">{editorMessage("editor.mcp.trusted")}</Text>
        <div className="flex items-center justify-between">
          <div>
            <Text type="supporting" color="secondary" className="text-sm">{editorMessage("editor.mcp.autoAllow")}</Text>
            <Text type="supporting" color="secondary" className="mt-0.5 max-w-md text-xs">{editorMessage("editor.mcp.autoAllowHelp")}</Text>
          </div>
          <ToolcraftSwitchControl
            ariaLabel={editorMessage("editor.mcp.autoAllow")}
            checked={mcpAutoAllow}
            onCheckedChange={setMcpAutoAllow}
            showLabel={false}
          />
        </div>
      </div>
    </div>
  );
};
