import { editorMessage, getEditorLocale } from "../../../shotloom-mode";
import React, { useState, useEffect, useCallback } from "react";
import {
  Key,
  Plus,
  Trash2,
  Eye,
  EyeOff,
  Lock,
  Unlock,
  ExternalLink,
  Shield,
  KeyRound,
} from "@/icons/lucide-compat";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftClickableCard as ClickableCard } from "@openreel/ui";
import { ToolcraftIconButton as IconButton } from "@openreel/ui";
import { ToolcraftLink as Link } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { ToolcraftTextInputControl } from "@openreel/ui";
import { useSettingsStore, SERVICE_REGISTRY, type ServiceConfig } from "../../../stores/settings-store";
import {
  isMasterPasswordSet,
  isSessionUnlocked,
  setupMasterPassword,
  unlockSession,
  lockSession,
  saveSecret,
  getSecret,
  deleteSecret,
  hasSecret,
  listSecrets,
  changeMasterPassword,
} from "../../../services/secure-storage";
import { MasterPasswordDialog } from "./MasterPasswordDialog";
import { toast } from "../../../stores/notification-store";

function serviceLabel(service: ServiceConfig): string {
  if (service.id === "openai-compatible") return editorMessage("editor.general.openai");
  if (service.id === "anthropic-compatible") return editorMessage("editor.general.anthropic");
  return service.label;
}

const serviceDescriptionKeys: Record<string, Parameters<typeof editorMessage>[0]> = {
  "elevenlabs": "editor.apiKeys.service.elevenlabs",
  "openai-compatible": "editor.apiKeys.service.openai-compatible",
  "anthropic-compatible": "editor.apiKeys.service.anthropic-compatible",
  "kie-ai": "editor.apiKeys.service.kie-ai",
  "freepik": "editor.apiKeys.service.freepik",
};

