import * as THREE from 'three';

interface RockShard {
  mesh: THREE.Mesh;
  mat: THREE.MeshStandardMaterial;
  vx: number;
  vy: number;
  vz: number;
  rx: number;
  ry: number;
  rz: number;
  baseScale: number;
  bounced: boolean;
}

interface GroundCrackPlate {
  mesh: THREE.Mesh;
  mat: THREE.MeshStandardMaterial;
  baseScale: number;
}

interface RockBreakBurst {
  group: THREE.Group;
  crackRing: THREE.Mesh;
  crackRingMat: THREE.MeshBasicMaterial;
  crackPlates: GroundCrackPlate[];
  shards: RockShard[];
  cracks: THREE.Mesh[];
  crackMat: THREE.MeshBasicMaterial;
  elapsed: number;
  duration: number;
  peakScale: number;
}

/**
 * Cartoon-style 3D Rock Break VFX System.
 * Triggers exclusively on heavy ground impacts, scaled by impact force,
 * spawning animated radial cracks, broken stone plates, and flying rock fragments.
 */
export class RockBreakVfxSystem {
  public readonly group = new THREE.Group();

  private readonly bursts: RockBreakBurst[] = [];
  private readonly shardGeoA = new THREE.DodecahedronGeometry(0.18, 0);
  private readonly shardGeoB = new THREE.BoxGeometry(0.24, 0.16, 0.22);
  private readonly plateGeo = new THREE.BoxGeometry(0.55, 0.08, 0.42);
  private readonly ringGeo = new THREE.RingGeometry(0.32, 0.96, 14);
  private readonly crackLineGeo = new THREE.PlaneGeometry(0.11, 1.0);

  constructor() {
    this.ringGeo.rotateX(-Math.PI / 2);
    this.crackLineGeo.rotateX(-Math.PI / 2);
  }

