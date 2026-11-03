import { editorMessage } from "../../../shotloom-mode";
import React, { useState, useCallback } from "react";
import { Lock, Eye, EyeOff, ShieldCheck, AlertTriangle } from "@/icons/lucide-compat";
import { ToolcraftButton as Button } from "@openreel/ui";
import { ToolcraftCard as Card } from "@openreel/ui";
import { ToolcraftDialog as Dialog, ToolcraftDialogHeader as DialogHeader } from "@openreel/ui";
import { ToolcraftIconButton as IconButton } from "@openreel/ui";
import { ToolcraftLayout as Layout, ToolcraftLayoutContent as LayoutContent, ToolcraftLayoutFooter as LayoutFooter } from "@openreel/ui";
import { ToolcraftText as Text } from "@openreel/ui";
import { ToolcraftTextInputControl } from "@openreel/ui";

interface MasterPasswordDialogProps {
  isOpen: boolean;
  onClose: () => void;
  mode: "setup" | "unlock" | "change";
  onSubmit: (password: string, newPassword?: string) => Promise<boolean>;
}

export const MasterPasswordDialog: React.FC<MasterPasswordDialogProps> = ({
  isOpen,
  onClose,
  mode,
  onSubmit,
}) => {
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const resetForm = useCallback(() => {
    setPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setShowPassword(false);
    setShowNewPassword(false);
    setError(null);
    setLoading(false);
  }, []);

  const handleClose = useCallback(() => {
    resetForm();
    onClose();
  }, [onClose, resetForm]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (mode === "setup") {
      if (password.length < 8) {
        setError(editorMessage("editor.masterPassword.short"));
        return;
      }
      if (password !== confirmPassword) {
        setError(editorMessage("editor.masterPassword.mismatch"));
        return;
      }
    }

    if (mode === "change") {
      if (newPassword.length < 8) {
        setError(editorMessage("editor.masterPassword.newShort"));
        return;
      }
      if (newPassword !== confirmPassword) {
        setError(editorMessage("editor.masterPassword.newMismatch"));
        return;
      }
    }

    setLoading(true);
    try {
      const success = await onSubmit(
        password,
        mode === "change" ? newPassword : undefined,
      );
      if (success) {
        resetForm();
      } else {
        setError(
          mode === "unlock"
            ? editorMessage("editor.masterPassword.incorrect")
            : editorMessage("editor.masterPassword.failed"),
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : editorMessage("editor.masterPassword.error"));
    } finally {
      setLoading(false);
    }
  }, [mode, password, newPassword, confirmPassword, onSubmit, resetForm]);

  const titles = {
    setup: editorMessage("editor.masterPassword.setupTitle"),
    unlock: editorMessage("editor.masterPassword.unlockTitle"),
    change: editorMessage("editor.masterPassword.changeTitle"),
  };

  const descriptions = {
    setup: editorMessage("editor.masterPassword.setupHelp"),
    unlock: editorMessage("editor.masterPassword.unlockHelp"),
    change: editorMessage("editor.masterPassword.changeHelp"),
  };

  return (
    <Dialog
      isOpen={isOpen}
      onOpenChange={(open) => !open && handleClose()}
      width={448}
      purpose="form"
    >
      <Layout
        header={
          <DialogHeader
            title={titles[mode]}
            subtitle={descriptions[mode]}
            onOpenChange={(open) => !open && handleClose()}
            startContent={<Lock size={18} className="text-primary" aria-hidden />}
          />
        }
        content={
          <LayoutContent>
        <form id="master-password-form" onSubmit={handleSubmit} className="space-y-4">
          {mode === "change" && (
            <div className="space-y-2">
              <div className="relative">
                <ToolcraftTextInputControl
                  label={editorMessage("editor.masterPassword.current")}
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={setPassword}
                  placeholder={editorMessage("editor.masterPassword.currentPlaceholder")}
                  hasAutoFocus
                  width="100%"
                  className="pr-10"
                />
                <IconButton
                  label={showPassword ? editorMessage("editor.masterPassword.hide") : editorMessage("editor.masterPassword.show")}
                  onClick={() => setShowPassword(!showPassword)}
                  variant="ghost"
                  size="sm"
                  icon={showPassword ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
                />
              </div>
            </div>
          )}

          {(mode === "setup" || mode === "unlock") && (
            <div className="space-y-2">
              <div className="relative">
                <ToolcraftTextInputControl
                  label={mode === "setup" ? editorMessage("editor.masterPassword.password") : editorMessage("editor.masterPassword.master")}
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={setPassword}
                  placeholder={
                    mode === "setup"
                      ? editorMessage("editor.masterPassword.min")
                      : editorMessage("editor.masterPassword.enterMaster")
                  }
                  hasAutoFocus
                  width="100%"
                  className="pr-10"
                />
                <IconButton
                  label={showPassword ? editorMessage("editor.masterPassword.hide") : editorMessage("editor.masterPassword.show")}
                  onClick={() => setShowPassword(!showPassword)}
                  variant="ghost"
                  size="sm"
                  icon={showPassword ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
                />
              </div>
            </div>
          )}

          {(mode === "setup" || mode === "change") && (
            <>
              <div className="space-y-2">
                <div className="relative">
                  <ToolcraftTextInputControl
                    label={mode === "change" ? editorMessage("editor.masterPassword.new") : editorMessage("editor.masterPassword.confirm")}
                    type={showNewPassword ? "text" : "password"}
                    value={mode === "change" ? newPassword : confirmPassword}
                    onChange={(value) =>
                      mode === "change"
                        ? setNewPassword(value)
                        : setConfirmPassword(value)
                    }
                    placeholder={
                      mode === "change"
                        ? editorMessage("editor.masterPassword.min")
                        : editorMessage("editor.masterPassword.repeat")
                    }
                    width="100%"
                    className="pr-10"
                  />
                  <IconButton
                    label={showNewPassword ? editorMessage("editor.masterPassword.hide") : editorMessage("editor.masterPassword.show")}
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    variant="ghost"
                    size="sm"
                    icon={showNewPassword ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
                  />
                </div>
              </div>

              {mode === "change" && (
                <div className="space-y-2">
                  <ToolcraftTextInputControl
                    label={editorMessage("editor.masterPassword.confirmNew")}
                    type={showNewPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={setConfirmPassword}
                    placeholder={editorMessage("editor.masterPassword.repeatNew")}
                    width="100%"
                  />
                </div>
              )}
            </>
          )}

          {error && (
            <Card variant="red" padding={2} className="flex items-center gap-2 bg-error/10 text-sm text-error">
              <AlertTriangle size={14} />
              {error}
            </Card>
          )}

          {mode === "setup" && (
            <Card variant="muted" padding={2} className="flex items-start gap-2 bg-background-secondary">
              <ShieldCheck size={14} className="mt-0.5 shrink-0 text-primary" />
              <Text type="supporting" color="secondary" className="text-xs">{editorMessage("editor.masterPassword.security")}</Text>
            </Card>
          )}
        </form>
          </LayoutContent>
        }
        footer={
          <LayoutFooter hasDivider>
            <div className="flex justify-end gap-2">
              <Button
                label={editorMessage("editor.masterPassword.cancel")}
                variant="secondary"
                onClick={handleClose}
                isDisabled={loading}
              />
              <Button
                label={
                  loading
                    ? editorMessage("editor.masterPassword.processing")
                    : mode === "setup"
                      ? editorMessage("editor.masterPassword.set")
                      : mode === "unlock"
                        ? editorMessage("editor.masterPassword.unlock")
                        : editorMessage("editor.masterPassword.change")
                }
                type="submit"
                form="master-password-form"
                isDisabled={loading}
                variant="primary"
              />
            </div>
          </LayoutFooter>
        }
      />
    </Dialog>
  );
};
