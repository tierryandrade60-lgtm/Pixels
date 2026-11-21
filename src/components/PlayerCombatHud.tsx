import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import {
  ActiveStatusEffect,
  MultiKillEvent,
  PlayerCombatTelemetry,
  StatusEffectCategory,
} from '../game/statusEffectTypes';

export interface PlayerCombatHudHandle {
  updateTelemetry: (telemetry: PlayerCombatTelemetry) => void;
  triggerMultiKill: (event: MultiKillEvent) => void;
  reset: () => void;
}

const MAX_PROTECTED_TAGS = 8;

const STATUS_SLOTS: ReadonlyArray<{
  id: StatusEffectCategory;
  accent: string;
  bg: string;
  defaultLabel: string;
  defaultDesc: string;
}> = [
  {
    id: 'shield',
    accent: '#38BDF8',
    bg: '#13263B',
    defaultLabel: 'Active Shield',
    defaultDesc: 'Absorbs incoming damage.',
  },
  {
    id: 'health-recovery',
    accent: '#4ADE80',
    bg: '#132D22',
    defaultLabel: 'Health Recovery',
    defaultDesc: 'Restoring health over time.',
  },
  {
    id: 'dot',
    accent: '#FB923C',
    bg: '#381B14',
    defaultLabel: 'Damage Over Time',
    defaultDesc: 'Taking lingering damage.',
  },
  {
    id: 'paralyzed',
    accent: '#FACC15',
    bg: '#352B11',
    defaultLabel: 'Paralyzed',
    defaultDesc: 'Movement temporarily restricted.',
  },
  {
    id: 'no-powers',
    accent: '#F43F5E',
    bg: '#381427',
    defaultLabel: 'No Powers',
    defaultDesc: 'Abilities temporarily suppressed.',
  },
];

interface StatusSlotRefs {
  root: HTMLButtonElement | null;
  veil: HTMLDivElement | null;
  timerText: HTMLSpanElement | null;
}

interface ProtectedTagRefs {
  root: HTMLDivElement | null;
  label: HTMLSpanElement | null;
}

function StatusEffectSvg({ id, color }: { id: StatusEffectCategory; color: string }) {
  switch (id) {
    case 'no-powers':
      return (
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M13.5 3L7 13H12L10.5 21L17 11H12L13.5 3Z"
            fill={color}
            fillOpacity="0.45"
            stroke="#FFFFFF"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <line
            x1="4.5"
            y1="4.5"
            x2="19.5"
            y2="19.5"
            stroke="#FF4D6D"
            strokeWidth="2.6"
            strokeLinecap="round"
          />
        </svg>
      );
    case 'paralyzed':
      return (
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M13.5 2.5L6.5 13H11.5L10.5 21.5L17.5 11H12.5L13.5 2.5Z"
            fill={color}
            stroke="#0B0D18"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
          <path
            d="M4 9.5C3.2 11 3.2 13 4 14.5M20 9.5C20.8 11 20.8 13 20 14.5"
            stroke="#FEF08A"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      );
    case 'health-recovery':
      return (
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M9.5 4H14.5V9.5H20V14.5H14.5V20H9.5V14.5H4V9.5H9.5V4Z"
            fill={color}
            stroke="#0B0D18"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
        </svg>
      );
    case 'dot':
      return (
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M12.4 2.8C12.4 2.8 17.5 6.8 17.5 12.2C17.5 15.8 15 19.2 12 19.8C8.9 19.2 6.5 15.9 6.5 12.4C6.5 9.6 8 7.4 9.3 6.2C9.3 6.2 9.4 9.1 11 10C10.5 7.2 12.4 2.8 12.4 2.8Z"
            fill={color}
            stroke="#0B0D18"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <circle cx="12" cy="14.5" r="2.2" fill="#FEF08A" />
        </svg>
      );
    case 'shield':
      return (
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M12 3L19 6.2V11.6C19 16 15.9 19.4 12 21C8.1 19.4 5 16 5 11.6V6.2L12 3Z"
            fill={color}
            stroke="#0B0D18"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path
            d="M12 6.2V17.4"
            stroke="#E0F2FE"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      );
  }
}