  /**
   * @param pos World ground point of the heavy impact
   * @param force Scale factor (~0.8 small-heavy slam .. 2.4 massive meteor/dive)
   * @param accentHex Optional impact rim tint (e.g. crater glow)
   */
  public spawnImpact(
    pos: THREE.Vector3,
    force = 1.0,
    accentHex = '#0D1322',
  ): void {
    // Cap concurrent bursts for mobile & desktop FPS smoothness
    while (this.bursts.length >= 6) {
      const oldest = this.bursts.shift();
      if (oldest) this.cleanupBurst(oldest);
    }

    const clampedForce = THREE.MathUtils.clamp(force, 0.7, 2.6);
    const burstGroup = new THREE.Group();
    burstGroup.position.set(pos.x, Math.max(0.015, pos.y + 0.015), pos.z);

    // 1. Cartoon dark crater outline ring expanding briefly on impact
    const crackRingMat = new THREE.MeshBasicMaterial({
      color: accentHex,
      transparent: true,
      opacity: 0.88,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const crackRing = new THREE.Mesh(this.ringGeo, crackRingMat);
    crackRing.position.y = 0.012;
    crackRing.scale.setScalar(0.35 * clampedForce);
    burstGroup.add(crackRing);

    // 2. Jagged cartoon ground crack lines radiating outward
    const crackMat = new THREE.MeshBasicMaterial({
      color: '#0A0D18',
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const crackCount = clampedForce > 1.35 ? 8 : 6;
    const cracks: THREE.Mesh[] = [];
    for (let i = 0; i < crackCount; i++) {
      const angle = (i / crackCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.34;
      const len = (1.1 + Math.random() * 0.95) * clampedForce;
      const crack = new THREE.Mesh(this.crackLineGeo, crackMat);
      crack.position.set(
        Math.cos(angle) * len * 0.45,
        0.016,
        Math.sin(angle) * len * 0.45,
      );
      crack.rotation.y = -angle + Math.PI * 0.5;
      crack.scale.set(0.75 + Math.random() * 0.45, 1, len);
      burstGroup.add(crack);
      cracks.push(crack);
    }

    // 3. Tilted broken ground stone plates around epicenter
    const plateCount = Math.min(7, Math.round(3 + clampedForce * 2));
    const crackPlates: GroundCrackPlate[] = [];
    for (let i = 0; i < plateCount; i++) {
      const angle = (i / plateCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.32;
      const dist = (0.48 + Math.random() * 0.45) * clampedForce;
      const shade = i % 2 === 0 ? '#3E4B68' : '#2C3752';
      const mat = new THREE.MeshStandardMaterial({
        color: shade,
        roughness: 0.85,
        metalness: 0.08,
        flatShading: true,
        transparent: true,
        opacity: 0.96,
      });
      const plate = new THREE.Mesh(this.plateGeo, mat);
      plate.position.set(
        Math.cos(angle) * dist,
        0.03,
        Math.sin(angle) * dist,
      );
      plate.rotation.y = -angle + (Math.random() - 0.5) * 0.4;
      plate.rotation.x = 0.24 + Math.random() * 0.22;
      const s = (0.78 + Math.random() * 0.45) * Math.sqrt(clampedForce);
      plate.scale.setScalar(s);
      plate.castShadow = false;
      plate.receiveShadow = true;
      burstGroup.add(plate);
      crackPlates.push({ mesh: plate, mat, baseScale: s });
    }

    // 4. Flying cartoon rock fragments (eruption with gravity + bounce)
    const shardCount = Math.min(14, Math.round(6 + clampedForce * 4));
    const shards: RockShard[] = [];
    for (let i = 0; i < shardCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radialSpeed = (2.4 + Math.random() * 4.2) * Math.sqrt(clampedForce);
      const upSpeed = (4.6 + Math.random() * 4.4) * Math.sqrt(clampedForce);
      const shade = i % 3 === 0 ? '#506084' : i % 3 === 1 ? '#36425E' : '#252E44';
      const mat = new THREE.MeshStandardMaterial({
        color: shade,
        roughness: 0.82,
        metalness: 0.08,
        flatShading: true,
        transparent: true,
        opacity: 1,
      });
      const mesh = new THREE.Mesh(i % 2 === 0 ? this.shardGeoA : this.shardGeoB, mat);
      const spawnDist = (0.15 + Math.random() * 0.5) * clampedForce;
      mesh.position.set(
        Math.cos(angle) * spawnDist,
        0.12 + Math.random() * 0.22,
        Math.sin(angle) * spawnDist,
      );
      const baseScale = (0.7 + Math.random() * 0.72) * (0.75 + clampedForce * 0.26);
      mesh.scale.setScalar(baseScale);
      burstGroup.add(mesh);

      shards.push({
        mesh,
        mat,
        vx: Math.cos(angle) * radialSpeed,
        vy: upSpeed,
        vz: Math.sin(angle) * radialSpeed,
        rx: (Math.random() - 0.5) * 11,
        ry: (Math.random() - 0.5) * 11,
        rz: (Math.random() - 0.5) * 11,
        baseScale,
        bounced: false,
      });
    }

    this.group.add(burstGroup);
    this.bursts.push({
      group: burstGroup,
      crackRing,
      crackRingMat,
      crackPlates,
      shards,
      cracks,
      crackMat,
      elapsed: 0,
      duration: 1.55 + clampedForce * 0.3,
      peakScale: clampedForce,
    });
  }

  public update(dt: number): void {
    const safeDt = Math.min(dt, 0.05);
    const gravity = -24.0;

    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.elapsed += safeDt;
      const t = Math.min(1, b.elapsed / b.duration);

      // Ring pops outward immediately in first 0.25s, then fades cleanly
      const ringExpand = 0.4 + Math.min(1, b.elapsed / 0.24) * 1.45 * b.peakScale;
      b.crackRing.scale.setScalar(ringExpand);
      b.crackRingMat.opacity = Math.max(0, (1 - Math.min(1, b.elapsed / 0.65)) * 0.78);

      // Ground cracks hold solid briefly then fade out in final 45%
      const crackAlpha = t < 0.55 ? 0.92 : Math.max(0, 1 - (t - 0.55) / 0.45) * 0.92;
      b.crackMat.opacity = crackAlpha;
      const crackGrow = Math.min(1, b.elapsed / 0.09);
      for (let c = 0; c < b.cracks.length; c++) {
        const cr = b.cracks[c];
        cr.scale.y = Math.max(0.01, crackGrow);
      }

      // Ground plates settle and fade near the end
      const plateAlpha = t < 0.6 ? 0.96 : Math.max(0, 1 - (t - 0.6) / 0.4) * 0.96;
      for (let p = 0; p < b.crackPlates.length; p++) {
        const pl = b.crackPlates[p];
        pl.mat.opacity = plateAlpha;
        if (t > 0.72) {
          const shrink = 1 - (t - 0.72) / 0.28;
          pl.mesh.scale.setScalar(Math.max(0.01, pl.baseScale * shrink));
        }
      }

      // Flying rock fragments obey ballistic arc + crisp bounce + shrink fade
      for (let s = 0; s < b.shards.length; s++) {
        const sh = b.shards[s];
        sh.vy += gravity * safeDt;
        sh.mesh.position.x += sh.vx * safeDt;
        sh.mesh.position.y += sh.vy * safeDt;
        sh.mesh.position.z += sh.vz * safeDt;

        sh.mesh.rotation.x += sh.rx * safeDt;
        sh.mesh.rotation.y += sh.ry * safeDt;
        sh.mesh.rotation.z += sh.rz * safeDt;

        if (sh.mesh.position.y <= 0.07) {
          sh.mesh.position.y = 0.07;
          if (!sh.bounced && sh.vy < -1.5) {
            sh.vy = Math.abs(sh.vy) * 0.34;
            sh.vx *= 0.52;
            sh.vz *= 0.52;
            sh.rx *= 0.45;
            sh.ry *= 0.45;
            sh.rz *= 0.45;
            sh.bounced = true;
          } else {
            sh.vy = 0;
            sh.vx *= 0.84;
            sh.vz *= 0.84;
            sh.rx *= 0.7;
            sh.ry *= 0.7;
            sh.rz *= 0.7;
          }
        }

        const fade = t < 0.58 ? 1 : Math.max(0, 1 - (t - 0.58) / 0.42);
        sh.mat.opacity = fade;
        sh.mesh.scale.setScalar(Math.max(0.01, sh.baseScale * (0.25 + 0.75 * fade)));
      }

      if (b.elapsed >= b.duration) {
        this.bursts.splice(i, 1);
        this.cleanupBurst(b);
      }
    }
  }

  private cleanupBurst(b: RockBreakBurst): void {
    this.group.remove(b.group);
    b.crackRingMat.dispose();
    b.crackMat.dispose();
    for (const p of b.crackPlates) p.mat.dispose();
    for (const s of b.shards) s.mat.dispose();
  }

  public dispose(): void {
    while (this.bursts.length > 0) {
      const b = this.bursts.pop();
      if (b) this.cleanupBurst(b);
    }
    this.shardGeoA.dispose();
    this.shardGeoB.dispose();
    this.plateGeo.dispose();
    this.ringGeo.dispose();
    this.crackLineGeo.dispose();
  }
}
