import { Input } from "antd";
import { IconSymbol } from "./IconSymbol";

/**
 * 统一的搜索框：图标前缀、清空按钮和受控值都由 antd Input 提供。
 * 外层 wrapper 保留各自的尺寸与边框，这里只负责把输入行为和键盘语义统一起来。
 */
export function SearchInput({ value, onChange, placeholder, ariaLabel, autoFocus }: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  ariaLabel?: string;
  autoFocus?: boolean;
}) {
  return (
    <Input
      variant="borderless"
      allowClear
      value={value}
      autoFocus={autoFocus}
      placeholder={placeholder}
      aria-label={ariaLabel ?? placeholder}
      prefix={<IconSymbol name="search" />}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
