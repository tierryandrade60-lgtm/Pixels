import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { HandAgathaAura } from '../game/agathaAbilities';
import { CharacterAnimator } from '../game/characterAnimator';
import { CharacterDefinition, resolveCharacterWithSkin } from '../game/characters';
import { EmmaIdleForeheadRings } from '../game/emmaFrostAbilities';
import { HandFireAura, PhoenixWings } from '../game/phoenixAbilities';
import { createContactShadowTexture } from '../game/pixelTextures';
import { createR16Character } from '../game/r16Character';
import { HandChaosAura } from '../game/scarletWitchAbilities';

interface CharacterPreviewCanvasProps {
  character: CharacterDefinition;
  skinId?: string | null;
  forcedLandscape?: boolean;
}

export function CharacterPreviewCanvas({
  character,
  skinId,
  forcedLandscape = false,
}: CharacterPreviewCanvasProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const spinStateRef = useRef<{
    dragging: boolean;
    pointerId: number | null;
    lastX: number;
    userYaw: number;
  }>({
    dragging: false,
    pointerId: null,
    lastX: 0,
    userYaw: 0,
  });

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const resolved = resolveCharacterWithSkin(character, skinId);
    const { appearance, preview } = resolved;

    const width = Math.max(container.clientWidth, 1);
    const height = Math.max(container.clientHeight, 1);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();

    const pmrem = new THREE.PMREMGenerator(renderer);
    const roomEnv = new RoomEnvironment();
    const envRT = pmrem.fromScene(roomEnv, 0.04);
    scene.environment = envRT.texture;
    scene.environmentIntensity = 0.72;
    roomEnv.dispose();
    pmrem.dispose();

    const isWitch = appearance.archetype === 'scarlet-witch';
    const isAgatha = appearance.archetype === 'agatha-harkness';
    const isPhoenix = appearance.archetype === 'phoenix-force';
    const isEmma = appearance.archetype === 'emma-frost';
    const isHela = appearance.archetype === 'hela';
    const isMagneto = appearance.archetype === 'magneto';
    const isQuicksilver = appearance.archetype === 'quicksilver';
    const isStrange = appearance.archetype === 'doctor-strange';
    const isVision = appearance.archetype === 'vision';
    const isCaped = isMagneto || isStrange || isVision;

    const camera = new THREE.PerspectiveCamera(36, width / height, 0.1, 40);
    const updatePreviewCamera = (w: number, h: number) => {
      const safeW = Math.max(w, 1);
      const safeH = Math.max(h, 1);
      const aspect = Math.max(safeW / safeH, 0.35);
      const vFov = aspect < 1 ? 42 : 36;
      const tanHalfV = Math.tan(THREE.MathUtils.degToRad(vFov * 0.5));

      // Enclose from podium underside (y = -0.22) up to tall headgear/wings (y = +2.55)
      const targetY = Math.max(preview.cameraOffsetY, 1.14);
      const halfH = isHela || isPhoenix ? 1.56 : isCaped ? 1.52 : 1.48;
      const halfW = isHela || isPhoenix ? 1.42 : isCaped ? 1.24 : 1.16;

      const distForH = halfH / tanHalfV;
      const distForW = halfW / (tanHalfV * aspect);
      const dist = Math.max(preview.cameraDistance, distForH, distForW);

      camera.fov = vFov;
      camera.aspect = aspect;
      camera.position.set(0, targetY + 0.16, dist);
      camera.lookAt(0, targetY, 0);
      camera.updateProjectionMatrix();
    };
    updatePreviewCamera(width, height);

    // Toy-box Studio 3-Point Lighting
    const hemi = new THREE.HemisphereLight(0xdaf0ff, 0x3b4d82, 1.08);
    scene.add(hemi);

    const keyLight = new THREE.DirectionalLight(0xfff5e4, 1.75);
    keyLight.position.set(3.2, 5.4, 4.2);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.near = 0.5;
    keyLight.shadow.camera.far = 16;
    const d = 1.8;
    keyLight.shadow.camera.left = -d;
    keyLight.shadow.camera.right = d;
    keyLight.shadow.camera.top = d;
    keyLight.shadow.camera.bottom = -d;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.radius = 3;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x8bc8ff, 0.78);
    rimLight.position.set(-3.4, 2.8, -3.5);
    scene.add(rimLight);

    // Playful Cartoon 3D Podium Platform
    const podiumGroup = new THREE.Group();
    const baseGeo = new THREE.CylinderGeometry(0.92, 1.04, 0.18, 36);
    const baseMat = new THREE.MeshStandardMaterial({
      color: preview.podiumColor,
      roughness: 0.55,
      metalness: 0.05,
    });
    const baseMesh = new THREE.Mesh(baseGeo, baseMat);
    baseMesh.position.y = -0.09;
    baseMesh.receiveShadow = true;
    podiumGroup.add(baseMesh);

    const rimGeo = new THREE.CylinderGeometry(0.95, 0.95, 0.045, 36);
    const rimMat = new THREE.MeshStandardMaterial({
      color: preview.badgeColor,
      roughness: 0.42,
      metalness: 0.08,
    });
    const rimMesh = new THREE.Mesh(rimGeo, rimMat);
    rimMesh.position.y = -0.025;
    rimMesh.receiveShadow = true;
    podiumGroup.add(rimMesh);

    const shadowTex = createContactShadowTexture();
    const shadowGeo = new THREE.PlaneGeometry(1.02, 1.02);
    shadowGeo.rotateX(-Math.PI / 2);
    const shadowMat = new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      depthWrite: false,
      opacity: 0.34,
    });
    const contactShadow = new THREE.Mesh(shadowGeo, shadowMat);
    contactShadow.position.y = 0.008;
    podiumGroup.add(contactShadow);
    scene.add(podiumGroup);

    // Actual R16 Character Rig + Live Idle Animator
    const rig = createR16Character(appearance);
    rig.root.rotation.y = Math.PI - preview.initialYaw;
    scene.add(rig.root);

    const animator = new CharacterAnimator(
      rig,
      appearance.archetype ?? 'standard',
      appearance.skinId,
    );
    if (isHela) {
      rig.setHelaHandSwords(true, true);
      animator.setSwordHeld(true);
    }

    const witchAuraVariant =
      appearance.skinId === 'wanda-zombie' ? 'crimson-dark' : 'default';
    const leftHandAura = isWitch ? new HandChaosAura(0.28, witchAuraVariant) : null;
    const rightHandAura = isWitch ? new HandChaosAura(0.28, witchAuraVariant) : null;
    if (leftHandAura) {
      leftHandAura.group.position.set(0, -0.09, -0.06);
      rig.leftHand.add(leftHandAura.group);
    }
    if (rightHandAura) {
      rightHandAura.group.position.set(0, -0.09, -0.06);
      rig.rightHand.add(rightHandAura.group);
    }

    const leftAgathaAura = isAgatha ? new HandAgathaAura(0.28) : null;
    const rightAgathaAura = isAgatha ? new HandAgathaAura(0.28) : null;
    if (leftAgathaAura) {
      leftAgathaAura.group.position.set(0, -0.09, -0.06);
      rig.leftHand.add(leftAgathaAura.group);
    }
    if (rightAgathaAura) {
      rightAgathaAura.group.position.set(0, -0.09, -0.06);
      rig.rightHand.add(rightAgathaAura.group);
    }

    const skinVar = appearance.skinVariant ?? 'phoenix';
    const leftFireAura = isPhoenix ? new HandFireAura(skinVar, 0.27) : null;
    const rightFireAura = isPhoenix ? new HandFireAura(skinVar, 0.27) : null;
    const phoenixWings = isPhoenix ? new PhoenixWings(skinVar) : null;
    if (leftFireAura) {
      leftFireAura.group.position.set(0, -0.09, -0.06);
      rig.leftHand.add(leftFireAura.group);
    }
    if (rightFireAura) {
      rightFireAura.group.position.set(0, -0.09, -0.06);
      rig.rightHand.add(rightFireAura.group);
    }
    if (phoenixWings) {
      rig.chest.add(phoenixWings.group);
    }

    const emmaIdleRings = isEmma ? new EmmaIdleForeheadRings(4) : null;
    if (emmaIdleRings) {
      scene.add(emmaIdleRings.group);
    }

    // Subtle non-obstructive 3D idle preview VFX for Magneto, Quicksilver, Doctor Strange, and Vision
    const extraPreviewDisposables: Array<
      THREE.BufferGeometry | THREE.Material | THREE.Texture
    > = [];
    const makeGlowSpriteTex = (inner: string, mid: string) => {
      const c = document.createElement('canvas');
      c.width = 64;
      c.height = 64;
      const ctx = c.getContext('2d')!;
      const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, inner);
      g.addColorStop(0.42, mid);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 64, 64);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      extraPreviewDisposables.push(t);
      return t;
    };

    const magnetoShards: THREE.Mesh[] = [];
    if (isMagneto) {
      const shardGeo = new THREE.OctahedronGeometry(0.052, 0);
      const shardMat = new THREE.MeshStandardMaterial({
        color: '#9BA6BD',
        metalness: 0.85,
        roughness: 0.22,
        emissive: '#59208F',
        emissiveIntensity: 0.35,
      });
      extraPreviewDisposables.push(shardGeo, shardMat);
      for (let i = 0; i < 3; i++) {
        const s = new THREE.Mesh(shardGeo, shardMat);
        s.scale.set(0.75, 1.35, 0.55);
        scene.add(s);
        magnetoShards.push(s);
      }
    }

    const qsSparks: THREE.Sprite[] = [];
    if (isQuicksilver) {
      const tex = makeGlowSpriteTex(
        'rgba(220,255,240,0.95)',
        'rgba(60,255,155,0.52)',
      );
      const spMat = new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      extraPreviewDisposables.push(spMat);
      for (let i = 0; i < 6; i++) {
        const sp = new THREE.Sprite(spMat);
        sp.scale.setScalar(0.14);
        scene.add(sp);
        qsSparks.push(sp);
      }
    }

    let strangeMandala: THREE.Mesh | null = null;
    if (isStrange) {
      const c = document.createElement('canvas');
      c.width = 128;
      c.height = 128;
      const ctx = c.getContext('2d')!;
      ctx.translate(64, 64);
      ctx.strokeStyle = 'rgba(255, 165, 55, 0.88)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, 52, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 38, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 4;
        ctx.rect(-26, -26, 52, 52);
        ctx.rotate(a);
      }
      ctx.stroke();
      const mTex = new THREE.CanvasTexture(c);
      mTex.colorSpace = THREE.SRGBColorSpace;
      const mGeo = new THREE.PlaneGeometry(0.32, 0.32);
      const mMat = new THREE.MeshBasicMaterial({
        map: mTex,
        transparent: true,
        opacity: 0.72,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      extraPreviewDisposables.push(mTex, mGeo, mMat);
      strangeMandala = new THREE.Mesh(mGeo, mMat);
      strangeMandala.position.set(0.02, -0.06, -0.14);
      rig.rightHand.add(strangeMandala);
    }

    let visionHalo: THREE.Sprite | null = null;
    if (isVision) {
      const vTex = makeGlowSpriteTex(
        'rgba(255,250,200,0.92)',
        'rgba(255,210,45,0.42)',
      );
      const vMat = new THREE.SpriteMaterial({
        map: vTex,
        transparent: true,
        opacity: 0.72,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      extraPreviewDisposables.push(vMat);
      visionHalo = new THREE.Sprite(vMat);
      visionHalo.scale.setScalar(0.18);
      scene.add(visionHalo);
    }

    spinStateRef.current.userYaw = 0;

    const handleResize = () => {
      const w = Math.max(container.clientWidth, 1);
      const h = Math.max(container.clientHeight, 1);
      updatePreviewCamera(w, h);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(w, h);
    };

    const ro =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(handleResize) : null;
    ro?.observe(container);
    window.addEventListener('resize', handleResize);

    let rafId = 0;
    let lastMs = performance.now();
    let elapsed = 0;
    let disposed = false;

    const idleInput = {
      localForward: 0,
      localRight: 0,
      verticalVelocity: 0,
      grounded: true,
      justJumped: false,
      landImpactSpeed: 0,
      previewMode: true,
    };

    const foreheadPos = new THREE.Vector3();
    const foreheadDir = new THREE.Vector3();

    const renderLoop = () => {
      if (disposed) return;
      const now = performance.now();
      const dt = Math.min(Math.max((now - lastMs) / 1000, 0.001), 0.05);
      lastMs = now;
      elapsed += dt;

      animator.update(dt, idleInput);
      leftHandAura?.update(dt, 0.92 + Math.sin(elapsed * 2.2) * 0.12, 0.28);
      rightHandAura?.update(dt, 1.0 + Math.cos(elapsed * 2.0) * 0.12, 0.28);
      leftAgathaAura?.update(dt, 0.92 + Math.sin(elapsed * 2.2) * 0.12, 0.28);
      rightAgathaAura?.update(dt, 1.0 + Math.cos(elapsed * 2.0) * 0.12, 0.28);

      leftFireAura?.update(dt, 0.92 + Math.sin(elapsed * 2.4) * 0.14, 0.27);
      rightFireAura?.update(dt, 1.0 + Math.cos(elapsed * 2.1) * 0.14, 0.27);
      phoenixWings?.update(dt, true, false, 0.25);

      const autoSway = spinStateRef.current.dragging
        ? 0
        : Math.sin(elapsed * 0.85) * 0.22;
      rig.root.rotation.y =
        Math.PI -
        preview.initialYaw +
        spinStateRef.current.userYaw +
        autoSway;

      podiumGroup.position.y = Math.sin(elapsed * 1.4) * 0.018;
      rig.root.position.y = podiumGroup.position.y;

      if (emmaIdleRings) {
        rig.root.updateMatrixWorld(true);
        foreheadPos.set(0, 0.3, -0.25).applyMatrix4(rig.head.matrixWorld);
        foreheadDir
          .set(0, 0.32, -1.25)
          .applyMatrix4(rig.head.matrixWorld)
          .sub(foreheadPos)
          .normalize();
        emmaIdleRings.update(dt, true, foreheadPos, foreheadDir);
      }

      if (magnetoShards.length > 0) {
        for (let i = 0; i < magnetoShards.length; i++) {
          const ang = elapsed * 1.35 + (i * Math.PI * 2) / magnetoShards.length;
          const m = magnetoShards[i];
          m.position.set(
            Math.cos(ang) * 0.56,
            0.86 + Math.sin(elapsed * 2.1 + i * 1.7) * 0.16 + podiumGroup.position.y,
            Math.sin(ang) * 0.56,
          );
          m.rotation.set(elapsed * 1.4 + i, elapsed * 1.9, i);
        }
      }

      if (qsSparks.length > 0) {
        for (let i = 0; i < qsSparks.length; i++) {
          const ang = elapsed * 4.8 + i * 1.05;
          const sp = qsSparks[i];
          const rad = 0.34 + (i % 2) * 0.14;
          sp.position.set(
            Math.cos(ang) * rad,
            0.22 + ((i * 0.25 + elapsed * 0.55) % 1.45),
            Math.sin(ang) * rad,
          );
          const sc = 0.09 + Math.sin(elapsed * 9 + i) * 0.035;
          sp.scale.setScalar(sc);
        }
      }

      if (strangeMandala) {
        strangeMandala.rotation.z = elapsed * 1.2;
        const sc = 0.92 + Math.sin(elapsed * 2.8) * 0.08;
        strangeMandala.scale.setScalar(sc);
      }

      if (visionHalo && rig.mindStone) {
        rig.root.updateMatrixWorld(true);
        rig.mindStone.getWorldPosition(foreheadPos);
        visionHalo.position.copy(foreheadPos);
        const pulse = 0.16 + Math.sin(elapsed * 3.1) * 0.04;
        visionHalo.scale.setScalar(pulse);
      }

      renderer.render(scene, camera);
      rafId = requestAnimationFrame(renderLoop);
    };

    rafId = requestAnimationFrame(renderLoop);

    return () => {
      disposed = true;
      cancelAnimationFrame(rafId);
      ro?.disconnect();
      window.removeEventListener('resize', handleResize);

      leftHandAura?.dispose();
      rightHandAura?.dispose();
      leftAgathaAura?.dispose();
      rightAgathaAura?.dispose();
      leftFireAura?.dispose();
      rightFireAura?.dispose();
      phoenixWings?.dispose();
      emmaIdleRings?.dispose();
      extraPreviewDisposables.forEach((d) => d.dispose());
      rig.dispose();
      baseGeo.dispose();
      baseMat.dispose();
      rimGeo.dispose();
      rimMat.dispose();
      shadowGeo.dispose();
      shadowMat.dispose();
      shadowTex.dispose();
      envRT.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [character, skinId]);

  return (
    <div
      ref={mountRef}
      className="h-full w-full cursor-grab active:cursor-grabbing"
      style={{ touchAction: 'none' }}
      onPointerDown={(e) => {
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        spinStateRef.current.dragging = true;
        spinStateRef.current.pointerId = e.pointerId;
        spinStateRef.current.lastX = forcedLandscape ? e.clientY : e.clientX;
      }}
      onPointerMove={(e) => {
        if (
          !spinStateRef.current.dragging ||
          spinStateRef.current.pointerId !== e.pointerId
        ) {
          return;
        }
        e.stopPropagation();
        const currX = forcedLandscape ? e.clientY : e.clientX;
        const dx = currX - spinStateRef.current.lastX;
        spinStateRef.current.lastX = currX;
        spinStateRef.current.userYaw += dx * 0.012;
      }}
      onPointerUp={(e) => {
        if (spinStateRef.current.pointerId === e.pointerId) {
          spinStateRef.current.dragging = false;
          spinStateRef.current.pointerId = null;
        }
      }}
      onPointerCancel={(e) => {
        if (spinStateRef.current.pointerId === e.pointerId) {
          spinStateRef.current.dragging = false;
          spinStateRef.current.pointerId = null;
        }
      }}
    />
  );
}
