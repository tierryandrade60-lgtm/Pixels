import * as THREE from 'three';
import { CharacterAnimator } from './characterAnimator';
import {
  CHARACTER_PRESETS,
  CharacterAppearance,
  CharacterArchetype,
} from './characterConfig';
import {
  BASEPLATE_HALF_INNER,
  hasLineOfSight,
  resolveHorizontalObstaclePush,
} from './physics';
import { createR16Character, R16Rig } from './r16Character';
import { R16Ragdoll } from './ragdoll';
import { CombatTargetProbe } from './scarletWitchAbilities';

export type NpcCategory = 'bandit' | 'prisoner' | 'basic' | 'ai-hero';

export interface NpcHudSnapshot {
  id: string;
  name: string;
  category: NpcCategory;
  hp: number;
  maxHp: number;
  trailHp: number;
  visible: boolean;
  screenX: number;
  screenY: number;
  scale: number;
  isTargeted: boolean;
  /** Optional shield durability bar state shown on the right side of the character */
  shield?: {
    active: boolean;
    hp: number;
    maxHp: number;
    color: string;
    screenX: number;
    screenY: number;
  };
  damageNumber: {
    active: boolean;
    total: number;
    scale: number;
    opacity: number;
    offsetX: number;
    offsetY: number;
  };
}

export interface NpcEliminationEvent {
  id: string;
  coins: number;
  screenX: number;
  screenY: number;
}

interface BanditBullet {
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  damage: number;
  attackerId: string;
  targetType: 'player' | 'astral-body';
}

interface NpcActor {
  id: string;
  name: string;
  category: NpcCategory;
  archetype: CharacterArchetype;
  preset: CharacterAppearance;
  weaponKind: 'none' | 'pistol';
  coinReward: number;
  rig: R16Rig;
  animator: CharacterAnimator;
  ragdoll: R16Ragdoll;
  spawnPos: THREE.Vector3;
  zoneCenter: THREE.Vector3;
  zoneRadius: number;
  patrolTarget: THREE.Vector3;
  patrolPause: number;
  position: THREE.Vector3;
  verticalVelocity: number;
  facingYaw: number;
  hp: number;
  maxHp: number;
  trailHp: number;
  trailHoldTimer: number;
  ragdollTimer: number;
  hitFlashTimer: number;
  muzzleFlashTimer: number;
  respawnTimer: number;
  burningTimer: number;
  burnDps: number;
  burnTickAccum: number;
  burnSprite: THREE.Sprite;
  painRestricted: boolean;
  paralyzed: boolean;
  paralysisImmune: boolean;
  mindControlImmune: boolean;
  clonesRestricted: boolean;
  agathaDrainVictim: boolean;
  externalControl: boolean;
  externalHeadache: boolean;
  externalLimp: boolean;
  externalPitchX: number;
  headacheTimer: number;
  rewardClaimed: boolean;
  /** Strictly individual retaliation: only becomes active when THIS specific NPC is attacked */
  aggroTargetId: 'player' | null;
  strafeDir: number;
  strafeSwitchTimer: number;
  attackCooldown: number;
  attackPendingHit: boolean;
  attackHitDelay: number;
  pendingTargetType: 'player' | 'astral-body';
  attackDamage: number;
  punchNextHand: 'left' | 'right';
  moveSpeed: number;
  damageDisplay: {
    active: boolean;
    total: number;
    popTimer: number;
    idleTimer: number;
    offsetX: number;
    offsetY: number;
    driftDir: number;
  };
}

const DAMAGE_AGGREGATE_HOLD_SEC = 1.25;
const DAMAGE_FADE_DURATION_SEC = 0.42;
const TRAIL_DELAY_SEC = 0.45;
const ZONE_CHASE_LIMIT_M = 30.0;

/** Natural skin tone pool spanning dark, brown, and light variations */
const NATURAL_SKIN_TONES: ReadonlyArray<string> = [
  '#5A3522', // dark deep
  '#74462D', // dark warm
  '#9E6A47', // brown rich
  '#B8805B', // brown tan
  '#DDA883', // light medium
  '#F2C5A5', // light warm
];

