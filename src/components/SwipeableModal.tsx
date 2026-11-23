import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

interface SwipeableModalProps {
  isOpen: boolean;
  onClose: () => void;
  ariaLabel: string;
  title?: string;
  maxWidthClass?: string;
  disableDismiss?: boolean;
  headerContent?: React.ReactNode;
  children: React.ReactNode;
}

const EASE_OUT = 'cubic-bezier(0.165, 0.84, 0.44, 1)';
const EASE_SHEET_EXIT = 'cubic-bezier(0.32, 0.72, 0, 1)';
// Slight physical spring bounce ONLY on drag release snap-back (zero bounce on button opens/closes)
const SPRING_RELEASE_SNAP = 'cubic-bezier(0.22, 1.12, 0.36, 1)';

export const SwipeableModal: React.FC<SwipeableModalProps> = ({
  isOpen,
  onClose,
  ariaLabel,
  title,
  maxWidthClass = 'max-w-md',
  disableDismiss = false,
  headerContent,
  children,
}) => {
  const [rendered, setRendered] = useState(isOpen);
  const [visible, setVisible] = useState(false);

  const backdropRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{
    active: boolean;
    pointerId: number | null;
    startY: number;
    currentY: number;
    lastY: number;
    lastTime: number;
    velocityY: number;
  }>({
    active: false,
    pointerId: null,
    startY: 0,
    currentY: 0,
    lastY: 0,
    lastTime: 0,
    velocityY: 0,
  });

  const prefersReducedMotion = () =>
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const requestClose = useCallback(() => {
    if (disableDismiss) return;
    onClose();
  }, [disableDismiss, onClose]);

  useEffect(() => {
    if (isOpen) {
      setRendered(true);
      const raf = requestAnimationFrame(() => {
        setVisible(true);
      });
      return () => cancelAnimationFrame(raf);
    }

    setVisible(false);
    const delay = prefersReducedMotion() ? 10 : 210;
    const timer = window.setTimeout(() => {
      setRendered(false);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [isOpen]);

  useEffect(() => {
    if (!rendered) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        requestClose();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [rendered, requestClose]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disableDismiss) return;
    if ((e.target as HTMLElement).closest('button, a, input, select, textarea')) {
      return;
    }

    const panel = panelRef.current;
    const backdrop = backdropRef.current;
    if (!panel || !backdrop) return;

    e.currentTarget.setPointerCapture(e.pointerId);
    const now = performance.now();
    dragStateRef.current = {
      active: true,
      pointerId: e.pointerId,
      startY: e.clientY,
      currentY: 0,
      lastY: e.clientY,
      lastTime: now,
      velocityY: 0,
    };

    // TRACK phase: 1:1 direct manipulation, zero easing, zero duration
    panel.style.transition = 'none';
    backdrop.style.transition = 'none';
    panel.style.willChange = 'transform';
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const state = dragStateRef.current;
    if (!state.active || state.pointerId !== e.pointerId) return;

    const panel = panelRef.current;
    const backdrop = backdropRef.current;
    if (!panel || !backdrop) return;

    const now = performance.now();
    const rawDy = e.clientY - state.startY;
    // Allow slight rubber-band resistance upward, 1:1 tracking downward along dismiss axis
    const dy = rawDy < 0 ? rawDy * 0.2 : rawDy;
    const dt = Math.max(1, now - state.lastTime);
    state.velocityY = ((e.clientY - state.lastY) / dt) * 1000;
    state.lastY = e.clientY;
    state.lastTime = now;
    state.currentY = dy;

    const panelHeight = Math.max(240, panel.getBoundingClientRect().height);
    const progress = Math.max(0, Math.min(1, dy / panelHeight));
    const scale = 1 - progress * 0.03;

    // Linked progress: panel transform & backdrop opacity move directly in sync
    panel.style.transform = `translate3d(0, ${dy}px, 0) scale(${scale.toFixed(4)})`;
    backdrop.style.opacity = `${Math.max(0.12, 1 - progress * 0.85).toFixed(3)}`;
  };

  const handlePointerRelease = (e: React.PointerEvent<HTMLDivElement>) => {
    const state = dragStateRef.current;
    if (!state.active || state.pointerId !== e.pointerId) return;
    state.active = false;
    state.pointerId = null;

    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }

    const panel = panelRef.current;
    const backdrop = backdropRef.current;
    if (!panel || !backdrop) return;

    const panelHeight = Math.max(240, panel.getBoundingClientRect().height);
    const shouldDismiss =
      state.currentY >= panelHeight * 0.4 || state.velocityY > 500;
    const reduced = prefersReducedMotion();

    if (shouldDismiss) {
      if (reduced) {
        panel.style.transition = 'opacity 100ms ease-out';
        backdrop.style.transition = 'opacity 100ms ease-out';
        panel.style.opacity = '0';
        backdrop.style.opacity = '0';
        onClose();
        return;
      }

      panel.style.transition = `transform 220ms ${EASE_SHEET_EXIT}, opacity 200ms ${EASE_OUT}`;
      backdrop.style.transition = `opacity 200ms ${EASE_OUT}`;
      panel.style.transform = `translate3d(0, ${Math.round(panelHeight * 0.85)}px, 0) scale(0.96)`;
      panel.style.opacity = '0';
      backdrop.style.opacity = '0';
      window.setTimeout(() => {
        panel.style.willChange = 'auto';
        onClose();
      }, 180);
      return;
    }

    // Snap back: subtle physical spring bounce ONLY on drag release (disabled under reduced motion)
    const snapTiming = reduced
      ? `transform 120ms ${EASE_OUT}`
      : `transform 260ms ${SPRING_RELEASE_SNAP}`;
    panel.style.transition = snapTiming;
    backdrop.style.transition = `opacity 200ms ${EASE_OUT}`;
    panel.style.transform = 'translate3d(0, 0, 0) scale(1)';
    backdrop.style.opacity = '1';
    window.setTimeout(() => {
      if (panelRef.current) {
        panelRef.current.style.willChange = 'auto';
      }
    }, 280);
  };

  if (!rendered) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 overflow-y-auto safe-bottom"
    >
      {/* Linked Backdrop */}
      <div
        ref={backdropRef}
        onClick={requestClose}
        aria-hidden="true"
        className="fixed inset-0 bg-[#17201B]/85 backdrop-blur-sm"
        style={{
          opacity: visible ? 1 : 0,
          transition: `opacity 200ms ${EASE_OUT}`,
        }}
      />

      {/* Centered Dialog Surface with Concentric Radius & Vertical Swipe-to-Dismiss Handle */}
      <div
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
        className={`relative z-10 ${maxWidthClass} w-full bg-[#F5F3EC] dark:bg-[#1E2B23] border border-[#17201B]/15 dark:border-[#D7E07A]/20 rounded-xl overflow-hidden shadow-[0_24px_60px_-16px_rgba(0,0,0,0.45),0_4px_16px_-4px_rgba(0,0,0,0.2)] origin-center`}
        style={{
          opacity: visible ? 1 : 0,
          transform: visible
            ? 'translate3d(0, 0, 0) scale(1)'
            : 'translate3d(0, 12px, 0) scale(0.97)',
          filter: visible ? 'blur(0px)' : 'blur(2px)',
          transition: `transform 220ms ${EASE_OUT}, opacity 200ms ${EASE_OUT}, filter 200ms ${EASE_OUT}`,
        }}
      >
        {/* Drag Handle + Header Zone (touch-action: none on vertical swipe axis) */}
        <div
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerRelease}
          onPointerCancel={handlePointerRelease}
          className="touch-none select-none cursor-grab active:cursor-grabbing border-b border-[#17201B]/10 dark:border-[#F5F3EC]/10"
        >
          <div className="pt-2.5 flex justify-center" aria-hidden="true">
            <span className="w-9 h-1 rounded-full bg-[#17201B]/20 dark:bg-[#F5F3EC]/25" />
          </div>

          <div className="flex items-start justify-between gap-3 px-5 pt-2 pb-3.5">
            <div className="min-w-0 flex-1">
              {headerContent ? (
                headerContent
              ) : (
                <h3 className="text-sm font-semibold text-[#17201B] dark:text-[#F5F3EC] truncate">
                  {title}
                </h3>
              )}
            </div>
            {!disableDismiss && (
              <button
                type="button"
                onClick={requestClose}
                aria-label={`Close ${ariaLabel}`}
                className="hit-target-44 pressable p-1.5 rounded-lg text-[#17201B]/80 dark:text-[#F5F3EC]/80 hover-surface-tint transition-[transform,background-color,color] duration-150 ease-[cubic-bezier(0.165,0.84,0.44,1)] cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#294735] dark:focus-visible:ring-[#D7E07A]"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {children}
      </div>
    </div>
  );
};
