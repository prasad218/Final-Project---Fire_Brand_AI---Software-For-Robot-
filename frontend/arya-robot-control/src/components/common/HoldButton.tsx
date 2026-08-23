import { useRef, type ButtonHTMLAttributes, type ReactNode } from "react";

interface HoldButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onHoldStart" | "onHoldEnd"> {
  onHoldStart: () => void;
  onHoldEnd: () => void;
  children: ReactNode;
}

/** A button that fires onHoldStart while pressed and onHoldEnd on release —
 * mouse, touch and pen all handled via the Pointer Events API, with pointer
 * capture so dragging off the button edge (common on touch) still delivers
 * the eventual "up" instead of stranding the drive input in the held state. */
export function HoldButton({ onHoldStart, onHoldEnd, children, className, ...rest }: HoldButtonProps) {
  const active = useRef(false);

  function down(e: React.PointerEvent<HTMLButtonElement>) {
    e.preventDefault();
    if (active.current) return;
    active.current = true;
    onHoldStart();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore -- not all environments support pointer capture
    }
  }

  function up(e: React.PointerEvent<HTMLButtonElement>) {
    if (!active.current) return;
    active.current = false;
    onHoldEnd();
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  }

  return (
    <button
      type="button"
      className={className}
      onPointerDown={down}
      onPointerUp={up}
      onPointerCancel={up}
      onLostPointerCapture={(e) => {
        if (active.current) up(e);
      }}
      onContextMenu={(e) => e.preventDefault()}
      {...rest}
    >
      {children}
    </button>
  );
}