function createBurnAuraTexture(): THREE.CanvasTexture {
  const size = 96;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const half = size * 0.5;
  const grad = ctx.createRadialGradient(half, half + 6, 3, half, half, half);
  grad.addColorStop(0.0, 'rgba(255, 240, 170, 0.92)');
  grad.addColorStop(0.45, 'rgba(255, 118, 18, 0.72)');
  grad.addColorStop(0.8, 'rgba(220, 38, 10, 0.25)');
  grad.addColorStop(1.0, 'rgba(120, 10, 0, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function dampAngle(
  current: number,
  target: number,
  lambda: number,
  dt: number,
): number {
  let diff = target - current;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return current + diff * (1 - Math.exp(-lambda * dt));
}

export class NpcCombatSystem {
  public readonly group = new THREE.Group();
  private readonly npcs: NpcActor[] = [];
  private readonly bullets: BanditBullet[] = [];
  private readonly burnTex: THREE.CanvasTexture;
  private readonly bulletGeo = new THREE.SphereGeometry(0.075, 8, 6);
  private readonly bulletMat = new THREE.MeshBasicMaterial({
    color: '#FFE066',
  });
  private selectedTargetId: string | null = null;
  private pendingEliminations: Array<{
    id: string;
    coins: number;
    worldPos: THREE.Vector3;
  }> = [];
  private animTime = 0;

  private readonly _proj = new THREE.Vector3();
  private readonly _fwd = new THREE.Vector3();
  private readonly _right = new THREE.Vector3();
  private readonly _toNpc = new THREE.Vector3();
  private readonly _hitDir = new THREE.Vector3();
  private readonly _muzzlePos = new THREE.Vector3();
  private readonly _bulletNext = new THREE.Vector3();

  private readonly idleMotion = {
    localForward: 0,
    localRight: 0,
    verticalVelocity: 0,
    grounded: true,
    justJumped: false,
    landImpactSpeed: 0,
  };

  private readonly walkMotion = {
    localForward: 0.72,
    localRight: 0,
    verticalVelocity: 0,
    grounded: true,
    justJumped: false,
    landImpactSpeed: 0,
  };

  constructor() {
    this.burnTex = createBurnAuraTexture();

    const banditCenter = new THREE.Vector3(-18, 0, -14);
    const prisonerCenter = new THREE.Vector3(18, 0, -14);
    const basicCenter = new THREE.Vector3(0, 0, 15);

    const pickSkin = (idx: number) =>
      NATURAL_SKIN_TONES[(idx + Math.floor(Math.random() * NATURAL_SKIN_TONES.length)) % NATURAL_SKIN_TONES.length];

    const spawns: Array<{
      id: string;
      name: string;
      category: 'bandit' | 'prisoner' | 'basic';
      preset: CharacterAppearance;
      weaponKind: 'none' | 'pistol';
      x: number;
      z: number;
      yaw: number;
      zoneCenter: THREE.Vector3;
      zoneRadius: number;
      maxHp: number;
      attackDamage: number;
      moveSpeed: number;
      coinReward: number;
    }> = [
      // Zone 1: Masked Pistol Bandits (Northwest Courtyard) - 4 Bandits, pistols only
      {
        id: 'bandit-1',
        name: 'Bandit',
        category: 'bandit',
        preset: { ...CHARACTER_PRESETS.banditDark, skin: NATURAL_SKIN_TONES[0] },
        weaponKind: 'pistol',
        x: -20.8,
        z: -11.2,
        yaw: -0.45,
        zoneCenter: banditCenter,
        zoneRadius: 10.5,
        maxHp: 170,
        attackDamage: 12,
        moveSpeed: 4.1,
        coinReward: 34,
      },
      {
        id: 'bandit-2',
        name: 'Bandit',
        category: 'bandit',
        preset: { ...CHARACTER_PRESETS.banditDark, skin: NATURAL_SKIN_TONES[4] },
        weaponKind: 'pistol',
        x: -14.8,
        z: -16.8,
        yaw: 0.3,
        zoneCenter: banditCenter,
        zoneRadius: 10.5,
        maxHp: 170,
        attackDamage: 12,
        moveSpeed: 4.1,
        coinReward: 34,
      },
      {
        id: 'bandit-3',
        name: 'Bandit',
        category: 'bandit',
        preset: { ...CHARACTER_PRESETS.banditCrimson, skin: NATURAL_SKIN_TONES[2] },
        weaponKind: 'pistol',
        x: -21.5,
        z: -17.6,
        yaw: -0.8,
        zoneCenter: banditCenter,
        zoneRadius: 10.5,
        maxHp: 185,
        attackDamage: 14,
        moveSpeed: 3.95,
        coinReward: 38,
      },
      {
        id: 'bandit-4',
        name: 'Bandit',
        category: 'bandit',
        preset: { ...CHARACTER_PRESETS.banditCrimson, skin: pickSkin(5) },
        weaponKind: 'pistol',
        x: -14.4,
        z: -10.8,
        yaw: 0.55,
        zoneCenter: banditCenter,
        zoneRadius: 10.5,
        maxHp: 185,
        attackDamage: 14,
        moveSpeed: 3.95,
        coinReward: 38,
      },

      // Zone 2: Orange-Uniform Prisoners (Northeast Yard) - 4 Prisoners, close punches only, no levels
      {
        id: 'prisoner-1',
        name: 'Prisoner',
        category: 'prisoner',
        preset: { ...CHARACTER_PRESETS.prisonerOrange, skin: NATURAL_SKIN_TONES[1] },
        weaponKind: 'none',
        x: 15.2,
        z: -11.4,
        yaw: 0.45,
        zoneCenter: prisonerCenter,
        zoneRadius: 10.5,
        maxHp: 155,
        attackDamage: 11,
        moveSpeed: 4.25,
        coinReward: 30,
      },
      {
        id: 'prisoner-2',
        name: 'Prisoner',
        category: 'prisoner',
        preset: { ...CHARACTER_PRESETS.prisonerOrange, skin: NATURAL_SKIN_TONES[3] },
        weaponKind: 'none',
        x: 20.8,
        z: -16.6,
        yaw: -0.35,
        zoneCenter: prisonerCenter,
        zoneRadius: 10.5,
        maxHp: 155,
        attackDamage: 11,
        moveSpeed: 4.25,
        coinReward: 30,
      },
      {
        id: 'prisoner-3',
        name: 'Prisoner',
        category: 'prisoner',
        preset: { ...CHARACTER_PRESETS.prisonerOrange, skin: NATURAL_SKIN_TONES[5] },
        weaponKind: 'none',
        x: 14.6,
        z: -17.4,
        yaw: 0.75,
        zoneCenter: prisonerCenter,
        zoneRadius: 10.5,
        maxHp: 155,
        attackDamage: 11,
        moveSpeed: 4.25,
        coinReward: 30,
      },
      {
        id: 'prisoner-4',
        name: 'Prisoner',
        category: 'prisoner',
        preset: { ...CHARACTER_PRESETS.prisonerOrange, skin: pickSkin(0) },
        weaponKind: 'none',
        x: 21.4,
        z: -11.0,
        yaw: -0.5,
        zoneCenter: prisonerCenter,
        zoneRadius: 10.5,
        maxHp: 155,
        attackDamage: 11,
        moveSpeed: 4.25,
        coinReward: 30,
      },

      // Zone 3: Basic NPC Zone (South Plaza) - 2 peaceful civilians
      {
        id: 'basic-1',
        name: 'Civilian',
        category: 'basic',
        preset: CHARACTER_PRESETS.basicCivilianA,
        weaponKind: 'none',
        x: -3.2,
        z: 15.0,
        yaw: 0.25,
        zoneCenter: basicCenter,
        zoneRadius: 6.0,
        maxHp: 120,
        attackDamage: 0,
        moveSpeed: 0,
        coinReward: 10,
      },
      {
        id: 'basic-2',
        name: 'Citizen',
        category: 'basic',
        preset: CHARACTER_PRESETS.basicCivilianB,
        weaponKind: 'none',
        x: 3.2,
        z: 15.0,
        yaw: -0.25,
        zoneCenter: basicCenter,
        zoneRadius: 6.0,
        maxHp: 120,
        attackDamage: 0,
        moveSpeed: 0,
        coinReward: 10,
      },
    ];

    for (const sp of spawns) {
      const rig = createR16Character(sp.preset);
      rig.root.position.set(sp.x, 0, sp.z);
      rig.root.rotation.y = sp.yaw;
      rig.setNpcWeapon(sp.weaponKind);
      this.group.add(rig.root);

      const burnMat = new THREE.SpriteMaterial({
        map: this.burnTex,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        opacity: 0,
      });
      const burnSprite = new THREE.Sprite(burnMat);
      burnSprite.visible = false;
      burnSprite.scale.set(1.05, 1.35, 1);
      this.group.add(burnSprite);

      const archetype = sp.preset.archetype ?? 'standard';
      const animator = new CharacterAnimator(rig, archetype);
      const ragdoll = new R16Ragdoll(rig);

      const patrolTarget = new THREE.Vector3(sp.x, 0, sp.z);
      this.npcs.push({
        id: sp.id,
        name: sp.name,
        category: sp.category,
        archetype,
        preset: sp.preset,
        weaponKind: sp.weaponKind,
        coinReward: sp.coinReward,
        rig,
        animator,
        ragdoll,
        spawnPos: new THREE.Vector3(sp.x, 0, sp.z),
        zoneCenter: sp.zoneCenter.clone(),
        zoneRadius: sp.zoneRadius,
        patrolTarget,
        patrolPause: 0.6 + Math.random() * 1.4,
        position: new THREE.Vector3(sp.x, 0, sp.z),
        verticalVelocity: 0,
        facingYaw: sp.yaw,
        hp: sp.maxHp,
        maxHp: sp.maxHp,
        trailHp: sp.maxHp,
        trailHoldTimer: 0,
        ragdollTimer: 0,
        hitFlashTimer: 0,
        muzzleFlashTimer: 0,
        respawnTimer: 0,
        burningTimer: 0,
        burnDps: 2,
        burnTickAccum: 0,
        burnSprite,
        painRestricted: false,
        paralyzed: false,
        paralysisImmune: false,
        mindControlImmune: false,
        clonesRestricted: false,
        agathaDrainVictim: false,
        externalControl: false,
        externalHeadache: false,
        externalLimp: false,
        externalPitchX: 0,
        headacheTimer: 0,
        rewardClaimed: false,
        aggroTargetId: null,
        strafeDir: Math.random() > 0.5 ? 1 : -1,
        strafeSwitchTimer: 1.4 + Math.random() * 1.5,
        attackCooldown: 0.35 + Math.random() * 0.4,
        attackPendingHit: false,
        attackHitDelay: 0,
        pendingTargetType: 'player',
        attackDamage: sp.attackDamage,
        punchNextHand: Math.random() > 0.5 ? 'right' : 'left',
        moveSpeed: sp.moveSpeed,
        damageDisplay: {
          active: false,
          total: 0,
          popTimer: 0,
          idleTimer: 0,
          offsetX: 0,
          offsetY: 0,
          driftDir: 1,
        },
      });
    }
  }

  private pickPatrolTarget(npc: NpcActor): void {
    const angle = Math.random() * Math.PI * 2;
    const rad = Math.sqrt(Math.random()) * Math.max(2.0, npc.zoneRadius - 2.0);
    npc.patrolTarget.set(
      npc.zoneCenter.x + Math.cos(angle) * rad,
      0,
      npc.zoneCenter.z + Math.sin(angle) * rad,
    );
    npc.patrolPause = 1.0 + Math.random() * 2.0;
  }

  public getTargetProbes(): CombatTargetProbe[] {
    const probes: CombatTargetProbe[] = [];
    for (const npc of this.npcs) {
      if (npc.hp <= 0) continue;
      probes.push({
        id: npc.id,
        position: npc.position,
        radius: 0.45,
        height: 1.85,
      });
    }
    return probes;
  }

  public getSelectedTargetId(): string | null {
    if (!this.selectedTargetId) return null;
    const npc = this.npcs.find((n) => n.id === this.selectedTargetId);
    if (!npc || npc.hp <= 0) return null;
    return npc.id;
  }

  public findClosestTargetId(
    fromPos: THREE.Vector3,
    maxDistance: number,
  ): string | null {
    let bestId: string | null = null;
    let bestDist = maxDistance;
    for (const npc of this.npcs) {
      if (npc.hp <= 0) continue;
      const d = npc.position.distanceTo(fromPos);
      if (d <= bestDist) {
        bestDist = d;
        bestId = npc.id;
      }
    }
    return bestId;
  }

  public isTargetAlive(targetId: string): boolean {
    const npc = this.npcs.find((n) => n.id === targetId);
    return Boolean(npc && npc.hp > 0);
  }

  public getTargetTorsoPosition(targetId: string, out: THREE.Vector3): boolean {
    const npc = this.npcs.find((n) => n.id === targetId);
    if (!npc || npc.hp <= 0) return false;
    out.set(npc.position.x, npc.position.y + 1.05, npc.position.z);
    return true;
  }

  public getTargetHeadPosition(targetId: string, out: THREE.Vector3): boolean {
    const npc = this.npcs.find((n) => n.id === targetId);
    if (!npc || npc.hp <= 0) return false;
    out.set(
      npc.position.x,
      npc.position.y + (npc.ragdoll.active ? 0.52 : 1.56),
      npc.position.z,
    );
    return true;
  }

  public getNpcSwordEmbedPose(
    targetId: string,
    outPos: THREE.Vector3,
  ): { alive: boolean; facingYaw: number } {
    const npc = this.npcs.find((n) => n.id === targetId);
    if (!npc || npc.hp <= 0) return { alive: false, facingYaw: 0 };
    outPos.set(
      npc.position.x,
      npc.position.y + (npc.ragdoll.active ? 0.35 : 1.05),
      npc.position.z,
    );
    return { alive: true, facingYaw: npc.facingYaw };
  }

  public getSelectedTargetAimPoint(out: THREE.Vector3): boolean {
    if (!this.selectedTargetId) return false;
    const npc = this.npcs.find((n) => n.id === this.selectedTargetId);
    if (!npc || npc.hp <= 0) return false;
    out.set(npc.position.x, npc.position.y + 1.05, npc.position.z);
    return true;
  }

  public isPositionBlockedByNpc(pos: THREE.Vector3, radius = 0.65): boolean {
    for (const npc of this.npcs) {
      if (npc.hp <= 0) continue;
      const dx = pos.x - npc.position.x;
      const dz = pos.z - npc.position.z;
      if (dx * dx + dz * dz < radius * radius) {
        return true;
      }
    }
    return false;
  }

  public setPainRestricted(targetId: string, restricted: boolean): void {
    const npc = this.npcs.find((n) => n.id === targetId);
    if (!npc) return;
    npc.painRestricted = restricted;
    if (restricted) {
      npc.attackPendingHit = false;
    }
  }

  public setParalyzed(targetId: string, active: boolean): void {
    const npc = this.npcs.find((n) => n.id === targetId);
    if (!npc) return;
    npc.paralyzed = active;
    if (active) {
      npc.attackPendingHit = false;
    }
  }

  public setMindControlParalysis(targetId: string, active: boolean): void {
    const npc = this.npcs.find((n) => n.id === targetId);
    if (!npc) return;
    npc.paralyzed = active;
    npc.paralysisImmune = active;
    npc.rig.setWhiteOutline(active);
    if (active) {
      npc.attackPendingHit = false;
    }
  }

  public setMindControlImmune(targetId: string, active: boolean): void {
    const npc = this.npcs.find((n) => n.id === targetId);
    if (!npc) return;
    npc.mindControlImmune = active;
  }

  public setClonesRestricted(targetId: string, active: boolean): void {
    const npc = this.npcs.find((n) => n.id === targetId);
    if (!npc) return;
    npc.clonesRestricted = active;
    if (active) {
      npc.attackPendingHit = false;
    }
  }

  public setAgathaDrainVictim(
    targetId: string,
    active: boolean,
    facePos?: THREE.Vector3,
  ): void {
    const npc = this.npcs.find((n) => n.id === targetId);
    if (!npc) return;
    npc.agathaDrainVictim = active;
    if (active) {
      npc.attackPendingHit = false;
      if (facePos) {
        const dx = facePos.x - npc.position.x;
        const dz = facePos.z - npc.position.z;
        if (dx * dx + dz * dz > 1e-4) {
          npc.facingYaw = Math.atan2(-dx, -dz);
        }
      }
    }
    npc.animator.setAgathaDrainVictim(active);
  }

  public getTargetAppearance(targetId: string): CharacterAppearance | null {
    const npc = this.npcs.find((n) => n.id === targetId);
    if (!npc) return null;
    return { ...npc.preset };
  }

  public setExternalControl(targetId: string, active: boolean): void {
    const npc = this.npcs.find((n) => n.id === targetId);
    if (!npc) return;
    npc.externalControl = active;
    if (active) {
      npc.attackPendingHit = false;
      npc.verticalVelocity = 0;
    } else {
      npc.externalHeadache = false;
      npc.externalLimp = false;
      npc.externalPitchX = 0;
      npc.animator.setAstralLimp(false);
      npc.rig.root.rotation.x = 0;
      npc.position.y = Math.max(0, npc.position.y);
      npc.verticalVelocity = 0;
    }
  }

  public setExternalPose(
    targetId: string,
    pos: THREE.Vector3,
    facingYaw?: number,
    options?: { headache?: boolean; limp?: boolean; pitchX?: number },
  ): void {
    const npc = this.npcs.find((n) => n.id === targetId);
    if (!npc || npc.hp <= 0) return;
    const maxBound = BASEPLATE_HALF_INNER - 0.85;
    npc.position.set(
      THREE.MathUtils.clamp(pos.x, -maxBound, maxBound),
      Math.max(0, pos.y),
      THREE.MathUtils.clamp(pos.z, -maxBound, maxBound),
    );
    if (facingYaw !== undefined) {
      npc.facingYaw = facingYaw;
    }
    if (options?.headache !== undefined) {
      npc.externalHeadache = options.headache;
    }
    if (options?.limp !== undefined) {
      npc.externalLimp = options.limp;
      npc.animator.setAstralLimp(options.limp);
    }
    if (options?.pitchX !== undefined) {
      npc.externalPitchX = options.pitchX;
    }
  }

  public clearAllCrowdControl(): void {
    for (const npc of this.npcs) {
      npc.painRestricted = false;
      npc.paralyzed = false;
      npc.paralysisImmune = false;
      npc.mindControlImmune = false;
      npc.clonesRestricted = false;
      npc.agathaDrainVictim = false;
      npc.rig.setWhiteOutline(false);
      npc.externalControl = false;
      npc.externalHeadache = false;
      npc.externalLimp = false;
      npc.externalPitchX = 0;
      npc.animator.setAstralLimp(false);
      npc.animator.setAgathaDrainVictim(false);
      npc.rig.root.rotation.x = 0;
      npc.verticalVelocity = 0;
      npc.position.y = 0;
    }
  }

  public applyHeadache(targetId: string, durationSec: number): void {
    const npc = this.npcs.find((n) => n.id === targetId);
    if (!npc || npc.hp <= 0) return;
    npc.headacheTimer = Math.max(npc.headacheTimer, durationSec);
    npc.attackPendingHit = false;
  }

  public applyGlobalDamage(amount: number): number {
    let hitCount = 0;
    const dir = this._fwd.set(0, 0, -1);
    for (const npc of this.npcs) {
      if (npc.hp <= 0) continue;
      if (this.applyDamage(npc.id, amount, dir, 0)) {
        hitCount++;
      }
    }
    return hitCount;
  }

  public applyBurn(targetId: string, durationSec: number, dps = 2): void {
    const npc = this.npcs.find((n) => n.id === targetId);
    if (!npc || npc.hp <= 0 || npc.mindControlImmune) return;
    const wasBurning = npc.burningTimer > 0;
    npc.burningTimer = Math.max(npc.burningTimer, durationSec);
    npc.burnDps = dps;
    if (!wasBurning) {
      npc.burnTickAccum = 0;
    }
  }

  public triggerTargetRagdoll(
    targetId: string,
    ragdollDurationSec: number,
    knockbackImpulse?: THREE.Vector3,
  ): void {
    const npc = this.npcs.find((n) => n.id === targetId);
    if (
      !npc ||
      (npc.paralysisImmune && npc.hp > 0) ||
      (npc.mindControlImmune && npc.hp > 0)
    ) {
      return;
    }
    npc.attackPendingHit = false;
    npc.ragdollTimer = Math.max(npc.ragdollTimer, ragdollDurationSec);
    if (!npc.ragdoll.active) {
      npc.ragdoll.trigger(
        npc.position,
        new THREE.Vector3(),
        npc.facingYaw,
        knockbackImpulse,
      );
    }
  }

  public applyDamage(
    targetId: string,
    amount: number,
    hitDir: THREE.Vector3,
    ragdollDurationSec = 0,
    knockbackImpulse?: THREE.Vector3,
    options?: { bypassMindControlImmunity?: boolean; noAggro?: boolean },
  ): boolean {
    const npc = this.npcs.find((n) => n.id === targetId);
    if (!npc || npc.hp <= 0 || amount <= 0) return false;
    if (npc.mindControlImmune && !options?.bypassMindControlImmunity) {
      return false;
    }

    npc.hp = Math.max(0, npc.hp - amount);
    npc.trailHoldTimer = TRAIL_DELAY_SEC;
    npc.hitFlashTimer = 0.14;

    // Strictly Individual Aggression: ONLY the specific attacked Bandit/Prisoner retaliates
    if (!options?.noAggro && npc.category !== 'basic') {
      npc.aggroTargetId = 'player';
    }

    const dd = npc.damageDisplay;
    if (!dd.active) {
      const side = Math.random() > 0.5 ? 1 : -1;
      dd.active = true;
      dd.total = amount;
      dd.driftDir = side;
      dd.offsetX = side * (62 + Math.random() * 10);
      dd.offsetY = -4 - Math.random() * 8;
    } else {
      dd.total += amount;
    }
    dd.popTimer = 0.22;
    dd.idleTimer = 0;

    const immuneToCc = (npc.paralysisImmune || npc.mindControlImmune) && npc.hp > 0;
    if (!immuneToCc) {
      if (ragdollDurationSec > 0) {
        npc.attackPendingHit = false;
        npc.ragdollTimer = Math.max(npc.ragdollTimer, ragdollDurationSec);
        if (!npc.ragdoll.active) {
          npc.ragdoll.trigger(
            npc.position,
            new THREE.Vector3(),
            npc.facingYaw,
            knockbackImpulse,
          );
        }
      } else if (!npc.ragdoll.active) {
        const sinY = Math.sin(npc.facingYaw);
        const cosY = Math.cos(npc.facingYaw);
        this._fwd.set(-sinY, 0, -cosY);
        this._right.set(cosY, 0, -sinY);
        const fwdImp = hitDir.dot(this._fwd);
        const rightImp = hitDir.dot(this._right);
        npc.animator.triggerHitReaction(fwdImp, rightImp);
      }
    }

    if (npc.hp <= 0) {
      npc.burningTimer = 0;
      npc.painRestricted = false;
      npc.paralyzed = false;
      npc.paralysisImmune = false;
      npc.mindControlImmune = false;
      npc.clonesRestricted = false;
      npc.agathaDrainVictim = false;
      npc.rig.setWhiteOutline(false);
      npc.externalControl = false;
      npc.externalHeadache = false;
      npc.externalLimp = false;
      npc.externalPitchX = 0;
      npc.rig.root.rotation.x = 0;
      npc.verticalVelocity = 0;
      npc.position.y = 0;
      npc.headacheTimer = 0;
      npc.attackPendingHit = false;
      npc.aggroTargetId = null;
      npc.animator.setNpcPistolAim(false);
      npc.animator.setHeadache(false);
      npc.animator.setAstralLimp(false);
      npc.animator.setAgathaDrainVictim(false);
      npc.respawnTimer = 3.2;
      if (!npc.rewardClaimed) {
        npc.rewardClaimed = true;
        this.pendingEliminations.push({
          id: npc.id,
          coins: npc.coinReward,
          worldPos: new THREE.Vector3(npc.position.x, npc.position.y + 1.05, npc.position.z),
        });
      }
      if (!npc.ragdoll.active) {
        npc.ragdollTimer = 3.2;
        npc.ragdoll.trigger(
          npc.position,
          new THREE.Vector3(),
          npc.facingYaw,
          hitDir.clone().multiplyScalar(2.0),
        );
      }
    }

    return true;
  }

  public applyAreaImplosion(
    center: THREE.Vector3,
    radius: number,
    damage: number,
    ragdollDurationSec: number,
  ): number {
    let hitCount = 0;
    const hitSet = new Set<string>();

    for (const npc of this.npcs) {
      if (npc.hp <= 0 || hitSet.has(npc.id)) continue;
      const dx = npc.position.x - center.x;
      const dy = npc.position.y + 0.9 - center.y;
      const dz = npc.position.z - center.z;
      const dist3d = Math.hypot(dx, dy, dz);
      if (dist3d <= radius) {
        hitSet.add(npc.id);
        const pull = new THREE.Vector3(-dx, 0, -dz);
        const horizDist = Math.hypot(dx, dz);
        if (horizDist > 0.05) {
          const pullStrength = THREE.MathUtils.clamp(horizDist * 0.72, 1.4, 3.6);
          pull.normalize().multiplyScalar(pullStrength);
        } else {
          pull.set(0, 0, 0);
        }
        pull.y = 0.28;

        const dir = new THREE.Vector3(dx, 0, dz);
        if (dir.lengthSq() > 0.001) dir.normalize();

        if (this.applyDamage(npc.id, damage, dir, ragdollDurationSec, pull)) {
          hitCount++;
        }
      }
    }
    return hitCount;
  }

  public applyAreaFireExplosion(
    center: THREE.Vector3,
    radius: number,
    damage: number,
    ragdollDurationSec: number,
    knockbackStrength: number,
    burnDurationSec = 0,
    burnDps = 2,
    excludeId?: string,
  ): number {
    let hitCount = 0;
    const hitSet = new Set<string>();

    for (const npc of this.npcs) {
      if (npc.hp <= 0 || npc.id === excludeId || hitSet.has(npc.id)) continue;
      const dx = npc.position.x - center.x;
      const dz = npc.position.z - center.z;
      const distHz = Math.hypot(dx, dz);
      if (distHz <= radius) {
        hitSet.add(npc.id);
        const outDir = new THREE.Vector3(dx, 0, dz);
        if (outDir.lengthSq() < 0.001) {
          outDir.set(Math.sin(npc.facingYaw), 0, Math.cos(npc.facingYaw));
        } else {
          outDir.normalize();
        }
        const knockback = outDir.clone().multiplyScalar(knockbackStrength);
        knockback.y = 0.42;

        if (this.applyDamage(npc.id, damage, outDir, ragdollDurationSec, knockback)) {
          hitCount++;
          if (burnDurationSec > 0 && npc.hp > 0) {
            this.applyBurn(npc.id, burnDurationSec, burnDps);
          }
        }
      }
    }
    return hitCount;
  }

  private fireBanditPistol(
    npc: NpcActor,
    targetPos: THREE.Vector3,
    targetType: 'player' | 'astral-body',
  ): void {
    const gotMuzzle = npc.rig.getNpcMuzzleWorldPos(this._muzzlePos);
    if (!gotMuzzle) {
      const sinY = Math.sin(npc.facingYaw);
      const cosY = Math.cos(npc.facingYaw);
      this._muzzlePos.set(
        npc.position.x - sinY * 0.55 + cosY * 0.28,
        npc.position.y + 1.32,
        npc.position.z - cosY * 0.55 - sinY * 0.28,
      );
    }

    const aimY = targetPos.y + 1.08;
    const dir = new THREE.Vector3(
      targetPos.x - this._muzzlePos.x,
      aimY - this._muzzlePos.y,
      targetPos.z - this._muzzlePos.z,
    );
    if (dir.lengthSq() < 1e-4) {
      dir.set(-Math.sin(npc.facingYaw), 0, -Math.cos(npc.facingYaw));
    } else {
      dir.normalize();
    }

    const mesh = new THREE.Mesh(this.bulletGeo, this.bulletMat);
    mesh.position.copy(this._muzzlePos);
    mesh.scale.set(0.75, 0.75, 2.6);
    mesh.lookAt(
      this._muzzlePos.x + dir.x,
      this._muzzlePos.y + dir.y,
      this._muzzlePos.z + dir.z,
    );
    this.group.add(mesh);

    this.bullets.push({
      mesh,
      pos: this._muzzlePos.clone(),
      vel: dir.multiplyScalar(34.0),
      life: 1.0,
      damage: npc.attackDamage,
      attackerId: npc.id,
      targetType,
    });
  }

  public update(
    dt: number,
    camera: THREE.PerspectiveCamera,
    playerPos: THREE.Vector3,
    reticleNdcX: number,
    reticleNdcY: number,
    viewportWidth: number,
    viewportHeight: number,
    onBurnTick?: () => void,
    onEliminated?: (events: NpcEliminationEvent[]) => void,
    playerTargetable = true,
    onPlayerHit?: (
      damage: number,
      kind: 'pistol' | 'punch',
      hitDir: THREE.Vector3,
      attackerId: string,
    ) => void,
    astralBodyPos: THREE.Vector3 | null = null,
    onAstralBodyHit?: (damage: number, attackerId: string) => void,
    onPistolShot?: (origin: THREE.Vector3) => void,
  ): NpcHudSnapshot[] {
    const safeDt = Math.min(dt, 0.05);
    this.animTime += safeDt;
    const maxBound = BASEPLATE_HALF_INNER - 0.85;

    // Resolve active player target (physical astral body decoy OR live player)
    const activeTargetPos = astralBodyPos ?? playerPos;
    const activeTargetType: 'player' | 'astral-body' = astralBodyPos
      ? 'astral-body'
      : 'player';
    const hasValidTarget = Boolean(astralBodyPos || playerTargetable);

    for (const npc of this.npcs) {
      // 1. Burning DoT ticks + visual aura
      if (npc.hp > 0 && npc.burningTimer > 0) {
        npc.burningTimer = Math.max(0, npc.burningTimer - safeDt);
        npc.burnTickAccum += safeDt;
        if (npc.burnTickAccum >= 1.0) {
          npc.burnTickAccum -= 1.0;
          const dir = this._fwd.set(0, 0, -1);
          if (
            this.applyDamage(npc.id, npc.burnDps, dir, 0, undefined, {
              noAggro: true,
            })
          ) {
            onBurnTick?.();
          }
        }
      }

      if (npc.hp > 0 && npc.burningTimer > 0) {
        npc.burnSprite.visible = true;
        const flicker = 0.88 + Math.sin(this.animTime * 16 + npc.spawnPos.x) * 0.14;
        npc.burnSprite.position.set(
          npc.position.x,
          npc.position.y + (npc.ragdoll.active ? 0.35 : 0.95),
          npc.position.z,
        );
        npc.burnSprite.scale.set(1.05 * flicker, 1.38 * flicker, 1);
        (npc.burnSprite.material as THREE.SpriteMaterial).opacity =
          Math.min(1, npc.burningTimer * 1.4) * 0.72;
      } else {
        npc.burnSprite.visible = false;
      }

      if (npc.hitFlashTimer > 0) {
        npc.hitFlashTimer = Math.max(0, npc.hitFlashTimer - safeDt);
        npc.rig.setHitFlash(npc.hitFlashTimer / 0.14);
      } else {
        npc.rig.setHitFlash(0);
      }

      if (npc.muzzleFlashTimer > 0) {
        npc.muzzleFlashTimer = Math.max(0, npc.muzzleFlashTimer - safeDt);
        npc.rig.setNpcMuzzleFlash(npc.muzzleFlashTimer / 0.08);
      } else {
        npc.rig.setNpcMuzzleFlash(0);
      }

      if (npc.trailHoldTimer > 0) {
        npc.trailHoldTimer = Math.max(0, npc.trailHoldTimer - safeDt);
      } else if (npc.trailHp > npc.hp) {
        npc.trailHp = Math.max(npc.hp, npc.trailHp - 72 * safeDt);
      } else {
        npc.trailHp = npc.hp;
      }

      if (npc.hp <= 0) {
        npc.respawnTimer -= safeDt;
        if (npc.ragdoll.active) {
          const pelvisPos = npc.ragdoll.update(safeDt);
          npc.position.set(pelvisPos.x, 0, pelvisPos.z);
        }
        if (npc.respawnTimer <= 0) {
          npc.ragdoll.reset();
          npc.position.copy(npc.spawnPos);
          npc.patrolTarget.copy(npc.spawnPos);
          npc.rig.root.position.copy(npc.spawnPos);
          npc.rig.root.rotation.set(0, npc.facingYaw, 0);

          npc.hp = npc.maxHp;
          npc.trailHp = npc.maxHp;
          npc.ragdollTimer = 0;
          npc.burningTimer = 0;
          npc.burnTickAccum = 0;
          npc.painRestricted = false;
          npc.paralyzed = false;
          npc.paralysisImmune = false;
          npc.mindControlImmune = false;
          npc.clonesRestricted = false;
          npc.agathaDrainVictim = false;
          npc.rig.setWhiteOutline(false);
          npc.externalControl = false;
          npc.externalHeadache = false;
          npc.externalLimp = false;
          npc.externalPitchX = 0;
          npc.verticalVelocity = 0;
          npc.headacheTimer = 0;
          npc.rewardClaimed = false;
          npc.aggroTargetId = null;
          npc.attackCooldown = 0.5;
          npc.attackPendingHit = false;
          npc.animator = new CharacterAnimator(npc.rig, npc.archetype);
        }
      } else if (npc.ragdoll.active) {
        npc.animator.setNpcPistolAim(false);
        const pelvisPos = npc.ragdoll.update(safeDt);
        npc.position.set(pelvisPos.x, 0, pelvisPos.z);
        npc.verticalVelocity = 0;
        npc.ragdollTimer -= safeDt;
        if (npc.ragdollTimer <= 0) {
          npc.ragdollTimer = 0;
          npc.ragdoll.reset();
          npc.rig.root.position.copy(npc.position);
          npc.rig.root.rotation.set(0, npc.facingYaw, 0);
          npc.animator = new CharacterAnimator(npc.rig, npc.archetype);
        }
      } else {
        // Gravity pull for NPCs released from aerial abilities
        if (!npc.externalControl && npc.position.y > 0) {
          npc.verticalVelocity -= 24 * safeDt;
          npc.position.y += npc.verticalVelocity * safeDt;
          if (npc.position.y <= 0) {
            npc.position.y = 0;
            npc.verticalVelocity = 0;
          }
        }
        if (npc.paralyzed && !npc.externalControl) {
          npc.attackPendingHit = false;
          npc.animator.setNpcPistolAim(false);
          npc.rig.root.position.copy(npc.position);
          npc.rig.root.rotation.y = npc.facingYaw;
        } else {
          if (npc.headacheTimer > 0) {
            npc.headacheTimer = Math.max(0, npc.headacheTimer - safeDt);
          }
          if (npc.attackCooldown > 0) {
            npc.attackCooldown = Math.max(0, npc.attackCooldown - safeDt);
          }
          npc.strafeSwitchTimer -= safeDt;
          if (npc.strafeSwitchTimer <= 0) {
            npc.strafeDir = -npc.strafeDir;
            npc.strafeSwitchTimer = 1.6 + Math.random() * 1.4;
          }

          const headacheActive = npc.headacheTimer > 0 || npc.externalHeadache;
          npc.animator.setHeadache(headacheActive);
          npc.animator.setAstralLimp(npc.externalLimp);
          npc.animator.setAgathaDrainVictim(npc.agathaDrainVictim);
          const restricted =
            npc.painRestricted ||
            npc.paralyzed ||
            npc.externalControl ||
            headacheActive ||
            npc.externalLimp ||
            npc.agathaDrainVictim;

          let moving = false;
          let aimPistol = false;

          if (!restricted) {
            if (npc.category === 'basic') {
              moving = false;
            } else {
              const clonesSlowScale = npc.clonesRestricted ? 0.32 : 1;
              const dxTarget = activeTargetPos.x - npc.position.x;
              const dzTarget = activeTargetPos.z - npc.position.z;
              const distTarget = Math.hypot(dxTarget, dzTarget);
              const distTargetToZone = Math.hypot(
                activeTargetPos.x - npc.zoneCenter.x,
                activeTargetPos.z - npc.zoneCenter.z,
              );

              // Individual Aggression validation: clear if target invalid or escaped far beyond leash
              if (!hasValidTarget || distTargetToZone > ZONE_CHASE_LIMIT_M) {
                npc.aggroTargetId = null;
              }

              if (npc.aggroTargetId === 'player' && hasValidTarget) {
                const targetYaw = Math.atan2(-dxTarget, -dzTarget);
                npc.facingYaw = dampAngle(npc.facingYaw, targetYaw, 11, safeDt);

                if (npc.category === 'bandit') {
                  // Masked Pistol Bandit AI: maintain engagement distance, check pillar LOS, aim & fire
                  const losClear = hasLineOfSight(
                    npc.position.x,
                    npc.position.y + 1.35,
                    npc.position.z,
                    activeTargetPos.x,
                    activeTargetPos.y + 1.05,
                    activeTargetPos.z,
                  );
                  const idealMin = 6.2;
                  const idealMax = 14.5;

                  if (!losClear || distTarget > idealMax) {
                    const moveX =
                      distTarget > 0.01 ? dxTarget / distTarget : 0;
                    const moveZ =
                      distTarget > 0.01 ? dzTarget / distTarget : -1;
                    // If LOS is blocked by a pillar, mix in lateral strafe to walk around cover
                    const strafeWeight = losClear ? 0.15 : 0.78 * npc.strafeDir;
                    const dirX = moveX + -moveZ * strafeWeight;
                    const dirZ = moveZ + moveX * strafeWeight;
                    const dLen = Math.hypot(dirX, dirZ) || 1;
                    const step = npc.moveSpeed * clonesSlowScale * safeDt;
                    npc.position.x = THREE.MathUtils.clamp(
                      npc.position.x + (dirX / dLen) * step,
                      -maxBound,
                      maxBound,
                    );
                    npc.position.z = THREE.MathUtils.clamp(
                      npc.position.z + (dirZ / dLen) * step,
                      -maxBound,
                      maxBound,
                    );
                    resolveHorizontalObstaclePush(npc.position, 0.44);
                    moving = true;
                  } else if (distTarget < idealMin) {
                    // Light backpedal/strafe to keep pistol distance
                    const moveX = distTarget > 0.01 ? dxTarget / distTarget : 0;
                    const moveZ = distTarget > 0.01 ? dzTarget / distTarget : -1;
                    const step = npc.moveSpeed * 0.72 * clonesSlowScale * safeDt;
                    npc.position.x = THREE.MathUtils.clamp(
                      npc.position.x + (-moveX * 0.7 + -moveZ * 0.55 * npc.strafeDir) * step,
                      -maxBound,
                      maxBound,
                    );
                    npc.position.z = THREE.MathUtils.clamp(
                      npc.position.z + (-moveZ * 0.7 + moveX * 0.55 * npc.strafeDir) * step,
                      -maxBound,
                      maxBound,
                    );
                    resolveHorizontalObstaclePush(npc.position, 0.44);
                    moving = true;
                  }

                  aimPistol = true;
                  if (
                    losClear &&
                    distTarget <= 17.5 &&
                    !npc.clonesRestricted &&
                    npc.attackCooldown <= 0
                  ) {
                    npc.animator.triggerCast('npc-pistol-shoot', 0.28);
                    npc.muzzleFlashTimer = 0.08;
                    npc.attackCooldown = 1.28 + Math.random() * 0.25;
                    this.fireBanditPistol(npc, activeTargetPos, activeTargetType);
                    onPistolShot?.(npc.position);
                  }
                } else {
                  // Prisoner AI: close-range punches only
                  const attackRange = 1.55;
                  const strikeReach = 2.15;

                  if (npc.clonesRestricted) {
                    npc.attackPendingHit = false;
                  } else if (npc.attackPendingHit) {
                    npc.attackHitDelay -= safeDt;
                    if (npc.attackHitDelay <= 0) {
                      npc.attackPendingHit = false;
                      if (
                        distTarget <= strikeReach &&
                        Math.abs(activeTargetPos.y - npc.position.y) <= 2.1
                      ) {
                        this._hitDir.set(dxTarget, 0, dzTarget);
                        if (this._hitDir.lengthSq() > 1e-4) this._hitDir.normalize();
                        else this._hitDir.set(0, 0, -1);

                        if (npc.pendingTargetType === 'astral-body' && astralBodyPos) {
                          onAstralBodyHit?.(npc.attackDamage, npc.id);
                        } else {
                          onPlayerHit?.(npc.attackDamage, 'punch', this._hitDir, npc.id);
                        }
                      }
                    }
                  }

                  if (distTarget > attackRange) {
                    const stepDist = Math.min(
                      npc.moveSpeed * clonesSlowScale * safeDt,
                      distTarget - attackRange * 0.85,
                    );
                    if (stepDist > 0.001 && distTarget > 0.01) {
                      npc.position.x = THREE.MathUtils.clamp(
                        npc.position.x + (dxTarget / distTarget) * stepDist,
                        -maxBound,
                        maxBound,
                      );
                      npc.position.z = THREE.MathUtils.clamp(
                        npc.position.z + (dzTarget / distTarget) * stepDist,
                        -maxBound,
                        maxBound,
                      );
                      resolveHorizontalObstaclePush(npc.position, 0.44);
                      moving = true;
                    }
                  } else if (
                    !npc.clonesRestricted &&
                    npc.attackCooldown <= 0 &&
                    !npc.attackPendingHit &&
                    activeTargetPos.y < 2.2
                  ) {
                    const hand = npc.punchNextHand;
                    npc.punchNextHand = hand === 'right' ? 'left' : 'right';
                    npc.animator.triggerCast(
                      hand === 'right' ? 'npc-punch-right' : 'npc-punch-left',
                      0.42,
                    );
                    npc.attackCooldown = 1.05;
                    npc.attackPendingHit = true;
                    npc.attackHitDelay = 0.18;
                    npc.pendingTargetType = activeTargetType;
                  }
                }
              } else {
                // Peaceful zone patrol while neutral
                npc.attackPendingHit = false;
                const pdx = npc.patrolTarget.x - npc.position.x;
                const pdz = npc.patrolTarget.z - npc.position.z;
                const pDist = Math.hypot(pdx, pdz);
                if (pDist < 0.45) {
                  npc.patrolPause -= safeDt;
                  if (npc.patrolPause <= 0) {
                    this.pickPatrolTarget(npc);
                  }
                } else {
                  const patrolSpeed = npc.moveSpeed * 0.48 * clonesSlowScale;
                  const step = Math.min(patrolSpeed * safeDt, pDist);
                  npc.position.x = THREE.MathUtils.clamp(
                    npc.position.x + (pdx / pDist) * step,
                    -maxBound,
                    maxBound,
                  );
                  npc.position.z = THREE.MathUtils.clamp(
                    npc.position.z + (pdz / pDist) * step,
                    -maxBound,
                    maxBound,
                  );
                  resolveHorizontalObstaclePush(npc.position, 0.44);
                  const patrolYaw = Math.atan2(-pdx, -pdz);
                  npc.facingYaw = dampAngle(npc.facingYaw, patrolYaw, 6, safeDt);
                  moving = true;
                }
              }
            }
          } else {
            npc.attackPendingHit = false;
          }

          npc.animator.setNpcPistolAim(aimPistol && npc.category === 'bandit');

          const shouldShake =
            npc.painRestricted || (headacheActive && !npc.paralyzed);
          const shakeX = shouldShake ? Math.sin(this.animTime * 42) * 0.032 : 0;
          const shakeZ = shouldShake ? Math.cos(this.animTime * 37) * 0.032 : 0;
          npc.rig.root.position.set(
            npc.position.x + shakeX,
            npc.position.y,
            npc.position.z + shakeZ,
          );
          npc.rig.root.rotation.x = npc.externalPitchX;
          npc.rig.root.rotation.y = npc.facingYaw;
          const animDt =
            headacheActive || npc.externalLimp || npc.agathaDrainVictim
              ? safeDt
              : npc.paralyzed
                ? 0
                : restricted
                  ? safeDt * 0.15
                  : safeDt;
          npc.animator.update(
            animDt,
            moving ? this.walkMotion : this.idleMotion,
          );
        }
      }

      const dd = npc.damageDisplay;
      if (dd.active) {
        if (dd.popTimer > 0) {
          dd.popTimer = Math.max(0, dd.popTimer - safeDt);
        }
        dd.idleTimer += safeDt;
        if (dd.idleTimer >= DAMAGE_AGGREGATE_HOLD_SEC + DAMAGE_FADE_DURATION_SEC) {
          dd.active = false;
          dd.total = 0;
        }
      }
    }

    // Update flying Bandit pistol projectiles with pillar & target collision
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.life -= safeDt;
      this._bulletNext.copy(b.pos).addScaledVector(b.vel, safeDt);

      // Blocked by arena pillars
      if (
        !hasLineOfSight(
          b.pos.x,
          b.pos.y,
          b.pos.z,
          this._bulletNext.x,
          this._bulletNext.y,
          this._bulletNext.z,
        )
      ) {
        this.group.remove(b.mesh);
        this.bullets.splice(i, 1);
        continue;
      }

      b.pos.copy(this._bulletNext);
      b.mesh.position.copy(b.pos);

      const checkPos =
        b.targetType === 'astral-body' && astralBodyPos
          ? astralBodyPos
          : playerTargetable
            ? playerPos
            : null;
      if (checkPos) {
        const dx = checkPos.x - b.pos.x;
        const dy = checkPos.y + 1.0 - b.pos.y;
        const dz = checkPos.z - b.pos.z;
        if (dx * dx + dz * dz < 0.52 * 0.52 && Math.abs(dy) < 1.1) {
          if (b.targetType === 'astral-body' && astralBodyPos) {
            onAstralBodyHit?.(b.damage, b.attackerId);
          } else {
            this._hitDir.copy(b.vel).setY(0);
            if (this._hitDir.lengthSq() > 1e-4) this._hitDir.normalize();
            else this._hitDir.set(0, 0, -1);
            onPlayerHit?.(b.damage, 'pistol', this._hitDir, b.attackerId);
          }
          this.group.remove(b.mesh);
          this.bullets.splice(i, 1);
          continue;
        }
      }

      if (b.life <= 0 || b.pos.y < 0.02) {
        this.group.remove(b.mesh);
        this.bullets.splice(i, 1);
      }
    }

    // Soft separation between active upright moving NPCs
    for (let i = 0; i < this.npcs.length; i++) {
      const a = this.npcs[i];
      if (
        a.hp <= 0 ||
        a.ragdoll.active ||
        a.category === 'basic' ||
        a.paralyzed ||
        a.externalControl
      ) {
        continue;
      }
      for (let j = i + 1; j < this.npcs.length; j++) {
        const b = this.npcs[j];
        if (b.hp <= 0 || b.ragdoll.active || b.paralyzed || b.externalControl) {
          continue;
        }
        const dx = b.position.x - a.position.x;
        const dz = b.position.z - a.position.z;
        const distSq = dx * dx + dz * dz;
        const minSep = 1.15;
        if (distSq > 1e-5 && distSq < minSep * minSep) {
          const dist = Math.sqrt(distSq);
          const push = (minSep - dist) * 0.45;
          const nx = dx / dist;
          const nz = dz / dist;
          a.position.x = THREE.MathUtils.clamp(a.position.x - nx * push, -maxBound, maxBound);
          a.position.z = THREE.MathUtils.clamp(a.position.z - nz * push, -maxBound, maxBound);
          if (b.category !== 'basic') {
            b.position.x = THREE.MathUtils.clamp(b.position.x + nx * push, -maxBound, maxBound);
            b.position.z = THREE.MathUtils.clamp(b.position.z + nz * push, -maxBound, maxBound);
          }
        }
      }
    }

    // Flush single-claim coin elimination events projected to current camera viewport
    if (this.pendingEliminations.length > 0) {
      const events: NpcEliminationEvent[] = [];
      for (const ev of this.pendingEliminations) {
        this._proj.copy(ev.worldPos).project(camera);
        const screenX = THREE.MathUtils.clamp(
          (this._proj.x * 0.5 + 0.5) * viewportWidth,
          36,
          viewportWidth - 36,
        );
        const screenY = THREE.MathUtils.clamp(
          (-this._proj.y * 0.5 + 0.5) * viewportHeight,
          56,
          viewportHeight - 56,
        );
        events.push({
          id: ev.id,
          coins: ev.coins,
          screenX,
          screenY,
        });
      }
      this.pendingEliminations = [];
      onEliminated?.(events);
    }

    let bestId: string | null = null;
    let bestScore = Infinity;

    for (const npc of this.npcs) {
      if (npc.hp <= 0) continue;

      const distToPlayer = this._toNpc
        .copy(npc.position)
        .sub(playerPos)
        .length();
      if (distToPlayer > 28) continue;

      this._proj.set(npc.position.x, npc.position.y + 1.15, npc.position.z);
      this._proj.project(camera);

      if (this._proj.z < -1 || this._proj.z > 1) continue;

      const dx = this._proj.x - reticleNdcX;
      const dy = this._proj.y - reticleNdcY;
      const reticleDist = Math.hypot(dx, dy);

      if (reticleDist > 0.34) continue;

      const stickyBonus = npc.id === this.selectedTargetId ? -0.045 : 0;
      const score = reticleDist + distToPlayer * 0.004 + stickyBonus;
      if (score < bestScore) {
        bestScore = score;
        bestId = npc.id;
      }
    }

    this.selectedTargetId = bestId;

    const snapshots: NpcHudSnapshot[] = [];
    for (const npc of this.npcs) {
      const headHeight = npc.ragdoll.active ? 0.95 : 2.15;
      this._proj.set(npc.position.x, npc.position.y + headHeight, npc.position.z);
      this._proj.project(camera);

      const inFront = this._proj.z >= -1 && this._proj.z <= 1;
      const distToCam = camera.position.distanceTo(npc.position);
      const visible =
        inFront &&
        distToCam < 38 &&
        npc.hp > 0 &&
        Math.abs(this._proj.x) <= 1.08 &&
        Math.abs(this._proj.y) <= 1.08;

      const screenX = (this._proj.x * 0.5 + 0.5) * viewportWidth;
      const screenY = (-this._proj.y * 0.5 + 0.5) * viewportHeight;

      const dd = npc.damageDisplay;
      const popRatio = dd.popTimer / 0.22;
      const popScale = dd.popTimer > 0 ? 1 + Math.sin(popRatio * Math.PI) * 0.44 : 1;

      let fadeRatio = 1;
      let driftX = 0;
      if (dd.idleTimer > DAMAGE_AGGREGATE_HOLD_SEC) {
        const f = THREE.MathUtils.clamp(
          (dd.idleTimer - DAMAGE_AGGREGATE_HOLD_SEC) / DAMAGE_FADE_DURATION_SEC,
          0,
          1,
        );
        fadeRatio = 1 - f;
        driftX = dd.driftDir * f * 34;
      }

      const scale = THREE.MathUtils.clamp(
        6.8 / Math.max(distToCam, 6.8),
        0.44,
        1.0,
      );

      snapshots.push({
        id: npc.id,
        name: npc.name,
        category: npc.category,
        hp: npc.hp,
        maxHp: npc.maxHp,
        trailHp: npc.trailHp,
        visible: visible || (dd.active && inFront),
        screenX,
        screenY,
        scale,
        isTargeted: npc.id === this.selectedTargetId && visible,
        damageNumber: {
          active: dd.active && inFront && distToCam < 38,
          total: dd.total,
          scale: popScale,
          opacity: fadeRatio,
          offsetX: dd.offsetX + driftX,
          offsetY: dd.offsetY,
        },
      });
    }

    return snapshots;
  }

  public resetAll(): void {
    this.selectedTargetId = null;
    this.pendingEliminations = [];
    while (this.bullets.length > 0) {
      const b = this.bullets.pop();
      if (b) this.group.remove(b.mesh);
    }
    for (const npc of this.npcs) {
      npc.ragdoll.reset();
      npc.position.copy(npc.spawnPos);
      npc.patrolTarget.copy(npc.spawnPos);
      npc.rig.root.position.copy(npc.spawnPos);
      npc.rig.root.rotation.set(0, npc.facingYaw, 0);

      npc.hp = npc.maxHp;
      npc.trailHp = npc.maxHp;
      npc.trailHoldTimer = 0;
      npc.ragdollTimer = 0;
      npc.hitFlashTimer = 0;
      npc.muzzleFlashTimer = 0;
      npc.respawnTimer = 0;
      npc.burningTimer = 0;
      npc.burnTickAccum = 0;
      npc.burnSprite.visible = false;
      npc.painRestricted = false;
      npc.paralyzed = false;
      npc.paralysisImmune = false;
      npc.mindControlImmune = false;
      npc.clonesRestricted = false;
      npc.agathaDrainVictim = false;
      npc.rig.setWhiteOutline(false);
      npc.externalControl = false;
      npc.externalHeadache = false;
      npc.externalLimp = false;
      npc.externalPitchX = 0;
      npc.verticalVelocity = 0;
      npc.headacheTimer = 0;
      npc.rewardClaimed = false;
      npc.aggroTargetId = null;
      npc.attackCooldown = 0.4 + Math.random() * 0.4;
      npc.attackPendingHit = false;
      npc.damageDisplay.active = false;
      npc.damageDisplay.total = 0;
      npc.animator = new CharacterAnimator(npc.rig, npc.archetype);
    }
  }

  public dispose(): void {
    while (this.bullets.length > 0) {
      const b = this.bullets.pop();
      if (b) this.group.remove(b.mesh);
    }
    this.bulletGeo.dispose();
    this.bulletMat.dispose();
    for (const npc of this.npcs) {
      npc.rig.dispose();
      (npc.burnSprite.material as THREE.Material).dispose();
    }
    this.burnTex.dispose();
  }
}
