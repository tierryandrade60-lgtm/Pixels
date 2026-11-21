import { forwardRef, useImperativeHandle, useRef } from 'react';
import { ScreenFxState } from '../game/cinematicFx';

export interface ScreenFxOverlayHandle {
  update: (fx: ScreenFxState) => void;
  reset: () => void;
}

/**
 * Zero-rerender, GPU-composited cinematic overlay layer synchronized with
 * CinematicFxController. Renders radial vignette, edge energy glow, expanding
 * shockwave pulse ring, and subtle screen flash without obscuring gameplay.
 */
export const ScreenFxOverlay = forwardRef<ScreenFxOverlayHandle>(
  function ScreenFxOverlay(_props, ref) {
    const rootRef = useRef<HTMLDivElement | null>(null);
    const vignetteRef = useRef<HTMLDivElement | null>(null);
    const glowRef = useRef<HTMLDivElement | null>(null);
    const ringRef = useRef<HTMLDivElement | null>(null);
    const flashRef = useRef<HTMLDivElement | null>(null);
    const wasActiveRef = useRef(false);

    useImperativeHandle(ref, () => ({
      update(fx: ScreenFxState) {
        const root = rootRef.current;
        if (!root) return;

        if (!fx.active) {
          if (wasActiveRef.current) {
            wasActiveRef.current = false;
            root.style.display = 'none';
            if (vignetteRef.current) vignetteRef.current.style.opacity = '0';
            if (glowRef.current) glowRef.current.style.opacity = '0';
            if (ringRef.current) ringRef.current.style.opacity = '0';
            if (flashRef.current) flashRef.current.style.opacity = '0';
          }
          return;
        }

        if (!wasActiveRef.current) {
          wasActiveRef.current = true;
          root.style.display = 'block';
        }

        if (vignetteRef.current) {
          vignetteRef.current.style.opacity = fx.vignetteOpacity.toFixed(3);
          if (fx.vignetteOpacity > 0.004) {
            vignetteRef.current.style.backgroundImage = `radial-gradient(circle at center, transparent 42%, ${fx.vignetteColor} 100%)`;
          }
        }

        if (glowRef.current) {
          glowRef.current.style.opacity = fx.glowOpacity.toFixed(3);
          if (fx.glowOpacity > 0.004) {
            glowRef.current.style.backgroundImage = `radial-gradient(circle at center, transparent 54%, ${fx.glowColor} 100%)`;
          }
        }

        if (ringRef.current) {
          ringRef.current.style.opacity = fx.pulseOpacity.toFixed(3);
          if (fx.pulseOpacity > 0.004) {
            const scale = 0.25 + fx.pulseProgress * 1.65;
            ringRef.current.style.transform = `translate3d(-50%, -50%, 0) scale(${scale.toFixed(3)})`;
            ringRef.current.style.borderColor = fx.pulseColor;
            ringRef.current.style.boxShadow = `0 0 28px ${fx.pulseColor}, inset 0 0 22px ${fx.pulseColor}`;
          }
        }

        if (flashRef.current) {
          flashRef.current.style.opacity = fx.flashOpacity.toFixed(3);
          if (fx.flashOpacity > 0.004) {
            flashRef.current.style.backgroundImage = `radial-gradient(circle at center, rgba(255, 255, 255, 0.24) 0%, ${fx.flashColor} 64%, ${fx.flashColor} 100%)`;
          }
        }
      },
      reset() {
        wasActiveRef.current = false;
        if (rootRef.current) rootRef.current.style.display = 'none';
        if (vignetteRef.current) vignetteRef.current.style.opacity = '0';
        if (glowRef.current) glowRef.current.style.opacity = '0';
        if (ringRef.current) ringRef.current.style.opacity = '0';
        if (flashRef.current) flashRef.current.style.opacity = '0';
      },
    }));

    return (
      <div
        ref={rootRef}
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-[15] overflow-hidden select-none"
        style={{ display: 'none' }}
      >
        {/* 1. Edge Vignette */}
        <div
          ref={vignetteRef}
          className="absolute inset-0"
          style={{
            opacity: 0,
            willChange: 'opacity',
          }}
        />

        {/* 2. Magical / Fiery Edge Energy Glow */}
        <div
          ref={glowRef}
          className="absolute inset-0"
          style={{
            opacity: 0,
            mixBlendMode: 'screen',
            willChange: 'opacity',
          }}
        />

        {/* 3. Expanding Radial Energy Shockwave Ring */}
        <div
          ref={ringRef}
          className="absolute left-1/2 top-1/2 rounded-full"
          style={{
            width: '62vmax',
            height: '62vmax',
            borderWidth: '3px',
            borderStyle: 'solid',
            borderColor: 'rgba(255, 255, 255, 0.8)',
            opacity: 0,
            mixBlendMode: 'screen',
            transform: 'translate3d(-50%, -50%, 0) scale(0.25)',
            willChange: 'transform, opacity',
          }}
        />

        {/* 4. Subtle Radial Impact Flash (preserves center readability) */}
        <div
          ref={flashRef}
          className="absolute inset-0"
          style={{
            opacity: 0,
            mixBlendMode: 'screen',
            willChange: 'opacity',
          }}
        />
      </div>
    );
  },
);
