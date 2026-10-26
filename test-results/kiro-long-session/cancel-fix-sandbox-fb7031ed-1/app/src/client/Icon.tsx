import type { SVGProps } from "react";

/** Shared non-brand glyphs. Geometry and licenses live in icons.svg. */
export function Icon({ name, className = "", ...props }: SVGProps<SVGSVGElement> & { name: string }) {
  return <svg className={`ui-glyph ${className}`.trim()} aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" {...props}><use href={`#i-${name}`} /></svg>;
}