export const ApiKeysPanel: React.FC = () => {
  const { addConfiguredService, removeConfiguredService } =
    useSettingsStore();

  const [passwordSet, setPasswordSet] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [passwordDialogMode, setPasswordDialogMode] = useState<
    "setup" | "unlock" | "change" | null
  >(null);
  const [storedKeys, setStoredKeys] = useState<
    Array<{ id: string; label: string; createdAt: number; updatedAt: number }>
  >([]);
  const [addingService, setAddingService] = useState<string | null>(null);
  const [newKeyValue, setNewKeyValue] = useState("");
  const [revealedKeys, setRevealedKeys] = useState<Record<string, string>>({});
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});

  const refreshState = useCallback(async () => {
    const isSet = await isMasterPasswordSet();
    setPasswordSet(isSet);
    setUnlocked(isSessionUnlocked());

    if (isSessionUnlocked()) {
      const keys =
        typeof window !== "undefined" && window.openreel?.platform === "desktop"
          ? (
              await Promise.all(
                SERVICE_REGISTRY.map(async (service) =>
                  (await hasSecret(service.id))
                    ? {
                        id: service.id,
                        label: service.label,
                        createdAt: 0,
                        updatedAt: 0,
                      }
                    : null,
                ),
              )
            ).filter((key): key is NonNullable<typeof key> => key !== null)
          : await listSecrets();
      setStoredKeys(keys);
    }
  }, []);

  useEffect(() => {
    refreshState();
  }, [refreshState]);

  const handlePasswordSubmit = useCallback(
    async (password: string, newPassword?: string): Promise<boolean> => {
      if (passwordDialogMode === "setup") {
        await setupMasterPassword(password);
        setPasswordDialogMode(null);
        await refreshState();
        toast.success(editorMessage("editor.apiKeys.passwordSet"), editorMessage("editor.apiKeys.encryptedHelp"));
        return true;
      }

      if (passwordDialogMode === "unlock") {
        const success = await unlockSession(password);
        if (success) {
          setPasswordDialogMode(null);
          await refreshState();
          toast.success(editorMessage("editor.apiKeys.unlocked"), editorMessage("editor.apiKeys.manageHelp"));
        }
        return success;
      }

      if (passwordDialogMode === "change" && newPassword) {
        const success = await changeMasterPassword(password, newPassword);
        if (success) {
          setPasswordDialogMode(null);
          await refreshState();
          toast.success(editorMessage("editor.apiKeys.changed"), editorMessage("editor.apiKeys.reencrypted"));
        }
        return success;
      }

      return false;
    },
    [passwordDialogMode, refreshState],
  );

  const handleSaveKey = useCallback(
    async (serviceId: string) => {
      if (!newKeyValue.trim()) return;

      const service = SERVICE_REGISTRY.find((s) => s.id === serviceId);
      if (!service) return;

      try {
        await saveSecret(serviceId, service.label, newKeyValue.trim());
        addConfiguredService(serviceId);
        setNewKeyValue("");
        setAddingService(null);
        await refreshState();
        toast.success(editorMessage("editor.apiKeys.saved", { service: serviceLabel(service) }), editorMessage("editor.apiKeys.stored"));
      } catch (err) {
        toast.error(editorMessage("editor.apiKeys.saveFailed"), err instanceof Error ? err.message : editorMessage("editor.apiKeys.unknown"));
      }
    },
    [newKeyValue, addConfiguredService, refreshState],
  );

  const handleDeleteKey = useCallback(
    async (serviceId: string) => {
      const service = SERVICE_REGISTRY.find((s) => s.id === serviceId);
      try {
        await deleteSecret(serviceId);
        removeConfiguredService(serviceId);
        setRevealedKeys((prev) => {
          const next = { ...prev };
          delete next[serviceId];
          return next;
        });
        await refreshState();
        toast.success(editorMessage("editor.apiKeys.removed", { service: service ? serviceLabel(service) : serviceId }));
      } catch (err) {
        toast.error(editorMessage("editor.apiKeys.deleteFailed"), err instanceof Error ? err.message : editorMessage("editor.apiKeys.unknown"));
      }
    },
    [removeConfiguredService, refreshState],
  );

  const handleRevealKey = useCallback(async (serviceId: string) => {
    if (revealedKeys[serviceId]) {
      setShowKey((prev) => ({ ...prev, [serviceId]: !prev[serviceId] }));
      return;
    }

    try {
      const value = await getSecret(serviceId);
      if (value) {
        setRevealedKeys((prev) => ({ ...prev, [serviceId]: value }));
        setShowKey((prev) => ({ ...prev, [serviceId]: true }));
      }
    } catch (err) {
      toast.error(editorMessage("editor.apiKeys.decryptFailed"), err instanceof Error ? err.message : editorMessage("editor.apiKeys.unknown"));
    }
  }, [revealedKeys]);

  const handleLock = useCallback(() => {
    lockSession();
    setUnlocked(false);
    setStoredKeys([]);
    setRevealedKeys({});
    setShowKey({});
  }, []);

  const availableServices = SERVICE_REGISTRY.filter(
    (s) => !storedKeys.some((k) => k.id === s.id),
  );

  // Not set up yet
  if (!passwordSet) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
        <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
          <Shield size={32} className="text-primary" aria-hidden />
        </div>
        <Text as="h3" type="large" weight="bold" display="block" className="mb-2">{editorMessage("editor.apiKeys.secure")}</Text>
        <Text as="p" type="supporting" color="secondary" display="block" className="mb-6 max-w-sm">{editorMessage("editor.apiKeys.secureHelp")}</Text>
        <Button
          label={editorMessage("editor.apiKeys.setup")}
          onClick={() => setPasswordDialogMode("setup")}
          variant="primary"
          icon={<KeyRound size={16} aria-hidden />}
        />

        {passwordDialogMode && (
          <MasterPasswordDialog
            isOpen={!!passwordDialogMode}
            onClose={() => setPasswordDialogMode(null)}
            mode={passwordDialogMode}
            onSubmit={handlePasswordSubmit}
          />
        )}
      </div>
    );
  }

  // Locked
  if (!unlocked) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
        <div className="w-16 h-16 rounded-full bg-amber-500/10 flex items-center justify-center mb-4">
          <Lock size={32} className="text-amber-500" aria-hidden />
        </div>
        <Text as="h3" type="large" weight="bold" display="block" className="mb-2">{editorMessage("editor.apiKeys.locked")}</Text>
        <Text as="p" type="supporting" color="secondary" display="block" className="mb-6 max-w-sm">{editorMessage("editor.apiKeys.lockedHelp")}</Text>
        <Button
          label={editorMessage("editor.apiKeys.unlock")}
          onClick={() => setPasswordDialogMode("unlock")}
          variant="primary"
          icon={<Unlock size={16} aria-hidden />}
        />

        {passwordDialogMode && (
          <MasterPasswordDialog
            isOpen={!!passwordDialogMode}
            onClose={() => setPasswordDialogMode(null)}
            mode={passwordDialogMode}
            onSubmit={handlePasswordSubmit}
          />
        )}
      </div>
    );
  }

  // Unlocked — full management UI
  return (
    <div className="space-y-6">
      {/* Header actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield size={14} className="text-primary" aria-hidden />
          <Text type="supporting" color="secondary">
            {editorMessage(storedKeys.length === 1 ? "editor.apiKeys.countOne" : "editor.apiKeys.countMany", { count: storedKeys.length })}
          </Text>
        </div>
        <div className="flex items-center gap-2">
          <Button
            label={editorMessage("editor.apiKeys.change")}
            variant="secondary"
            size="sm"
            onClick={() => setPasswordDialogMode("change")}
            icon={<Key size={14} aria-hidden />}
          />
          <Button
            label={editorMessage("editor.apiKeys.lock")}
            variant="secondary"
            size="sm"
            onClick={handleLock}
            icon={<Lock size={14} aria-hidden />}
          />
        </div>
      </div>

      {/* Stored keys list */}
      <div className="space-y-3">
        {storedKeys.map((stored) => {
          const service = SERVICE_REGISTRY.find((s) => s.id === stored.id);
          const isRevealed = showKey[stored.id] && revealedKeys[stored.id];

          return (
            <Card
              key={stored.id}
              variant="muted"
              padding={4}
              className="border border-border"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Key size={14} className="text-primary" aria-hidden />
                  <Text type="label" weight="bold">
                    {service ? serviceLabel(service) : stored.label}
                  </Text>
                  {service?.docsUrl && (
                    <Link
                      label={editorMessage("editor.apiKeys.docs", { service: serviceLabel(service) })}
                      href={service.docsUrl}
                      isExternalLink
                      color="secondary"
                      className="text-text-muted hover:text-primary"
                    >
                      <ExternalLink size={12} aria-hidden />
                    </Link>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <IconButton
                    label={isRevealed ? editorMessage("editor.apiKeys.hide") : editorMessage("editor.apiKeys.show")}
                    onClick={() => handleRevealKey(stored.id)}
                    variant="ghost"
                    size="sm"
                    icon={isRevealed ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
                  />
                  <IconButton
                    label={editorMessage("editor.apiKeys.delete")}
                    onClick={() => handleDeleteKey(stored.id)}
                    variant="destructive"
                    size="sm"
                    icon={<Trash2 size={14} aria-hidden />}
                  />
                </div>
              </div>

              {service && (
                <Text as="p" type="supporting" color="secondary" display="block" className="mb-2">
                  {serviceDescriptionKeys[service.id] ? editorMessage(serviceDescriptionKeys[service.id]) : service.description}
                </Text>
              )}

              <Card variant="default" padding={2} className="font-mono text-xs text-text-secondary">
                {isRevealed
                  ? revealedKeys[stored.id]
                  : "••••••••••••••••••••••••••••••••"}
              </Card>

              <Text type="supporting" color="secondary" display="block" className="mt-2 text-[10px]">
                {stored.createdAt > 0
                  ? editorMessage("editor.apiKeys.dates", { added: new Date(stored.createdAt).toLocaleDateString(getEditorLocale()), updated: new Date(stored.updatedAt).toLocaleDateString(getEditorLocale()) })
                  : editorMessage("editor.apiKeys.keychain")}
              </Text>
            </Card>
          );
        })}
      </div>

      {/* Add new key */}
      {addingService ? (
        <Card variant="green" padding={4} className="border border-primary/30">
          <div className="flex items-center gap-2 mb-3">
            <Plus size={14} className="text-primary" aria-hidden />
            <Text type="label" weight="bold">
              {editorMessage(SERVICE_REGISTRY.find((s) => s.id === addingService)?.keyOptional
                ? "editor.apiKeys.addOptional" : "editor.apiKeys.addRequired", {
                  service: serviceLabel(SERVICE_REGISTRY.find((s) => s.id === addingService)!),
                })}
            </Text>
          </div>
          <ToolcraftTextInputControl
            label={editorMessage("editor.apiKeys.key")}
            isLabelHidden
            type="password"
            value={newKeyValue}
            onChange={setNewKeyValue}
            placeholder={
              SERVICE_REGISTRY.find((s) => s.id === addingService)?.keyOptional
                ? editorMessage("editor.apiKeys.optionalPlaceholder")
                : editorMessage("editor.apiKeys.placeholder")
            }
            hasAutoFocus
            width="100%"
            className="mb-3 font-mono text-xs"
          />
          <div className="flex justify-end gap-2">
            <Button
              label={editorMessage("editor.apiKeys.cancel")}
              variant="secondary"
              size="sm"
              onClick={() => {
                setAddingService(null);
                setNewKeyValue("");
              }}
            />
            <Button
              label={editorMessage("editor.apiKeys.save")}
              variant="primary"
              size="sm"
              onClick={() => handleSaveKey(addingService)}
              isDisabled={!newKeyValue.trim()}
            />
          </div>
        </Card>
      ) : availableServices.length > 0 ? (
        <div>
          <Text as="h3" type="label" weight="bold" color="secondary" display="block" className="mb-3">{editorMessage("editor.apiKeys.add")}</Text>
          <div className="grid gap-2">
            {availableServices.map((service) => (
              <ClickableCard
                key={service.id}
                label={editorMessage(service.keyOptional ? "editor.apiKeys.addOptional" : "editor.apiKeys.addRequired", { service: serviceLabel(service) })}
                onClick={() => setAddingService(service.id)}
                padding={3}
                variant="default"
                className="border border-border"
              >
                <div className="flex items-center gap-3 text-left">
                  <div className="p-2 rounded-lg bg-background-tertiary">
                    <Plus size={14} className="text-primary" aria-hidden />
                  </div>
                  <div>
                    <Text type="label" weight="bold" display="block">
                      {service.keyOptional ? editorMessage("editor.apiKeys.optionalService", { service: serviceLabel(service) }) : serviceLabel(service)}
                    </Text>
                    <Text type="supporting" color="secondary" display="block">
                      {serviceDescriptionKeys[service.id] ? editorMessage(serviceDescriptionKeys[service.id]) : service.description}
                    </Text>
                  </div>
                </div>
              </ClickableCard>
            ))}
          </div>
        </div>
      ) : null}

      {passwordDialogMode && (
        <MasterPasswordDialog
          isOpen={!!passwordDialogMode}
          onClose={() => setPasswordDialogMode(null)}
          mode={passwordDialogMode}
          onSubmit={handlePasswordSubmit}
        />
      )}
    </div>
  );
};
