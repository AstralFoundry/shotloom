import type { SVGProps } from "react";

import { paths } from "../../../../shared/iconPaths";

export type IconName = keyof typeof paths;

interface IconSymbolProps extends SVGProps<SVGSVGElement> {
  name: IconName | string;
}

export function IconSymbol({ name, ...props }: IconSymbolProps) {
  const markup = paths[name as IconName] ?? paths.box;
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
      {...props}
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
}
