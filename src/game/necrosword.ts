import * as THREE from 'three';

export interface NecroswordRig {
  group: THREE.Group;
  dispose: () => void;
}

/**
 * Constructs Hela's multi-part sculpted obsidian-slate Necrosword
 * (forked crescent pommel, ribbed grip, winged crossguard, beveled hollowed blade)
 * pointing along +Y from the grip base (y = 0) to the tip (y = ~1.58 * scale).
 */
export function buildNecroswordGroup(
  variant: 'standard' | 'giant' = 'standard',
): NecroswordRig {
  const scale = variant === 'giant' ? 3.85 : 1.0;
  const group = new THREE.Group();
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];

  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    geos.push(g);
    return g;
  };
  const trackMat = <T extends THREE.Material>(m: T): T => {
    mats.push(m);
    return m;
  };

  const bladeMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x262c31,
      roughness: 0.34,
      metalness: 0.78,
      emissive: 0x0b2c1d,
      emissiveIntensity: variant === 'giant' ? 0.55 : 0.32,
    }),
  );
  const edgeMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x5c7278,
      roughness: 0.22,
      metalness: 0.9,
      emissive: 0x165e3d,
      emissiveIntensity: variant === 'giant' ? 0.65 : 0.28,
    }),
  );
  const gripMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x131618,
      roughness: 0.68,
      metalness: 0.32,
    }),
  );

  // 1. Forked crescent pommel below hand (-Y)
  for (const side of [-1, 1] as const) {
    const prong = new THREE.Mesh(
      trackGeo(new THREE.ConeGeometry(0.022 * scale, 0.14 * scale, 5)),
      bladeMat,
    );
    prong.position.set(side * 0.042 * scale, -0.24 * scale, 0);
    prong.rotation.z = side * 0.42;
    prong.rotation.x = Math.PI;
    group.add(prong);
  }
  const pommelBase = new THREE.Mesh(
    trackGeo(new THREE.OctahedronGeometry(0.042 * scale, 0)),
    edgeMat,
  );
  pommelBase.position.set(0, -0.18 * scale, 0);
  pommelBase.scale.set(1.15, 0.9, 0.65);
  group.add(pommelBase);

  // 2. Ribbed obsidian grip (y = -0.15 .. +0.11)
  const gripCore = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.022 * scale, 0.026 * scale, 0.28 * scale, 8)),
    gripMat,
  );
  gripCore.position.set(0, -0.02 * scale, 0);
  group.add(gripCore);

  for (let i = 0; i < 4; i++) {
    const rib = new THREE.Mesh(
      trackGeo(new THREE.TorusGeometry(0.028 * scale, 0.008 * scale, 5, 10)),
      bladeMat,
    );
    rib.rotation.x = Math.PI * 0.5;
    rib.position.set(0, (-0.11 + i * 0.058) * scale, 0);
    group.add(rib);
  }

  // 3. Sculpted winged notched crossguard (y = 0.12 .. 0.34)
  const guardCore = new THREE.Mesh(
    trackGeo(new THREE.OctahedronGeometry(0.11 * scale, 0)),
    bladeMat,
  );
  guardCore.position.set(0, 0.21 * scale, 0);
  guardCore.scale.set(1.05, 1.45, 0.34);
  group.add(guardCore);

  for (const side of [-1, 1] as const) {
    const upperWing = new THREE.Mesh(
      trackGeo(new THREE.ConeGeometry(0.036 * scale, 0.18 * scale, 4)),
      edgeMat,
    );
    upperWing.position.set(side * 0.11 * scale, 0.25 * scale, 0);
    upperWing.rotation.z = side * -0.58;
    upperWing.scale.set(0.85, 1, 0.42);
    group.add(upperWing);

    const lowerBarb = new THREE.Mesh(
      trackGeo(new THREE.ConeGeometry(0.026 * scale, 0.13 * scale, 4)),
      bladeMat,
    );
    lowerBarb.position.set(side * 0.095 * scale, 0.13 * scale, 0);
    lowerBarb.rotation.z = side * -2.35;
    lowerBarb.scale.set(0.8, 1, 0.4);
    group.add(lowerBarb);
  }

  // 4. Lower blade neck (y = 0.32 .. 0.72)
  const neckBlade = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.068 * scale, 0.44 * scale, 0.026 * scale)),
    bladeMat,
  );
  neckBlade.position.set(0, 0.51 * scale, 0);
  group.add(neckBlade);

  const spineRidge = new THREE.Mesh(
    trackGeo(new THREE.BoxGeometry(0.018 * scale, 0.96 * scale, 0.036 * scale)),
    edgeMat,
  );
  spineRidge.position.set(0, 0.78 * scale, 0);
  group.add(spineRidge);

  // 5. Split notched mid-blade ribs (hollow window motif from reference)
  for (const side of [-1, 1] as const) {
    const midSpike = new THREE.Mesh(
      trackGeo(new THREE.ConeGeometry(0.032 * scale, 0.11 * scale, 4)),
      edgeMat,
    );
    midSpike.position.set(side * 0.055 * scale, 0.75 * scale, 0);
    midSpike.rotation.z = side * -0.55;
    midSpike.scale.set(0.75, 1, 0.38);
    group.add(midSpike);

    const splitEdge = new THREE.Mesh(
      trackGeo(new THREE.BoxGeometry(0.026 * scale, 0.34 * scale, 0.022 * scale)),
      edgeMat,
    );
    splitEdge.position.set(side * 0.036 * scale, 0.92 * scale, 0);
    splitEdge.rotation.z = side * 0.06;
    group.add(splitEdge);
  }

  // 6. Sharp beveled Necrosword tip (y = 1.06 .. 1.54)
  for (const side of [-1, 1] as const) {
    const tipBarb = new THREE.Mesh(
      trackGeo(new THREE.ConeGeometry(0.025 * scale, 0.1 * scale, 4)),
      edgeMat,
    );
    tipBarb.position.set(side * 0.048 * scale, 1.12 * scale, 0);
    tipBarb.rotation.z = side * -0.62;
    tipBarb.scale.set(0.7, 1, 0.36);
    group.add(tipBarb);
  }

  const tipBlade = new THREE.Mesh(
    trackGeo(new THREE.ConeGeometry(0.065 * scale, 0.44 * scale, 4)),
    edgeMat,
  );
  tipBlade.position.set(0, 1.32 * scale, 0);
  tipBlade.rotation.y = Math.PI * 0.25;
  tipBlade.scale.set(1.0, 1.0, 0.34);
  group.add(tipBlade);

  group.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });

  return {
    group,
    dispose: () => {
      geos.forEach((g) => g.dispose());
      mats.forEach((m) => m.dispose());
    },
  };
}
