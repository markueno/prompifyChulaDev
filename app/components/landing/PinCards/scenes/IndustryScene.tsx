'use client'

import { useRef, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Text, RoundedBox } from '@react-three/drei'
import * as THREE from 'three'

interface SceneProps {
  isActive: boolean
}

const ICONS = [
  { color: '#10b981', angle: 0, label: 'Healthcare' },
  { color: '#3b82f6', angle: (2 * Math.PI) / 5, label: 'Finance' },
  { color: '#8b5cf6', angle: (4 * Math.PI) / 5, label: 'Retail' },
  { color: '#06b6d4', angle: (6 * Math.PI) / 5, label: 'Education' },
  { color: '#f59e0b', angle: (8 * Math.PI) / 5, label: 'Tech' },
]

export default function IndustryScene({ isActive }: SceneProps) {
  const ringRef = useRef<THREE.Mesh>(null!)
  const pulseRef = useRef<THREE.Group>(null!)
  const centerRef = useRef<THREE.Mesh>(null!)
  const iconRefs = useRef<(THREE.Group | null)[]>([])
  const sceneGroupRef = useRef<THREE.Group>(null!)

  const timeRef = useRef(0)
  const ringScale = useRef(0)
  const iconScales = useRef(ICONS.map(() => 0))

  // Set camera angle
  const { camera } = useThree()
  useMemo(() => {
    camera.position.set(0, 4, 7)
    camera.lookAt(0, 0, 0)
  }, [camera])

  useFrame((_, delta) => {
    if (isActive) timeRef.current += delta * 0.8

    const time = timeRef.current

    // Ring scale
    const ringTarget = isActive ? 1 : 0
    ringScale.current += (ringTarget - ringScale.current) * delta * 2
    if (ringRef.current) {
      ringRef.current.scale.setScalar(ringScale.current)
    }

    // Center dot
    if (centerRef.current) {
      const s = isActive ? 0.95 + Math.sin(time * 2) * 0.05 : 0
      centerRef.current.scale.setScalar(
        centerRef.current.scale.x + (s - centerRef.current.scale.x) * delta * 3
      )
    }

    // Orbiting pulse
    if (pulseRef.current) {
      const px = 3 * Math.cos(time)
      const pz = 3 * Math.sin(time)
      pulseRef.current.position.set(px, 0, pz)
      const targetS = isActive ? 1 : 0
      pulseRef.current.scale.setScalar(
        pulseRef.current.scale.x + (targetS - pulseRef.current.scale.x) * delta * 3
      )
    }

    // Icons
    ICONS.forEach((icon, i) => {
      const ref = iconRefs.current[i]
      if (!ref) return

      // Scale in with stagger
      const staggerTarget = isActive && timeRef.current > i * 0.25 ? 1 : 0
      iconScales.current[i] += (staggerTarget - iconScales.current[i]) * delta * 3
      ref.scale.setScalar(iconScales.current[i])

      // Position on ring
      const x = 3 * Math.cos(icon.angle)
      const z = 3 * Math.sin(icon.angle)
      const yBob = isActive ? Math.sin(time * 1.5 + i) * 0.15 : 0
      ref.position.set(x, yBob, z)

      // Slow rotation
      ref.rotation.y += delta * 0.3

      // Proximity to pulse - scale bump
      if (pulseRef.current && isActive) {
        const dist = ref.position.distanceTo(pulseRef.current.position)
        if (dist < 1.0) {
          const bump = 1 + (1 - dist) * 0.3
          ref.scale.setScalar(iconScales.current[i] * bump)
        }
      }
    })
  })

  return (
    <>
      <ambientLight intensity={0.3} />

      {/* Orbital ring */}
      <mesh ref={ringRef} rotation={[Math.PI / 2, 0, 0]} scale={0}>
        <torusGeometry args={[3, 0.03, 8, 64]} />
        <meshBasicMaterial color="#ff6b00" transparent opacity={0.6} />
      </mesh>

      {/* Center dot */}
      <mesh ref={centerRef} scale={0}>
        <sphereGeometry args={[0.2, 12, 12]} />
        <meshBasicMaterial color="#ff6b00" />
      </mesh>

      {/* Orbiting pulse */}
      <group ref={pulseRef} scale={0}>
        <mesh>
          <sphereGeometry args={[0.15, 12, 12]} />
          <meshBasicMaterial color="#ff6b00" />
        </mesh>
        <mesh>
          <sphereGeometry args={[0.4, 12, 12]} />
          <meshBasicMaterial color="#ff6b00" transparent opacity={0.2} />
        </mesh>
      </group>

      {/* Industry icons */}
      {ICONS.map((icon, i) => (
        <group key={i} ref={(el) => { iconRefs.current[i] = el }} scale={0}>
          {i === 0 && ( // Healthcare - cross
            <group>
              <mesh><boxGeometry args={[0.15, 0.6, 0.1]} /><meshBasicMaterial color={icon.color} /></mesh>
              <mesh><boxGeometry args={[0.6, 0.15, 0.1]} /><meshBasicMaterial color={icon.color} /></mesh>
            </group>
          )}
          {i === 1 && ( // Finance - bars
            <group>
              {[0.4, 0.7, 0.5].map((h, j) => (
                <mesh key={j} position={[(j - 1) * 0.2, (h - 0.7) / 2, 0]}>
                  <boxGeometry args={[0.1, h, 0.1]} />
                  <meshBasicMaterial color={icon.color} />
                </mesh>
              ))}
            </group>
          )}
          {i === 2 && ( // Retail - bag
            <group>
              <RoundedBox args={[0.4, 0.5, 0.2]} radius={0.05}>
                <meshBasicMaterial color={icon.color} />
              </RoundedBox>
              <mesh position={[0, 0.32, 0]}>
                <torusGeometry args={[0.12, 0.03, 8, 12]} />
                <meshBasicMaterial color={icon.color} />
              </mesh>
            </group>
          )}
          {i === 3 && ( // Education - cap
            <group>
              <mesh><boxGeometry args={[0.6, 0.05, 0.6]} /><meshBasicMaterial color={icon.color} /></mesh>
              <mesh position={[0, 0.1, 0]}><boxGeometry args={[0.15, 0.15, 0.15]} /><meshBasicMaterial color={icon.color} /></mesh>
            </group>
          )}
          {i === 4 && ( // Tech - code
            <Text fontSize={0.4} color={icon.color} anchorX="center" anchorY="middle">
              {'</>'}
            </Text>
          )}
          <Text
            position={[0, -0.6, 0]}
            fontSize={0.15}
            color="#ffffff"
            anchorX="center"
            anchorY="middle"
          >
            {icon.label}
          </Text>
        </group>
      ))}
    </>
  )
}
