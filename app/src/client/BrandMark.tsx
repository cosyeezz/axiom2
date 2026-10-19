import icon from "../../assets/axiom-icon.svg";

/** Decorative brand image; its surrounding wordmark or link supplies the name. */
export function BrandMark({ size = 32, className = "" }: { size?: number; className?: string }) {
  return <img className={className} src={icon} width={size} height={size} alt="" aria-hidden="true" draggable={false} style={{ display: "block", flexShrink: 0, objectFit: "contain" }} />;
}
