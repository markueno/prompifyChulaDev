'use client'

import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { Text } from '@react-three/drei'
import * as THREE from 'three'

interface SceneProps {
  isActive: boolean
}

const STAGES = [
  'SSO Integration',
  'API Configuration',
  'Compliance Check',
  'Load Testing',
  'Deploy',
]

const NODE_Y = [2.5, 1.25, 0, -1.25, -2.5]
const BURST_POOL = 40

export default function DeploymentScene({ isActive }: SceneProps) {
  const nodeRefs = useRef<(THREE.Mesh | null)[]>([])
  const nodeMaterialRefs = useRef<(THREE.MeshBasicMaterial | null)[]>([])
  const checkRefs = useRef<(THREE.Group | null)[]>([])
  const labelRefs = useRef<(any | null)[]>([])
  const progressLineRef = useRef<THREE.Mesh>(null!)
  const bgLineRef = useRef<THREE.Mesh>(null!)
  const burstRefs = useRef<(THREE.Mesh | null)[]>([])

  const hasStarted = useRef(false)
  const startTime = useRef(0)
  const activatedStages = useRef<boolean[]>(STAGES.map(() => false))
  const nodePopScale = useRef<number[]>(STAGES.map(() => 0.3))
  const checkScale = useRef<number[]>(STAGES.map(() => 0))

  // Burst particle state
  const burstState = useMemo(() => {
    return Array.from({ length: BURST_POOL }, () => ({
      active: false,
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      life: 0,
    }))
  }, [])

  useFrame((_, delta) => {
    if (isActive && !hasStarted.current) {
      hasStarted.current = true
      startTime.current = performance.now() / 1000
      activatedStages.current = STAGES.map(() => false)
      nodePopScale.current = STAGES.map(() => 0.3)
      checkScale.current = STAGES.map(() => 0)
    }

    if (!hasStarted.current) {
      // Inactive state - everything gray and small
      nodeRefs.current.forEach((node, i) => {
        if (node) {
          node.scale.setScalar(0.3)
        }
        const mat = nodeMaterialRefs.current[i]
        if (mat) mat.color.set('#231710')
      })
      if (progressLineRef.current) progressLineRef.current.scale.y = 0
      return
    }

    if (!isActive) return

    const elapsed = performance.now() / 1000 - startTime.current

    // Activate stages sequentially
    for (let i = 0; i < STAGES.length; i++) {
      const triggerTime = 0.8 + i * 1.0

      if (elapsed >= triggerTime && !activatedStages.current[i]) {
        activatedStages.current[i] = true
        nodePopScale.current[i] = 1.5 // pop overshoot

        // Spawn burst particles
        for (let j = 0; j < 6; j++) {
          const slot = burstState.find(b => !b.active)
          if (slot) {
            slot.active = true
            slot.pos.set(0, NODE_Y[i], 0)
            slot.vel.set(
              (Math.random() - 0.5) * 2,
              (Math.random() - 0.5) * 2,
              (Math.random() - 0.5) * 2,
            ).normalize().multiplyScalar(1.5)
            slot.life = 1
          }
        }
      }

      // Node scale animation
      const node = nodeRefs.current[i]
      const mat = nodeMaterialRefs.current[i]

      if (node) {
        if (activatedStages.current[i]) {
          // Settle from pop to 1.0
          nodePopScale.current[i] += (1.0 - nodePopScale.current[i]) * delta * 5
          node.scale.setScalar(nodePopScale.current[i])
        } else {
          node.scale.setScalar(0.3 + (1.0 - 0.3) * Math.max(0, Math.min(1, (elapsed - 0) / 0.8)))
        }
      }

      if (mat) {
        if (activatedStages.current[i]) {
          mat.color.lerp(new THREE.Color('#10b981'), delta * 5)
        } else {
          mat.color.set('#231710')
        }
      }

      // Checkmark scale
      const check = checkRefs.current[i]
      if (check) {
        const targetCheck = activatedStages.current[i] ? 1.0 : 0
        checkScale.current[i] += (targetCheck - checkScale.current[i]) * delta * 6
        // Overshoot on activation
        if (activatedStages.current[i] && checkScale.current[i] < 0.95) {
          const overshoot = 1 + (1 - checkScale.current[i]) * 0.3
          check.scale.setScalar(checkScale.current[i] * overshoot)
        } else {
          check.scale.setScalar(checkScale.current[i])
        }
      }
    }

    // Progress line
    if (progressLineRef.current) {
      const progress = Math.min(Math.max((elapsed - 0.8) / 4.0, 0), 1)
      progressLineRef.current.scale.y = progress
      progressLineRef.current.position.y = 2.5 - 2.5 * progress
    }

    // Final pulse
    if (elapsed > 5.5 && elapsed < 6.2) {
      const pulseT = (elapsed - 5.5) / 0.7
      const pulse = 1.0 + 0.2 * Math.sin(pulseT * Math.PI)
      STAGES.forEach((_, i) => {
        if (activatedStages.current[i]) {
          const node = nodeRefs.current[i]
          if (node) node.scale.setScalar(pulse)
        }
      })
    }

    // Burst particles
    burstState.forEach((b, i) => {
      const mesh = burstRefs.current[i]
      if (!mesh) return

      if (!b.active) {
        mesh.visible = false
        return
      }

      mesh.visible = true
      b.pos.add(b.vel.clone().multiplyScalar(delta))
      b.life -= delta * 2.5
      mesh.position.copy(b.pos)
      mesh.scale.setScalar(Math.max(b.life * 0.5, 0.01))

      const mat = mesh.material as THREE.MeshBasicMaterial
      mat.opacity = Math.max(b.life, 0)

      if (b.life <= 0) {
        b.active = false
        mesh.visible = false
      }
    })
  })

  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[3, 3, 5]} intensity={0.4} />

      {/* Background line */}
      <mesh ref={bgLineRef} position={[0, 0, -0.1]}>
        <cylinderGeometry args={[0.03, 0.03, 5, 8]} />
        <meshBasicMaterial color="#231710" />
      </mesh>

      {/* Progress line (green, grows) */}
      <mesh ref={progressLineRef} position={[0, 2.5, 0]} scale={[1, 0, 1]}>
        <cylinderGeometry args={[0.04, 0.04, 5, 8]} />
        <meshBasicMaterial color="#10b981" />
      </mesh>

      {/* Nodes and labels */}
      {STAGES.map((stage, i) => (
        <group key={i}>
          <mesh
            ref={(el) => { nodeRefs.current[i] = el }}
            position={[0, NODE_Y[i], 0]}
            scale={0.3}
          >
            <sphereGeometry args={[0.25, 16, 16]} />
            <meshBasicMaterial
              ref={(el) => { nodeMaterialRefs.current[i] = el }}
              color="#231710"
            />
          </mesh>

          <Text
            position={[0.8, NODE_Y[i], 0]}
            fontSize={0.18}
            color="#999999"
            anchorX="left"
            anchorY="middle"
          >
            {stage}
          </Text>

          {/* Checkmark */}
          <group
            ref={(el) => { checkRefs.current[i] = el }}
            position={[-0.6, NODE_Y[i], 0]}
            scale={0}
          >
            <Text
              fontSize={0.3}
              color="#10b981"
              anchorX="center"
              anchorY="middle"
            >
              ✓
            </Text>
          </group>
        </group>
      ))}

      {/* Burst particle pool */}
      {Array.from({ length: BURST_POOL }).map((_, i) => (
        <mesh
          key={`burst-${i}`}
          ref={(el) => { burstRefs.current[i] = el }}
          visible={false}
        >
          <sphereGeometry args={[0.04, 6, 6]} />
          <meshBasicMaterial color="#10b981" transparent opacity={1} />
        </mesh>
      ))}
    </>
  )
}
