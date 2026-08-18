import { getProviderIcon } from "../../domain/provider/ProviderBrandIcons.js";

interface ProviderBrandIconProps {
  icon?: string;
  className?: string;
  decorative?: boolean;
}

export function ProviderBrandIcon({
  icon = "custom",
  className = "",
  decorative = true,
}: ProviderBrandIconProps) {
  const brand = getProviderIcon(icon) || { src: "", label: "" };
  return (
    <img
      className={`provider-brand-icon ${className}`.trim()}
      src={brand.src}
      alt={decorative ? "" : brand.label}
      aria-hidden={decorative || undefined}
    />
  );
}
