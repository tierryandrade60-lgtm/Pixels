import * as THREE from 'three';

export type ShieldKind = 'auto-shield' | 'diamond-form' | 'mystic-shield';

export const SHIELD_MAX_DURABILITY: Record<ShieldKind, number> = {
  'auto-shield': 100,
  'diamond-form': 150,
  'mystic-shield': 120,
};

export const SHIELD_COLORS: Record<
  ShieldKind,
  { main: string; rim: string; disc: string }
> = {
  'auto-shield': {
    main: '#FF2956',
    rim: '#FF98B0',
    disc: '#FF3662',
  },
  'diamond-form': {
    main: '#8FE8FF',
    rim: '#EFFBFF',
    disc: '#9EF0FF',
  },
  'mystic-shield': {
    main: '#FF9426',
    rim: '#FFE084',
    disc: '#FF9D2E',
  },
};

interface ExpandingDisc {
  group: THREE.Group;
  innerMat: THREE.MeshBasicMaterial;
  outerMat: THREE.MeshBasicMaterial;
  elapsed: number;
  duration: number;
}

export interface ProtectedTagRecord {
  id: number;
  worldPos: THREE.Vector3;
  color: string;
  elapsed: number;
  duration: number;
}

/**
 * Renders subtle horizontal expanding energy discs around a shielded character
 * whenever a shield absorbs incoming damage, and tracks synchronized "Protected"
 * torso popup tags for projection onto the combat HUD overlay.
 */
export class ShieldHitVfxSystem {
  public readonly group = new THREE.Group();

  private readonly discs: ExpandingDisc[] = [];
  public readonly protectedTags: ProtectedTagRecord[] = [];
  private nextTagId = 1;

  private readonly discFillGeo = new THREE.CircleGeometry(0.95, 28);
  private readonly discRingGeo = new THREE.RingGeometry(0.76, 1.0, 28);

  constructor() {
    this.discFillGeo.rotateX(-Math.PI / 2);
    this.discRingGeo.rotateX(-Math.PI / 2);
  }

  public triggerAbsorb(
    characterBasePos: THREE.Vector3,
    kind: ShieldKind,
  ): void {
    const palette = SHIELD_COLORS[kind];
    const torsoY = characterBasePos.y + 1.08;

    // 1. Expanding horizontal energy disc
    while (this.discs.length >= 10) {
      const oldest = this.discs.shift();
      if (oldest) {
        this.group.remove(oldest.group);
        oldest.innerMat.dispose();
        oldest.outerMat.dispose();
      }
    }

    const discGroup = new THREE.Group();
    discGroup.position.set(characterBasePos.x, torsoY, characterBasePos.z);
    discGroup.scale.setScalar(0.24);

    const innerMat = new THREE.MeshBasicMaterial({
      color: palette.disc,
      transparent: true,
      opacity: 0.34,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const outerMat = new THREE.MeshBasicMaterial({
      color: palette.rim,
      transparent: true,
      opacity: 0.92,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const fill = new THREE.Mesh(this.discFillGeo, innerMat);
    const ring = new THREE.Mesh(this.discRingGeo, outerMat);
    ring.position.y = 0.008;
    discGroup.add(fill, ring);
    this.group.add(discGroup);

    this.discs.push({
      group: discGroup,
      innerMat,
      outerMat,
      elapsed: 0,
      duration: 0.44,
    });

    // 2. Synchronized "Protected" torso tag
    if (this.protectedTags.length >= 8) {
      this.protectedTags.shift();
    }
    this.protectedTags.push({
      id: this.nextTagId++,
      worldPos: new THREE.Vector3(characterBasePos.x, torsoY + 0.08, characterBasePos.z),
      color: palette.rim,
      elapsed: 0,
      duration: 0.65,
    });
  }

  public update(dt: number): void {
    const safeDt = Math.min(dt, 0.05);

    for (let i = this.discs.length - 1; i >= 0; i--) {
      const d = this.discs[i];
      d.elapsed += safeDt;
      const t = Math.min(1, d.elapsed / d.duration);
      const easeOut = 1 - Math.pow(1 - t, 3);

      const scale = 0.24 + easeOut * 1.95;
      d.group.scale.setScalar(scale);

      const fade = t < 0.25 ? 1 : Math.max(0, 1 - (t - 0.25) / 0.75);
      d.innerMat.opacity = 0.32 * fade;
      d.outerMat.opacity = 0.92 * fade;

      if (d.elapsed >= d.duration) {
        this.discs.splice(i, 1);
        this.group.remove(d.group);
        d.innerMat.dispose();
        d.outerMat.dispose();
      }
    }

    for (let i = this.protectedTags.length - 1; i >= 0; i--) {
      const tag = this.protectedTags[i];
      tag.elapsed += safeDt;
      tag.worldPos.y += safeDt * 0.45;
      if (tag.elapsed >= tag.duration) {
        this.protectedTags.splice(i, 1);
      }
    }
  }

  public dispose(): void {
    while (this.discs.length > 0) {
      const d = this.discs.pop();
      if (d) {
        this.group.remove(d.group);
        d.innerMat.dispose();
        d.outerMat.dispose();
      }
    }
    this.protectedTags.length = 0;
    this.discFillGeo.dispose();
    this.discRingGeo.dispose();
  }
}
