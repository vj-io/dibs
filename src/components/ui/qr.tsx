import QRCode from "qrcode";
import { cx } from "./cx";

/** QR code as crisp SVG (server or client). Ink on card with the quiet zone included. */
export function QR({ value, size = 192, label, className }: { value: string; size?: number; label?: string; className?: string }) {
  const { modules } = QRCode.create(value, { errorCorrectionLevel: "M" });
  const n = modules.size, q = 4;
  let d = "";
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (modules.get(y, x)) d += `M${x + q} ${y + q}h1v1h-1z`;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${n + q * 2} ${n + q * 2}`} shapeRendering="crispEdges"
      role="img" aria-label={label ?? `QR code for ${value}`} className={cx("rounded-md border-[2.5px] border-ink bg-card", className)}>
      <path d={d} fill="var(--color-ink)" />
    </svg>
  );
}