export const PlayerCombatHud = forwardRef<PlayerCombatHudHandle>(
  function PlayerCombatHud(_props, ref) {
    // Shield bar right of character
    const shieldRootRef = useRef<HTMLDivElement | null>(null);
    const shieldFillRef = useRef<HTMLDivElement | null>(null);
    const shieldTextRef = useRef<HTMLSpanElement | null>(null);

    // Kill streak above player head
    const streakRootRef = useRef<HTMLDivElement | null>(null);
    const streakTextRef = useRef<HTMLSpanElement | null>(null);

    // "Protected" torso tags
    const protectedRefs = useRef<ProtectedTagRefs[]>(
      Array.from({ length: MAX_PROTECTED_TAGS }, () => ({
        root: null,
        label: null,
      })),
    );

    // Bottom-left status slots
    const statusRefs = useRef<Record<StatusEffectCategory, StatusSlotRefs>>({
      shield: { root: null, veil: null, timerText: null },
      'health-recovery': { root: null, veil: null, timerText: null },
      dot: { root: null, veil: null, timerText: null },
      paralyzed: { root: null, veil: null, timerText: null },
      'no-powers': { root: null, veil: null, timerText: null },
    });

    const latestEffectsRef = useRef<
      Partial<Record<StatusEffectCategory, ActiveStatusEffect>>
    >({});
    const [inspectedEffect, setInspectedEffect] =
      useState<ActiveStatusEffect | null>(null);
    const inspectedIdRef = useRef<StatusEffectCategory | null>(null);

    const [multiKill, setMultiKill] = useState<MultiKillEvent | null>(null);
    const multiKillTimerRef = useRef<number>(0);

    const clearTelemetryNodes = useCallback(() => {
      if (shieldRootRef.current) shieldRootRef.current.style.display = 'none';
      if (streakRootRef.current) streakRootRef.current.style.display = 'none';
      for (let i = 0; i < MAX_PROTECTED_TAGS; i++) {
        const tag = protectedRefs.current[i];
        if (tag?.root) tag.root.style.display = 'none';
      }
      for (const slot of STATUS_SLOTS) {
        const refEntry = statusRefs.current[slot.id];
        if (refEntry?.root) refEntry.root.style.display = 'none';
      }
      latestEffectsRef.current = {};
      inspectedIdRef.current = null;
      setInspectedEffect(null);
    }, []);

    useEffect(() => {
      return () => {
        window.clearTimeout(multiKillTimerRef.current);
      };
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        updateTelemetry(t: PlayerCombatTelemetry) {
          // 1. Vertical Shield Bar beside right side of character
          const shieldRoot = shieldRootRef.current;
          if (shieldRoot) {
            if (t.playerShield.active && t.playerShield.maxHp > 0 && t.playerShield.hp > 0) {
              shieldRoot.style.display = 'flex';
              shieldRoot.style.transform = `translate3d(${t.playerShield.screenX.toFixed(1)}px, ${t.playerShield.screenY.toFixed(1)}px, 0) translate(-50%, -50%)`;
              const pct = Math.max(
                0,
                Math.min(100, (t.playerShield.hp / t.playerShield.maxHp) * 100),
              );
              if (shieldFillRef.current) {
                shieldFillRef.current.style.height = `${pct.toFixed(1)}%`;
                shieldFillRef.current.style.backgroundColor = t.playerShield.color;
              }
              if (shieldTextRef.current) {
                const hpLabel = `${Math.ceil(t.playerShield.hp)}`;
                if (shieldTextRef.current.textContent !== hpLabel) {
                  shieldTextRef.current.textContent = hpLabel;
                }
              }
            } else {
              shieldRoot.style.display = 'none';
            }
          }

          // 2. Kill Streak badge above player head (starts at 1+)
          const streakRoot = streakRootRef.current;
          if (streakRoot) {
            if (t.playerHeadVisible && t.killStreak >= 1) {
              streakRoot.style.display = 'flex';
              streakRoot.style.transform = `translate3d(${t.playerHeadX.toFixed(1)}px, ${t.playerHeadY.toFixed(1)}px, 0) translate(-50%, -100%)`;
              if (streakTextRef.current) {
                const label = `${t.killStreak} STREAK`;
                if (streakTextRef.current.textContent !== label) {
                  streakTextRef.current.textContent = label;
                }
              }
            } else {
              streakRoot.style.display = 'none';
            }
          }

          // 3. "Protected" torso popup tags
          for (let i = 0; i < MAX_PROTECTED_TAGS; i++) {
            const slot = protectedRefs.current[i];
            const snap = t.protectedTags[i];
            if (!slot?.root) continue;
            if (!snap || !snap.active) {
              slot.root.style.display = 'none';
              continue;
            }
            const p = Math.max(0, Math.min(1, snap.progress));
            const riseY = -p * 26;
            const scale = p < 0.22 ? 0.72 + (p / 0.22) * 0.38 : 1.1 - p * 0.14;
            const alpha = p > 0.65 ? Math.max(0, 1 - (p - 0.65) / 0.35) : 1;
            slot.root.style.display = 'block';
            slot.root.style.opacity = alpha.toFixed(3);
            slot.root.style.transform = `translate3d(${snap.screenX.toFixed(1)}px, ${(snap.screenY + riseY).toFixed(1)}px, 0) translate(-50%, -50%) scale(${scale.toFixed(3)})`;
            if (slot.label) {
              slot.label.style.color = snap.color;
            }
          }

          // 4. Bottom-Left Status Effect square indicators
          const activeById: Partial<Record<StatusEffectCategory, ActiveStatusEffect>> = {};
          for (const eff of t.statusEffects) {
            activeById[eff.id] = eff;
          }
          latestEffectsRef.current = activeById;

          for (const meta of STATUS_SLOTS) {
            const slot = statusRefs.current[meta.id];
            const eff = activeById[meta.id];
            if (!slot?.root) continue;

            if (!eff) {
              slot.root.style.display = 'none';
              continue;
            }

            slot.root.style.display = 'flex';
            const infinite = !Number.isFinite(eff.remainingSec);
            const ratio = infinite
              ? 1
              : Math.max(
                  0,
                  Math.min(1, eff.remainingSec / Math.max(0.1, eff.totalSec)),
                );
            if (slot.veil) {
              slot.veil.style.transform = `scaleY(${(1 - ratio).toFixed(3)})`;
            }
            if (slot.timerText) {
              const text = infinite
                ? 'ON'
                : eff.remainingSec >= 10
                  ? `${Math.ceil(eff.remainingSec)}s`
                  : `${eff.remainingSec.toFixed(1)}s`;
              if (slot.timerText.textContent !== text) {
                slot.timerText.textContent = text;
              }
            }
          }

          if (inspectedIdRef.current && !activeById[inspectedIdRef.current]) {
            inspectedIdRef.current = null;
            setInspectedEffect(null);
          }
        },

        triggerMultiKill(event: MultiKillEvent) {
          window.clearTimeout(multiKillTimerRef.current);
          setMultiKill(event);
          multiKillTimerRef.current = window.setTimeout(() => {
            setMultiKill(null);
          }, 2200);
        },

        reset() {
          window.clearTimeout(multiKillTimerRef.current);
          setMultiKill(null);
          clearTelemetryNodes();
        },
      }),
      [clearTelemetryNodes],
    );

    const handleInspect = (id: StatusEffectCategory) => {
      const eff = latestEffectsRef.current[id];
      if (!eff) return;
      if (inspectedIdRef.current === id) {
        inspectedIdRef.current = null;
        setInspectedEffect(null);
      } else {
        inspectedIdRef.current = id;
        setInspectedEffect(eff);
      }
    };

    const handleHoverStart = (id: StatusEffectCategory) => {
      const eff = latestEffectsRef.current[id];
      if (!eff) return;
      inspectedIdRef.current = id;
      setInspectedEffect(eff);
    };

    const handleHoverEnd = (id: StatusEffectCategory) => {
      if (inspectedIdRef.current === id) {
        inspectedIdRef.current = null;
        setInspectedEffect(null);
      }
    };

    return (
      <div className="pointer-events-none fixed inset-0 z-20 overflow-hidden select-none">
        {/* Vertical Shield Health Bar (Right side of character) */}
        <div
          ref={shieldRootRef}
          style={{
            display: 'none',
            position: 'absolute',
            left: 0,
            top: 0,
            willChange: 'transform',
          }}
          className="flex-col items-center gap-[3px]"
        >
          <div
            className="relative flex flex-col justify-end overflow-hidden rounded-[4px]"
            style={{
              width: '10px',
              height: '58px',
              backgroundColor: '#121324',
              border: '2px solid #0B0D18',
              boxShadow: '1.5px 2px 0 rgba(8, 10, 18, 0.88)',
            }}
          >
            <div
              ref={shieldFillRef}
              className="w-full"
              style={{
                height: '100%',
                backgroundColor: '#FF2956',
                backgroundImage:
                  'linear-gradient(90deg, rgba(255,255,255,0.28) 0%, rgba(255,255,255,0) 60%)',
                transition: 'height 80ms linear',
              }}
            />
          </div>
          <span
            ref={shieldTextRef}
            className="font-cartoon text-[9.5px] font-extrabold italic leading-none tabular-nums text-white"
            style={{
              WebkitTextStroke: '2.5px #0B0D18',
              paintOrder: 'stroke fill',
              textShadow: '0 1px 0 #0B0D18',
            }}
          >
            100
          </span>
        </div>

        {/* Kill Streak Counter Above Player Head */}
        <div
          ref={streakRootRef}
          style={{
            display: 'none',
            position: 'absolute',
            left: 0,
            top: 0,
            willChange: 'transform',
          }}
          className="items-center gap-1 rounded-[5px] px-1.5 py-[2px]"
        >
          <div
            className="flex items-center gap-1 rounded-[5px] px-2 py-[2px]"
            style={{
              backgroundColor: '#191B34',
              border: '2px solid #0B0D18',
              boxShadow: '1.5px 2px 0 rgba(8, 10, 18, 0.9)',
            }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M12.5 2.5C12.5 2.5 18 6.8 18 12.6C18 16.5 15.2 20 12 20.5C8.8 20 6 16.5 6 12.7C6 9.9 7.6 7.4 9 6C9 6 9.2 9.1 10.9 10.1C10.5 7 12.5 2.5 12.5 2.5Z"
                fill="#FFD147"
                stroke="#0B0D18"
                strokeWidth="1.6"
              />
            </svg>
            <span
              ref={streakTextRef}
              className="whitespace-nowrap font-cartoon text-[10px] font-extrabold italic uppercase leading-none text-[#FFD147]"
              style={{
                textShadow: '0 1.5px 0 #0B0D18',
              }}
            >
              1 STREAK
            </span>
          </div>
        </div>

        {/* Animated "Protected" Torso Popup Tags */}
        {Array.from({ length: MAX_PROTECTED_TAGS }).map((_, idx) => (
          <div
            key={idx}
            ref={(el) => {
              protectedRefs.current[idx].root = el;
            }}
            style={{
              display: 'none',
              position: 'absolute',
              left: 0,
              top: 0,
              willChange: 'transform, opacity',
            }}
          >
            <span
              ref={(el) => {
                protectedRefs.current[idx].label = el;
              }}
              className="block whitespace-nowrap font-cartoon text-[14px] font-extrabold italic uppercase tracking-wide"
              style={{
                color: '#7DD3FC',
                WebkitTextStroke: '3.5px #0B0D18',
                paintOrder: 'stroke fill',
                textShadow: '1.5px 2px 0 #0B0D18',
              }}
            >
              Protected
            </span>
          </div>
        ))}

        {/* Multi-Kill Celebration Banner */}
        {multiKill && (
          <div
            key={multiKill.key}
            className="animate-cartoon-pop-in fixed left-1/2 z-30 -translate-x-1/2"
            style={{
              top: 'calc(max(12px, var(--stage-safe-top, 0px)) + 68px)',
            }}
          >
            <div
              className="rounded-[7px] px-3.5 py-1.5"
              style={{
                backgroundColor: '#1E142D',
                border: '2.5px solid #FFD147',
                boxShadow: '2.5px 3.5px 0 #0B0D18',
                transform: 'skewX(-8deg)',
              }}
            >
              <span
                className="block whitespace-nowrap font-cartoon font-extrabold italic uppercase tracking-wider text-[#FFD147]"
                style={{
                  fontSize: 'clamp(14px, 2.2vw, 20px)',
                  WebkitTextStroke: '3px #0B0D18',
                  paintOrder: 'stroke fill',
                  textShadow: '0 2px 0 #0B0D18',
                }}
              >
                {multiKill.title}
              </span>
            </div>
          </div>
        )}

        {/* Bottom-Left Status Effect Square Indicators */}
        <div
          className="fixed z-30 flex flex-col items-start gap-1.5"
          style={{
            left: 'max(12px, calc(var(--stage-safe-left, 0px) + 10px))',
            bottom: 'max(14px, calc(var(--stage-safe-bottom, 0px) + 10px))',
          }}
        >
          {/* Tap / Hover Effect Description Card */}
          {inspectedEffect && (
            <div
              className="animate-cartoon-pop-in pointer-events-none max-w-[210px] rounded-[6px] px-2.5 py-1.5"
              style={{
                backgroundColor: '#16182F',
                border: '2px solid #0B0D18',
                boxShadow: '2px 2.5px 0 rgba(8, 10, 18, 0.92)',
              }}
            >
              <div className="font-cartoon text-[10.5px] font-extrabold italic uppercase leading-tight text-white">
                {inspectedEffect.label}
              </div>
              <div className="mt-0.5 font-cartoon text-[9.5px] font-semibold leading-snug text-[#D6DCFF]">
                {inspectedEffect.description}
              </div>
            </div>
          )}

          <div className="flex items-center gap-1.5">
            {STATUS_SLOTS.map((slot) => (
              <button
                key={slot.id}
                ref={(el) => {
                  statusRefs.current[slot.id].root = el;
                }}
                type="button"
                aria-label={slot.defaultLabel}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  handleInspect(slot.id);
                }}
                onMouseEnter={() => handleHoverStart(slot.id)}
                onMouseLeave={() => handleHoverEnd(slot.id)}
                style={{
                  display: 'none',
                  width: '36px',
                  height: '36px',
                  backgroundColor: slot.bg,
                  border: `2px solid ${slot.accent}`,
                  boxShadow: '1.5px 2px 0 #0B0D18',
                  touchAction: 'manipulation',
                }}
                className="pointer-events-auto relative items-center justify-center overflow-hidden rounded-[6px] focus:outline-none"
              >
                {/* Remaining Time Sweep Veil (top-to-bottom elapsed darken) */}
                <div
                  ref={(el) => {
                    statusRefs.current[slot.id].veil = el;
                  }}
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0"
                  style={{
                    backgroundColor: 'rgba(8, 10, 20, 0.68)',
                    transformOrigin: 'top center',
                    transform: 'scaleY(0)',
                  }}
                />

                <div className="relative z-10 -mt-1.5 flex items-center justify-center">
                  <StatusEffectSvg id={slot.id} color={slot.accent} />
                </div>

                <span
                  ref={(el) => {
                    statusRefs.current[slot.id].timerText = el;
                  }}
                  className="pointer-events-none absolute bottom-[1.5px] inset-x-0 z-10 text-center font-cartoon text-[8.5px] font-extrabold tabular-nums leading-none text-white"
                  style={{
                    textShadow: '0 1px 0 #0B0D18',
                  }}
                >
                  0.0s
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  },
);
