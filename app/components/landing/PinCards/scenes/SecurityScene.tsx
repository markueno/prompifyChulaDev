'use client'

import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { RoundedBox } from '@react-three/drei'
import * as THREE from 'three'

interface SceneProps {
  isActive: boolean
}

const PARTICLE_COUNT = 20
const MAX_THREATS = 3
const THREAT_POOL_SIZE = 6
const PARTICLE_COLORS = ['#ff6b00', '#fbbf24', '#ffffff']

export default function SecurityScene({ isActive }: SceneProps) {
  const domeRef = useRef<THREE.Mesh>(null!)
  const lockGroupRef = useRef<THREE.Group>(null!)
  const particleRefs = useRef<(THREE.Mesh | null)[]>([])
  const threatRefs = useRef<(THREE.Mesh | null)[]>([])

  const hasStarted = useRef(false)
  const spawnTimer = useRef(0)
  const activationTime = useRef(0)

  // Particle state
  const particleState = useMemo(() => {
    return Array.from({ length: PARTICLE_COUNT }, () => {
      const theta = Math.random() * Math.PI * 2
      const phi = Math.acos(2 * Math.random() - 1)
      const r = Math.random() * 1.8
      return {
        pos: new THREE.Vector3(
          r * Math.sin(phi) * Math.cos(theta),
          r * Math.sin(phi) * Math.sin(theta),
          r * Math.cos(phi)
        ),
        vel: new THREE.Vector3(
          (Math.random() - 0.5),
          (Math.random() - 0.5),
          (Math.random() - 0.5),
        ).normalize().multiplyScalar(0.3),
      }
    })
  }, [])

  // Threat state
  const threatState = useMemo(() => {
    return Array.from({ length: THREAT_POOL_SIZE }, () => ({
      active: false,
      pos: new THREE.Vector3(),
      dir: new THREE.Vector3(),
      shrinking: false,
      scale: 1,
      life: 0,
    }))
  }, [])

  const domeFlash = useRef(0)

  useFrame((_, delta) => {
    if (isActive && !hasStarted.current) {
      hasStarted.current = true
      activationTime.current = 0
    }
    if (isActive) activationTime.current += delta

    // Dome
    if (domeRef.current) {
      domeRef.current.rotation.y += delta * 0.1
      domeRef.current.rotation.x += delta * 0.05

      const mat = domeRef.current.material as THREE.MeshBasicMaterial
      const baseOpacity = isActive ? (0.2 + Math.sin(performance.now() * 0.002) * 0.075) : 0
      const flashBonus = domeFlash.current > 0 ? 0.4 : 0
      mat.opacity += (baseOpacity + flashBonus - mat.opacity) * delta * 4

      if (domeFlash.current > 0) domeFlash.current -= delta
    }

    // Lock rotation
    if (lockGroupRef.current) {
      lockGroupRef.current.rotation.y += delta * 0.2
      const targetScale = isActive ? 1 : 0
      const s = lockGroupRef.current.scale.x
      lockGroupRef.current.scale.setScalar(s + (targetScale - s) * delta * 3)
    }

    // Particles - bounce inside dome
    const speed = isActive ? 1 : 0.05
    particleState.forEach((p, i) => {
      p.pos.add(p.vel.clone().multiplyScalar(delta * speed))
      if (p.pos.length() > 2.2) {
        p.vel.reflect(p.pos.clone().normalize())
        p.pos.clampLength(0, 2.2)
      }

      const mesh = particleRefs.current[i]
      if (mesh) {
        mesh.position.copy(p.pos)
        const targetScale = isActive ? 1 : 0
        mesh.scale.setScalar(mesh.scale.x + (targetScale - mesh.scale.x) * delta * 3)
      }
    })

    // Threat spawning
    if (isActive && activationTime.current > 1.5) {
      spawnTimer.current += delta
      if (spawnTimer.current > 2.5) {
        spawnTimer.current = 0
        const activeCount = threatState.filter(t => t.active).length
        if (activeCount < MAX_THREATS) {
          const slot = threatState.find(t => !t.active)
          if (slot) {
            const spawnDir = new THREE.Vector3(
              (Math.random() - 0.5) * 2,
              (Math.random() - 0.5) * 2,
              (Math.random() - 0.5) * 2,
            ).normalize()
            slot.pos.copy(spawnDir.clone().multiplyScalar(5))
            slot.dir.copy(spawnDir.negate())
            slot.active = true
            slot.shrinking = false
            slot.scale = 1
            slot.life = 1
          }
        }
      }
    }

    // Threat movement
    threatState.forEach((t, i) => {
      const mesh = threatRefs.current[i]
      if (!mesh) return

      if (!t.active) {
        mesh.visible = false
        return
      }

      mesh.visible = true

      if (t.shrinking) {
        t.scale -= delta * 4
        t.life -= delta * 4
        mesh.scale.setScalar(Math.max(t.scale, 0.01))
        const mat = mesh.material as THREE.MeshBasicMaterial
        mat.opacity = Math.max(t.life, 0)
        if (t.scale <= 0) {
          t.active = false
        }
      } else {
        t.pos.add(t.dir.clone().multiplyScalar(1.5 * delta))
        mesh.position.copy(t.pos)
        mesh.lookAt(0, 0, 0)
        mesh.scale.setScalar(1)

        if (t.pos.length() < 2.5) {
          t.shrinking = true
          domeFlash.current = 0.3
        }
      }
    })
  })

  return (
    <>
      <ambientLight intensity={0.2} />
      <pointLight position={[0, 0, 0]} intensity={0.3} color="#06b6d4" distance={4} />

      {/* Shield dome */}
      <mesh ref={domeRef}>
        <icosahedronGeometry args={[2.5, 1]} />
        <meshBasicMaterial wireframe color="#06b6d4" transparent opacity={0} />
      </mesh>

      {/* Interior particles */}
      {particleState.map((p, i) => (
        <mesh
          key={i}
          ref={(el) => { particleRefs.current[i] = el }}
          position={p.pos}
          scale={0}
        >
          <sphereGeometry args={[0.06, 6, 6]} />
          <meshBasicMaterial color={PARTICLE_COLORS[i % PARTICLE_COLORS.length]} />
        </mesh>
      ))}

      {/* Lock */}
      <group ref={lockGroupRef} scale={0}>
        <RoundedBox args={[0.8, 0.7, 0.3]} radius={0.1}>
          <meshPhysicalMaterial color="#fbbf24" metalness={0.8} roughness={0.2} />
        </RoundedBox>
        <mesh position={[0, 0.4, 0]} rotation={[0, 0, 0]}>
          <torusGeometry args={[0.25, 0.06, 8, 20, Math.PI]} />
          <meshPhysicalMaterial color="#fbbf24" metalness={0.8} roughness={0.2} />
        </mesh>
      </group>

      {/* Threat pool */}
      {Array.from({ length: THREAT_POOL_SIZE }).map((_, i) => (
        <mesh
          key={`threat-${i}`}
          ref={(el) => { threatRefs.current[i] = el }}
          visible={false}
        >
          <coneGeometry args={[0.15, 0.5, 6]} />
          <meshBasicMaterial color="#ef4444" transparent opacity={1} />
        </mesh>
      ))}
    </>
  )
}
