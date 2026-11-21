import * as THREE from 'three';
import { CombatTargetProbe } from './scarletWitchAbilities';

function createGreenSparkTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const half = size * 0.5;
  const grad = ctx.createRadialGradient(half, half, 2, half, half, half);
  grad.addColorStop(0.0, 'rgba(236, 255, 244, 1)');
  grad.addColorStop(0.32, 'rgba(92, 255, 168, 0.88)');
  grad.addColorStop(0.68, 'rgba(24, 212, 112, 0.34)');
  grad.addColorStop(1.0, 'rgba(8, 120, 56, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function createWhiteWindTexture(): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const half = size * 0.5;
  const grad = ctx.createRadialGradient(half, half, 4, half, half, half);
  grad.addColorStop(0.0, 'rgba(255, 255, 255, 0.78)');
  grad.addColorStop(0.45, 'rgba(235, 250, 245, 0.45)');
  grad.addColorStop(1.0, 'rgba(220, 255, 240, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

interface AfterimageGhost {
  mesh: THREE.Group;
  mat: THREE.MeshBasicMaterial;
  age: number;
  maxAge: number;
}

interface PunchFxBurst {
  group: THREE.Group;
  ring: THREE.Mesh;
  streak: THREE.Mesh;
  age: number;
  duration: number;
  isFinisher: boolean;
}

interface WindTornadoOrbit {
  angle: number;
  angVel: number;
  radius: number;
  height: number;
  bobPhase: number;
}

interface TimeStopSphereState {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  center: THREE.Vector3;
  age: number;
  expandDuration: number;
  holdDuration: number;
  fadeDuration: number;
  maxRadius: number;
  currentRadius: number;
  frozenIds: Set<string>;
}

export class QuicksilverVfxSystem {
  public readonly group = new THREE.Group();

  private readonly sparkTex: THREE.CanvasTexture;
  private readonly windTex: THREE.CanvasTexture;
  private readonly lightningMat: THREE.LineBasicMaterial;

  // Super speed lightning arcs & afterimage ghosts
  private readonly speedBolts: THREE.Line[] = [];
  private readonly afterimages: AfterimageGhost[] = [];
  private ghostSpawnAccum = 0;

  // Punch hit VFX bursts
  private readonly punchBursts: PunchFxBurst[] = [];

  // Wind tornado (toggleable)
  private tornadoActive = false;
  private readonly tornadoCenter = new THREE.Vector3();
  private readonly tornadoGroup = new THREE.Group();
  private readonly tornadoRings: THREE.Mesh[] = [];
  private readonly tornadoWindSprites: Array<{
    sprite: THREE.Sprite;
    angle: number;
    speed: number;
    radius: number;
    height: number;
  }> = [];
  private readonly tornadoBolts: THREE.Line[] = [];
  private tornadoDmgTimer = 0;
  private readonly tornadoOrbits = new Map<string, WindTornadoOrbit>();

  // Time Stop simple translucent green sphere
  private timeStopState: TimeStopSphereState | null = null;
  private animTime = 0;

  constructor() {
    this.sparkTex = createGreenSparkTexture();
    this.windTex = createWhiteWindTexture();
    this.lightningMat = new THREE.LineBasicMaterial({
      color: 0x62ffb0,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
    });

    // 4 speed lightning bolts around Quicksilver
    for (let i = 0; i < 4; i++) {
      const pts = Array.from({ length: 7 }, () => new THREE.Vector3());
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        this.lightningMat,
      );
      line.visible = false;
      this.speedBolts.push(line);
      this.group.add(line);
    }

    this.initWindTornadoVisual();
  }

  private initWindTornadoVisual(): void {
    this.tornadoGroup.visible = false;

    // Stacked translucent white wind ribbons forming wide funnel
    const tiers = 10;
    for (let i = 0; i < tiers; i++) {
      const t = i / (tiers - 1);
      const radius = 1.45 + t * 3.85;
      const geo = new THREE.TorusGeometry(radius, 0.16 + t * 0.12, 8, 36);
      geo.rotateX(Math.PI * 0.5);
      const mat = new THREE.MeshBasicMaterial({
        color: 0xf4fff9,
        transparent: true,
        opacity: 0.34 - t * 0.12,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const ring = new THREE.Mesh(geo, mat);
      ring.position.y = 0.28 + t * 4.4;
      this.tornadoRings.push(ring);
      this.tornadoGroup.add(ring);
    }

    // Soft white cloud funnel sprites
    for (let i = 0; i < 24; i++) {
      const t = i / 24;
      const mat = new THREE.SpriteMaterial({
        map: this.windTex,
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
      });
      const s = new THREE.Sprite(mat);
      const sc = 1.6 + t * 2.2;
      s.scale.set(sc, sc * 0.65, 1);
      this.tornadoGroup.add(s);
      this.tornadoWindSprites.push({
        sprite: s,
        angle: (i * Math.PI * 2) / 5,
        speed: 6.5 + (1 - t) * 5.0,
        radius: 1.4 + t * 3.6,
        height: 0.35 + t * 4.5,
      });
    }

    // Green speed lightning flickers around the white wind tornado
    for (let b = 0; b < 5; b++) {
      const pts = Array.from({ length: 7 }, () => new THREE.Vector3());
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        this.lightningMat,
      );
      this.tornadoBolts.push(line);
      this.tornadoGroup.add(line);
    }

    this.group.add(this.tornadoGroup);
  }

  public isWindTornadoActive(): boolean {
    return this.tornadoActive;
  }

  public getWindTornadoCenter(): THREE.Vector3 {
    return this.tornadoCenter;
  }

  public setWindTornado(active: boolean, center?: THREE.Vector3): void {
    this.tornadoActive = active;
    this.tornadoGroup.visible = active;
    if (active && center) {
      this.tornadoCenter.set(center.x, 0, center.z);
      this.tornadoGroup.position.copy(this.tornadoCenter);
      this.tornadoDmgTimer = 0;
    }
  }

  public spawnPunchImpact(worldPos: THREE.Vector3, isFinisher: boolean): void {
    const g = new THREE.Group();
    g.position.set(
      worldPos.x + (Math.random() - 0.5) * 0.4,
      worldPos.y + 0.9 + (Math.random() - 0.5) * 0.45,
      worldPos.z + (Math.random() - 0.5) * 0.4,
    );

    const ringGeo = new THREE.RingGeometry(0.18, isFinisher ? 0.52 : 0.34, 24);
    const ringMat = new THREE.MeshBasicMaterial({
      color: isFinisher ? 0xc2ffe0 : 0x52ffa8,
      transparent: true,
      opacity: 0.92,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
    g.add(ring);

    const streakGeo = new THREE.BoxGeometry(0.06, 0.06, isFinisher ? 2.2 : 1.1);
    const streakMat = new THREE.MeshBasicMaterial({
      color: 0xa4ffd0,
      transparent: true,
      opacity: 0.88,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const streak = new THREE.Mesh(streakGeo, streakMat);
    streak.rotation.set((Math.random() - 0.5) * 1.2, Math.random() * Math.PI * 2, 0);
    g.add(streak);

    this.group.add(g);
    this.punchBursts.push({
      group: g,
      ring,
      streak,
      age: 0,
      duration: isFinisher ? 0.45 : 0.18,
      isFinisher,
    });
  }

  public spawnTimeStop(center: THREE.Vector3): boolean {
    if (this.timeStopState) return false;

    // Simple, clean translucent green sphere WITHOUT clutter, sparks, or extra decorations
    const geo = new THREE.SphereGeometry(1, 36, 24);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x3cff96,
      transparent: true,
      opacity: 0.24,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(center.x, 0.9, center.z);
    mesh.scale.setScalar(0.35);
    this.group.add(mesh);

    this.timeStopState = {
      mesh,
      mat,
      center: new THREE.Vector3(center.x, 0.9, center.z),
      age: 0,
      expandDuration: 0.65,
      holdDuration: 4.5,
      fadeDuration: 0.48,
      maxRadius: 11.5,
      currentRadius: 0.35,
      frozenIds: new Set<string>(),
    };
    return true;
  }

  private spawnAfterimage(pos: THREE.Vector3, yaw: number): void {
    const mat = new THREE.MeshBasicMaterial({
      color: 0x4cff9e,
      transparent: true,
      opacity: 0.36,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const g = new THREE.Group();
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.68, 0.32), mat);
    torso.position.y = 1.1;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.38, 0.38), mat);
    head.position.y = 1.66;
    const legs = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.7, 0.3), mat);
    legs.position.y = 0.4;
    g.add(torso, head, legs);
    g.position.copy(pos);
    g.rotation.y = yaw;
    this.group.add(g);

    this.afterimages.push({
      mesh: g,
      mat,
      age: 0,
      maxAge: 0.24,
    });
  }

  private randomizeLightning(line: THREE.Line, a: THREE.Vector3, b: THREE.Vector3, jitter: number): void {
    const posAttr = line.geometry.getAttribute('position') as THREE.BufferAttribute;
    const count = posAttr.count;
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      const env = Math.sin(t * Math.PI);
      posAttr.setXYZ(
        i,
        THREE.MathUtils.lerp(a.x, b.x, t) + (Math.random() - 0.5) * jitter * env,
        THREE.MathUtils.lerp(a.y, b.y, t) + (Math.random() - 0.5) * jitter * env,
        THREE.MathUtils.lerp(a.z, b.z, t) + (Math.random() - 0.5) * jitter * env,
      );
    }
    posAttr.needsUpdate = true;
  }

  public update(
    dt: number,
    playerPos: THREE.Vector3,
    playerYaw: number,
    horizontalSpeed: number,
    speedEffectsActive: boolean,
    targets: CombatTargetProbe[],
    callbacks: {
      onWindTornadoControl?: (
        id: string,
        pos: THREE.Vector3,
        yaw: number,
        tickDamage: number,
      ) => void;
      onWindTornadoRelease?: (id: string) => void;
      onTimeFreezeChange?: (id: string, frozen: boolean) => void;
    },
  ): void {
    const safeDt = Math.min(dt, 0.05);
    this.animTime += safeDt;

    // 1. Super Speed green lightning & trail afterimages
    const showSpeedVfx = speedEffectsActive && (horizontalSpeed > 2.2 || this.tornadoActive);
    for (let i = 0; i < this.speedBolts.length; i++) {
      const line = this.speedBolts[i];
      line.visible = showSpeedVfx;
      if (showSpeedVfx) {
        const ang = (i * Math.PI * 0.5) + this.animTime * 9;
        this.randomizeLightning(
          line,
          new THREE.Vector3(
            playerPos.x + Math.cos(ang) * 0.42,
            playerPos.y + 0.35 + Math.random() * 0.4,
            playerPos.z + Math.sin(ang) * 0.42,
          ),
          new THREE.Vector3(
            playerPos.x + Math.cos(ang + 1.2) * 0.42,
            playerPos.y + 1.4 + Math.random() * 0.3,
            playerPos.z + Math.sin(ang + 1.2) * 0.42,
          ),
          0.35,
        );
      }
    }

    if (speedEffectsActive && horizontalSpeed > 4.5) {
      this.ghostSpawnAccum += safeDt;
      if (this.ghostSpawnAccum >= 0.045) {
        this.ghostSpawnAccum = 0;
        this.spawnAfterimage(playerPos, playerYaw);
      }
    } else {
      this.ghostSpawnAccum = 0;
    }

    for (let i = this.afterimages.length - 1; i >= 0; i--) {
      const g = this.afterimages[i];
      g.age += safeDt;
      const u = Math.min(1, g.age / g.maxAge);
      g.mat.opacity = 0.36 * (1 - u);
      if (u >= 1) {
        this.group.remove(g.mesh);
        g.mat.dispose();
        this.afterimages.splice(i, 1);
      }
    }

    // 2. Rapid Punch impact bursts
    for (let i = this.punchBursts.length - 1; i >= 0; i--) {
      const b = this.punchBursts[i];
      b.age += safeDt;
      const p = Math.min(1, b.age / b.duration);
      const sc = b.isFinisher ? 1 + p * 5.2 : 1 + p * 2.4;
      b.ring.scale.setScalar(sc);
      (b.ring.material as THREE.MeshBasicMaterial).opacity = (1 - p) * 0.9;
      (b.streak.material as THREE.MeshBasicMaterial).opacity = (1 - p) * 0.85;
      if (p >= 1) {
        this.group.remove(b.group);
        this.punchBursts.splice(i, 1);
      }
    }

    // 3. Wind Tornado
    if (this.tornadoActive) {
      for (let i = 0; i < this.tornadoRings.length; i++) {
        const ring = this.tornadoRings[i];
        ring.rotation.y += (8.5 - i * 0.45) * safeDt;
        const wob = Math.sin(this.animTime * 9 + i) * 0.14;
        ring.position.x = wob;
        ring.position.z = Math.cos(this.animTime * 8 + i) * 0.14;
      }

      for (const s of this.tornadoWindSprites) {
        s.angle += s.speed * safeDt;
        s.sprite.position.set(
          Math.cos(s.angle) * s.radius,
          s.height + Math.sin(this.animTime * 6 + s.angle) * 0.18,
          Math.sin(s.angle) * s.radius,
        );
      }

      for (let b = 0; b < this.tornadoBolts.length; b++) {
        const a0 = this.animTime * 11 + (b * Math.PI * 2) / this.tornadoBolts.length;
        this.randomizeLightning(
          this.tornadoBolts[b],
          new THREE.Vector3(Math.cos(a0) * 1.5, 0.35, Math.sin(a0) * 1.5),
          new THREE.Vector3(Math.cos(a0 + 1.1) * 4.8, 4.4, Math.sin(a0 + 1.1) * 4.8),
          0.65,
        );
      }

      this.tornadoDmgTimer += safeDt;
      const tickDmg = this.tornadoDmgTimer >= 0.5;
      if (tickDmg) this.tornadoDmgTimer -= 0.5;

      const activeIds = new Set<string>();
      for (const t of targets) {
        const d = Math.hypot(
          t.position.x - this.tornadoCenter.x,
          t.position.z - this.tornadoCenter.z,
        );
        if (d <= 6.8 || (this.tornadoOrbits.has(t.id) && d <= 8.2)) {
          activeIds.add(t.id);
          let orb = this.tornadoOrbits.get(t.id);
          if (!orb) {
            orb = {
              angle: Math.atan2(
                t.position.z - this.tornadoCenter.z,
                t.position.x - this.tornadoCenter.x,
              ),
              angVel: 5.2 + Math.random() * 2.2,
              radius: 2.1 + Math.random() * 1.9,
              height: 0.7 + Math.random() * 1.8,
              bobPhase: Math.random() * Math.PI * 2,
            };
            this.tornadoOrbits.set(t.id, orb);
          }
          orb.angle += orb.angVel * safeDt;
          const pos = new THREE.Vector3(
            this.tornadoCenter.x + Math.cos(orb.angle) * orb.radius,
            orb.height + Math.sin(this.animTime * 6 + orb.bobPhase) * 0.35,
            this.tornadoCenter.z + Math.sin(orb.angle) * orb.radius,
          );
          callbacks.onWindTornadoControl?.(
            t.id,
            pos,
            orb.angle + Math.PI * 0.5,
            tickDmg ? 7 : 0,
          );
        }
      }

      for (const id of Array.from(this.tornadoOrbits.keys())) {
        if (!activeIds.has(id)) {
          this.tornadoOrbits.delete(id);
          callbacks.onWindTornadoRelease?.(id);
        }
      }
    } else if (this.tornadoOrbits.size > 0) {
      for (const id of Array.from(this.tornadoOrbits.keys())) {
        callbacks.onWindTornadoRelease?.(id);
      }
      this.tornadoOrbits.clear();
    }

    // 4. Time Stop simple translucent green expanding sphere
    if (this.timeStopState) {
      const ts = this.timeStopState;
      ts.age += safeDt;
      const total = ts.expandDuration + ts.holdDuration + ts.fadeDuration;
      if (ts.age < ts.expandDuration) {
        const k = 1 - Math.pow(1 - ts.age / ts.expandDuration, 3);
        ts.currentRadius = 0.35 + (ts.maxRadius - 0.35) * k;
        ts.mat.opacity = 0.25;
      } else if (ts.age < ts.expandDuration + ts.holdDuration) {
        ts.currentRadius = ts.maxRadius;
        ts.mat.opacity = 0.22;
      } else {
        const f = Math.min(
          1,
          (ts.age - ts.expandDuration - ts.holdDuration) / ts.fadeDuration,
        );
        ts.mat.opacity = 0.22 * (1 - f);
      }

      ts.mesh.scale.setScalar(ts.currentRadius);

      if (ts.age >= total) {
        for (const id of ts.frozenIds) {
          callbacks.onTimeFreezeChange?.(id, false);
        }
        ts.frozenIds.clear();
        this.group.remove(ts.mesh);
        ts.mesh.geometry.dispose();
        ts.mat.dispose();
        this.timeStopState = null;
      } else {
        const aliveIds = new Set<string>();
        for (const t of targets) {
          aliveIds.add(t.id);
          const dist = Math.hypot(
            t.position.x - ts.center.x,
            t.position.y + 0.9 - ts.center.y,
            t.position.z - ts.center.z,
          );
          if (dist <= ts.currentRadius + 0.45 && !ts.frozenIds.has(t.id)) {
            ts.frozenIds.add(t.id);
            callbacks.onTimeFreezeChange?.(t.id, true);
          }
        }
        // Clean up ids of NPCs that died/respawned
        for (const id of Array.from(ts.frozenIds)) {
          if (!aliveIds.has(id)) {
            ts.frozenIds.delete(id);
          }
        }
      }
    }
  }

  public clearAll(
    onWindRelease?: (id: string) => void,
    onTimeUnfreeze?: (id: string) => void,
  ): void {
    this.tornadoActive = false;
    this.tornadoGroup.visible = false;
    for (const id of this.tornadoOrbits.keys()) {
      onWindRelease?.(id);
    }
    this.tornadoOrbits.clear();

    if (this.timeStopState) {
      for (const id of this.timeStopState.frozenIds) {
        onTimeUnfreeze?.(id);
      }
      this.group.remove(this.timeStopState.mesh);
      this.timeStopState.mesh.geometry.dispose();
      this.timeStopState.mat.dispose();
      this.timeStopState = null;
    }

    for (const l of this.speedBolts) l.visible = false;
    for (const g of this.afterimages) {
      this.group.remove(g.mesh);
      g.mat.dispose();
    }
    this.afterimages.length = 0;
    for (const b of this.punchBursts) this.group.remove(b.group);
    this.punchBursts.length = 0;
  }

  public dispose(): void {
    this.clearAll();
    this.sparkTex.dispose();
    this.windTex.dispose();
    this.lightningMat.dispose();
  }
}
