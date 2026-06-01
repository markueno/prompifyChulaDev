'use client'

import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

interface SceneProps {
  isActive: boolean
}

const CHARS = '0123456789ABCDEF#$%&@'
const BAR_COLORS = ['#ff6b00', '#3b82f6', '#10b981', '#8b5cf6', '#f59e0b']
const BAR_HEIGHTS = [1.0, 2.0, 1.5, 2.5, 1.8]
const COLS = [-4, -3.5, -3, -2.5]
const ROWS_PER_COL = 8

export default function DataFlowScene({ isActive }: SceneProps) {
  const prismRef = useRef<THREE.Mesh>(null!)
  const glowRef = useRef<THREE.Mesh>(null!)
  const charRefs = useRef<(THREE.Mesh | null)[]>([])
  const barRefs = useRef<(THREE.Mesh | null)[]>([])
  const leftParticleRefs = useRef<(THREE.Mesh | null)[]>([])
  const rightParticleRefs = useRef<(THREE.Mesh | null)[]>([])

  const hasStarted = useRef(false)
  const activationTime = useRef(0)

  // Character grid data
  const charData = useMemo(() => {
    const data: { x: number; baseY: number; speed: number }[] = []
    for (let ci = 0; ci < COLS.length; ci++) {
      for (let ri = 0; ri < ROWS_PER_COL; ri++) {
        data.push({
          x: COLS[ci],
          baseY: 3 - ri * 0.8,
          speed: 0.5 + Math.random() * 1.0,
        })
      }
    }
    return data
  }, [])

  const charOffsets = useRef<number[]>(charData.map((_, i) => i * 0.3))

  // Flow particles data
  const leftParticles = useMemo(() =>
    Array.from({ length: 10 }, () => ({
      y: (Math.random() - 0.5) * 2,
      speed: 0.4 + Math.random() * 0.5,
    })), [])

  const rightParticles = useMemo(() =>
    Array.from({ length: 10 }, () => ({
      y: (Math.random() - 0.5) * 2,
      speed: 0.4 + Math.random() * 0.5,
      color: BAR_COLORS[Math.floor(Math.random() * BAR_COLORS.length)],
    })), [])

  const leftTs = useRef<number[]>(leftParticles.map((_, i) => i / leftParticles.length))
  const rightTs = useRef<number[]>(rightParticles.map((_, i) => i / rightParticles.length))
  const barScales = useRef<number[]>(BAR_HEIGHTS.map(() => 0))

  useFrame((_, delta) => {
    if (isActive && !hasStarted.current) {
      hasStarted.current = true
      activationTime.current = 0
    }
    if (isActive) activationTime.current += delta
    if (!isActive) hasStarted.current = false

    // Prism rotation
    if (prismRef.current) {
      prismRef.current.rotation.y += delta * 0.3
      prismRef.current.rotation.x += delta * 0.1

      const targetScale = isActive ? 1 : 0.5
      const s = prismRef.current.scale.x
      prismRef.current.scale.setScalar(s + (targetScale - s) * delta * 2)
    }
    if (glowRef.current) {
      glowRef.current.rotation.y = prismRef.current?.rotation.y || 0
      glowRef.current.rotation.x = prismRef.current?.rotation.x || 0
    }

    // Character scrolling
    charData.forEach((c, i) => {
      const mesh = charRefs.current[i]
      if (!mesh) return

      if (hasStarted.current) {
        charOffsets.current[i] -= c.speed * delta
        if (charOffsets.current[i] < -4) charOffsets.current[i] = 4
      }

      mesh.position.set(c.x, c.baseY + charOffsets.current[i] - 3, 0)

      // Fade based on vertical position
      const mat = mesh.material as THREE.MeshBasicMaterial
      const yPos = mesh.position.y
      mat.opacity = Math.max(0, Math.min(1, 1 - Math.abs(yPos) / 4)) * 0.4
    })

    // Bar growth
    BAR_HEIGHTS.forEach((h, i) => {
      if (isActive) {
        const stagger = i * 0.15
        if (activationTime.current > 0.5 + stagger) {
          barScales.current[i] = Math.min(barScales.current[i] + delta * 1.8, 1)
        }
      } else {
        barScales.current[i] = 0
      }

      const bar = barRefs.current[i]
      if (bar) {
        bar.scale.y = barScales.current[i]
        bar.position.y = -1.5 + (h * barScales.current[i]) / 2
      }
    })

    // Left particles (raw data flowing to prism)
    leftParticles.forEach((p, i) => {
      if (hasStarted.current) {
        leftTs.current[i] += p.speed * delta
        if (leftTs.current[i] >= 1) leftTs.current[i] = 0
      }

      const mesh = leftParticleRefs.current[i]
      if (mesh) {
        const t = leftTs.current[i]
        mesh.position.set(-2 + t * 2, p.y * (1 - t), 0)
        mesh.scale.setScalar(isActive ? (1 - t) : 0) // Shrink as approaches center
      }
    })

    // Right particles (insights flowing to bars)
    rightParticles.forEach((p, i) => {
      if (hasStarted.current) {
        rightTs.current[i] += p.speed * delta
        if (rightTs.current[i] >= 1) rightTs.current[i] = 0
      }

      const mesh = rightParticleRefs.current[i]
      if (mesh) {
        const t = rightTs.current[i]
        mesh.position.set(0.5 + t * 2, p.y * (1 - t * 0.5), 0)
        mesh.scale.setScalar(isActive ? t : 0) // Grow as moves away from center
      }
    })
  })

  return (
    <>
      <ambientLight intensity={0.4} />
      <pointLight position={[0, 0, 3]} intensity={0.5} color="#ff6b00" />

      {/* Raw data characters (left side) */}
      {charData.map((_, i) => (
        <mesh
          key={`char-${i}`}
          ref={(el) => { charRefs.current[i] = el }}
        >
          <planeGeometry args={[0.18, 0.25]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.3} />
        </mesh>
      ))}

      {/* Prism */}
      <mesh ref={prismRef} scale={0.5}>
        <octahedronGeometry args={[1.2, 0]} />
        <meshPhysicalMaterial
          color="#231710"
          roughness={0.1}
          metalness={0.3}
          transparent
          opacity={0.7}
          emissive="#ff6b00"
          emissiveIntensity={0.3}
        />
      </mesh>
      <mesh ref={glowRef} scale={0.65}>
        <octahedronGeometry args={[1.2, 0]} />
        <meshBasicMaterial color="#ff6b00" transparent opacity={0.08} />
      </mesh>

      {/* Output bars (right side) */}
      {BAR_HEIGHTS.map((h, i) => (
        <mesh
          key={`bar-${i}`}
          ref={(el) => { barRefs.current[i] = el }}
          position={[2.2 + i * 0.5, -1.5, 0]}
          scale={[1, 0, 1]}
        >
          <boxGeometry args={[0.3, h, 0.1]} />
          <meshBasicMaterial color={BAR_COLORS[i]} />
        </mesh>
      ))}

      {/* Left flow particles */}
      {leftParticles.map((_, i) => (
        <mesh
          key={`lp-${i}`}
          ref={(el) => { leftParticleRefs.current[i] = el }}
          scale={0}
        >
          <sphereGeometry args={[0.05, 6, 6]} />
          <meshBasicMaterial color="#aaaaaa" />
        </mesh>
      ))}

      {/* Right flow particles */}
      {rightParticles.map((p, i) => (
        <mesh
          key={`rp-${i}`}
          ref={(el) => { rightParticleRefs.current[i] = el }}
          scale={0}
        >
          <sphereGeometry args={[0.05, 6, 6]} />
          <meshBasicMaterial color={p.color} />
        </mesh>
      ))}
    </>
  )
}
