import { useState } from "react";
import { pluginIconSource } from "../../../../shared/pluginIcon";
import { getProviderIcon } from "../../domain/provider/ProviderBrandIcons.ts";

interface ProviderBrandIconProps {
  icon?: string;
  src?: string | undefined;
  className?: string;
  decorative?: boolean;
}

export function ProviderBrandIcon({
  icon = "custom",
  src,
  className = "",
  decorative = true,
}: ProviderBrandIconProps) {
  const [failedSource, setFailedSource] = useState<string>();
  const imageSource = pluginIconSource(src);
  const brand = getProviderIcon(icon) || { src: "", label: "" };
  return (
    <img
      className={`provider-brand-icon ${className}`.trim()}
      src={imageSource && imageSource !== failedSource ? imageSource : brand.src}
      onError={() => setFailedSource(imageSource)}
      alt={decorative ? "" : brand.label}
      aria-hidden={decorative || undefined}
    />
  );
}
