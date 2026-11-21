import { forwardRef, useImperativeHandle, useRef } from 'react';
import { NpcHudSnapshot } from '../game/npcSystem';

export interface CombatOverlayHudHandle {
  update: (snapshots: NpcHudSnapshot[]) => void;
}

const MAX_NPC_SLOTS = 24;
const BAR_SEGMENTS = 10;

interface SlotRefs {
  root: HTMLDivElement | null;
  arrow: HTMLDivElement | null;
  nameLabel: HTMLSpanElement | null;
  trailFill: HTMLDivElement | null;
  hpFill: HTMLDivElement | null;
  dmgWrap: HTMLDivElement | null;
  dmgText: HTMLSpanElement | null;
}

/**
 * Zero-rerender floating Combat Overlay HUD driven imperatively every frame:
 * - Slanted segmented crimson NPC & AI Hero health bars with white delayed damage trail
 * - Downward crimson V-arrow strictly above the currently aim-assisted target
 * - Dynamic NPC / Hero name labels
 * - Larger floating comic damage numbers with minus sign ("-30") drifting away from target
 */
export const CombatOverlayHud = forwardRef<CombatOverlayHudHandle>(
  function CombatOverlayHud(_props, ref) {
    const slotsRef = useRef<SlotRefs[]>(
      Array.from({ length: MAX_NPC_SLOTS }, () => ({
        root: null,
        arrow: null,
        nameLabel: null,
        trailFill: null,
        hpFill: null,
        dmgWrap: null,
        dmgText: null,
      })),
    );

    useImperativeHandle(ref, () => ({
      update(snapshots: NpcHudSnapshot[]) {
        for (let i = 0; i < MAX_NPC_SLOTS; i++) {
          const slot = slotsRef.current[i];
          const snap = snapshots[i];
          if (!slot.root) continue;

          if (!snap || !snap.visible) {
            slot.root.style.display = 'none';
            continue;
          }

          slot.root.style.display = 'block';
          slot.root.style.transformOrigin = 'bottom center';
          slot.root.style.transform = `translate3d(${snap.screenX.toFixed(1)}px, ${snap.screenY.toFixed(1)}px, 0) translate(-50%, -100%) scale(${snap.scale.toFixed(3)})`;

          if (slot.arrow) {
            slot.arrow.style.display = snap.isTargeted ? 'flex' : 'none';
          }

          if (slot.nameLabel) {
            if (slot.nameLabel.textContent !== snap.name) {
              slot.nameLabel.textContent = snap.name;
            }
          }

          const hpPct =
            snap.maxHp > 0 ? Math.max(0, Math.min(100, (snap.hp / snap.maxHp) * 100)) : 0;
          const trailPct =
            snap.maxHp > 0
              ? Math.max(hpPct, Math.min(100, (snap.trailHp / snap.maxHp) * 100))
              : 0;

          if (slot.hpFill) {
            slot.hpFill.style.width = `${hpPct.toFixed(1)}%`;
            slot.hpFill.style.opacity = snap.hp > 0 ? '1' : '0';
          }
          if (slot.trailFill) {
            slot.trailFill.style.width = `${trailPct.toFixed(1)}%`;
            slot.trailFill.style.opacity = snap.hp > 0 ? '1' : '0';
          }

          if (slot.dmgWrap && slot.dmgText) {
            if (snap.damageNumber.active && snap.damageNumber.total > 0) {
              slot.dmgWrap.style.display = 'block';
              slot.dmgWrap.style.opacity = snap.damageNumber.opacity.toFixed(3);
              slot.dmgWrap.style.transform = `translate3d(${snap.damageNumber.offsetX.toFixed(1)}px, ${snap.damageNumber.offsetY.toFixed(1)}px, 0) translate(-50%, 0) scale(${snap.damageNumber.scale.toFixed(3)})`;
              const textStr = `-${Math.round(snap.damageNumber.total)}`;
              if (slot.dmgText.textContent !== textStr) {
                slot.dmgText.textContent = textStr;
              }
            } else {
              slot.dmgWrap.style.display = 'none';
            }
          }
        }
      },
    }));

    return (
      <div className="pointer-events-none fixed inset-0 z-10 overflow-hidden select-none">
        {Array.from({ length: MAX_NPC_SLOTS }).map((_, idx) => (
          <div
            key={idx}
            ref={(el) => {
              slotsRef.current[idx].root = el;
            }}
            style={{
              display: 'none',
              position: 'absolute',
              left: 0,
              top: 0,
              willChange: 'transform',
            }}
          >
            {/* Target Aim-Assist Indicator: small crimson downward V-arrow */}
            <div
              ref={(el) => {
                slotsRef.current[idx].arrow = el;
              }}
              style={{ display: 'none' }}
              className="mb-1 flex items-center justify-center"
            >
              <svg
                width="20"
                height="16"
                viewBox="0 0 24 20"
                fill="none"
                aria-hidden="true"
                style={{
                  filter: 'drop-shadow(0 1.5px 0 #0B0D18)',
                }}
              >
                <path
                  d="M3.5 3.5L12 16.5L20.5 3.5L12 7.4L3.5 3.5Z"
                  fill="#FF2942"
                  stroke="#0B0D18"
                  strokeWidth="2.2"
                  strokeLinejoin="round"
                />
              </svg>
            </div>

            {/* Compact Enemy Name Tag + Slanted Segmented Red Bar with White Trail */}
            <div className="flex flex-col items-center">
              <span
                ref={(el) => {
                  slotsRef.current[idx].nameLabel = el;
                }}
                className="mb-[2px] whitespace-nowrap font-cartoon text-[10px] font-extrabold italic uppercase tracking-wide text-white"
                style={{
                  WebkitTextStroke: '2.5px #0B0D18',
                  paintOrder: 'stroke fill',
                  textShadow: '0 1px 0 #0B0D18',
                }}
              >
                Thug
              </span>

              <div
                className="relative overflow-hidden"
                style={{
                  width: '104px',
                  height: '14px',
                  backgroundColor: '#161724',
                  border: '2.5px solid #0B0D18',
                  boxShadow: '1.5px 2px 0 rgba(8, 10, 18, 0.88)',
                  transform: 'skewX(-12deg)',
                }}
              >
                {/* White delayed recently-lost damage trail */}
                <div
                  ref={(el) => {
                    slotsRef.current[idx].trailFill = el;
                  }}
                  className="absolute inset-y-0 left-0"
                  style={{
                    width: '100%',
                    backgroundColor: '#FFFFFF',
                  }}
                />

                {/* Crimson immediate health fill */}
                <div
                  ref={(el) => {
                    slotsRef.current[idx].hpFill = el;
                  }}
                  className="absolute inset-y-0 left-0"
                  style={{
                    width: '100%',
                    backgroundColor: '#E5283B',
                    backgroundImage:
                      'linear-gradient(180deg, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0) 45%, rgba(0,0,0,0.18) 100%)',
                  }}
                />

                {/* Crisp comic segment separators */}
                <div className="pointer-events-none absolute inset-0 flex">
                  {Array.from({ length: BAR_SEGMENTS }).map((__, segIdx) => (
                    <div
                      key={segIdx}
                      className="h-full flex-1"
                      style={{
                        borderRight:
                          segIdx < BAR_SEGMENTS - 1
                            ? '1.5px solid rgba(11, 13, 24, 0.85)'
                            : 'none',
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>

            {/* Independent Floating Aggregated Damage Number ("-30", larger, drifts away) */}
            <div
              ref={(el) => {
                slotsRef.current[idx].dmgWrap = el;
              }}
              style={{
                display: 'none',
                position: 'absolute',
                left: '50%',
                top: '8px',
                transformOrigin: 'center center',
                willChange: 'transform, opacity',
              }}
            >
              <span
                ref={(el) => {
                  slotsRef.current[idx].dmgText = el;
                }}
                className="block whitespace-nowrap font-cartoon font-extrabold italic leading-none text-[#FF3B4E]"
                style={{
                  fontSize: '25px',
                  WebkitTextStroke: '4.5px #0B0D18',
                  paintOrder: 'stroke fill',
                  textShadow: '2px 2.5px 0 #0B0D18',
                }}
              >
                -0
              </span>
            </div>
          </div>
        ))}
      </div>
    );
  },
);
