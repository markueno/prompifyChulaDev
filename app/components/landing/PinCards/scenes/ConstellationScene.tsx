'use client'

import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { Text } from '@react-three/drei'
import * as THREE from 'three'

interface SceneProps {
  isActive: boolean
}

const NODES = [
  { label: 'G', color: '#10b981', radius: 3.0, speed: 0.3, yOffset: 0.5, angleOffset: 0 },
  { label: 'O', color: '#3b82f6', radius: 3.5, speed: 0.2, yOffset: -0.3, angleOffset: Math.PI * 0.4 },
  { label: 'C', color: '#8b5cf6', radius: 2.8, speed: 0.35, yOffset: 0.8, angleOffset: Math.PI * 0.8 },
  { label: 'D', color: '#06b6d4', radius: 3.2, speed: 0.25, yOffset: -0.6, angleOffset: Math.PI * 1.2 },
  { label: 'M', color: '#ef4444', radius: 3.8, speed: 0.15, yOffset: 0.2, angleOffset: Math.PI * 1.6 },
]

const PARTICLES_PER_NODE = 3

export default function ConstellationScene({ isActive }: SceneProps) {
  const centerRef = useRef<THREE.Mesh>(null!)
  const glowRef = useRef<THREE.Mesh>(null!)
  const nodeGroupRefs = useRef<(THREE.Group | null)[]>([])
  const lineRefs = useRef<(THREE.Line | null)[]>([])
  const particleRefs = useRef<(THREE.Mesh | null)[]>([])
  const timeRef = useRef(0)
  const nodeScales = useRef(NODES.map(() => 0))
  const particleTs = useRef<number[]>(
    Array.from({ length: NODES.length * PARTICLES_PER_NODE }, (_, i) => (i % PARTICLES_PER_NODE) / PARTICLES_PER_NODE)
  )

  // Create line geometries
  const lineGeos = useMemo(() => {
    return NODES.map(() => {
      const geo = new THREE.BufferGeometry()
      const positions = new Float32Array(6) // 2 points x 3 coords
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      return geo
    })
  }, [])

  const lineMat = useMemo(() => new THREE.LineBasicMaterial({
    color: '#ffffff',
    transparent: true,
    opacity: 0.15,
  }), [])

  const lineObjects = useMemo(() => {
    return lineGeos.map(geo => new THREE.Line(geo, lineMat))
  }, [lineGeos, lineMat])

  useFrame((_, delta) => {
    if (isActive) {
      timeRef.current += delta
    }

    const time = timeRef.current

    // Center pulse
    if (centerRef.current) {
      const s = 0.95 + Math.sin(time * 2) * 0.05
      centerRef.current.scale.setScalar(s)
    }
    if (glowRef.current) {
      const s = 0.95 + Math.sin(time * 2) * 0.05
      glowRef.current.scale.setScalar(s * 1.4)
    }

    // Update nodes
    NODES.forEach((node, i) => {
      const speed = isActive ? node.speed : 0
      const angle = time * speed + node.angleOffset
      const x = node.radius * Math.cos(angle)
      const z = node.radius * Math.sin(angle)
      const y = node.yOffset

      const group = nodeGroupRefs.current[i]
      if (group) {
        group.position.set(x, y, z)

        // Scale animation
        const targetScale = isActive ? 1 : 0
        nodeScales.current[i] += (targetScale - nodeScales.current[i]) * delta * 3
        group.scale.setScalar(nodeScales.current[i])
      }

      // Update line geometry
      const lineGeo = lineGeos[i]
      const posAttr = lineGeo.getAttribute('position') as THREE.BufferAttribute
      posAttr.setXYZ(0, 0, 0, 0)
      posAttr.setXYZ(1, x, y, z)
      posAttr.needsUpdate = true
    })

    // Line opacity
    lineRefs.current.forEach((line) => {
      if (line) {
        const mat = line.material as THREE.LineBasicMaterial
        const targetOpacity = isActive ? 0.15 : 0
        mat.opacity += (targetOpacity - mat.opacity) * delta * 3
      }
    })

    // Particles traveling along connections
    if (isActive) {
      for (let i = 0; i < particleTs.current.length; i++) {
        particleTs.current[i] += 0.5 * delta
        if (particleTs.current[i] >= 1) particleTs.current[i] = 0
      }
    }

    particleTs.current.forEach((t, i) => {
      const mesh = particleRefs.current[i]
      if (!mesh) return

      const nodeIndex = Math.floor(i / PARTICLES_PER_NODE)
      const group = nodeGroupRefs.current[nodeIndex]
      if (!group) return

      // Lerp from center to node position
      mesh.position.set(
        group.position.x * t,
        group.position.y * t,
        group.position.z * t
      )

      const s = isActive ? 1 : 0
      mesh.scale.setScalar(mesh.scale.x + (s - mesh.scale.x) * delta * 3)
    })
  })

  return (
    <>
      <ambientLight intensity={0.1} />

      {/* Center hub */}
      <mesh ref={centerRef}>
        <icosahedronGeometry args={[0.8, 1]} />
        <meshBasicMaterial color="#ff6b00" />
      </mesh>
      <mesh ref={glowRef}>
        <icosahedronGeometry args={[0.8, 1]} />
        <meshBasicMaterial color="#ff6b00" transparent opacity={0.2} />
      </mesh>

      {/* Outer nodes */}
      {NODES.map((node, i) => (
        <group key={i} ref={(el) => { nodeGroupRefs.current[i] = el }}>
          <mesh>
            <sphereGeometry args={[0.3, 16, 16]} />
            <meshBasicMaterial color={node.color} />
          </mesh>
          <Text
            position={[0, 0.55, 0]}
            fontSize={0.2}
            color="#ffffff"
            anchorX="center"
            anchorY="middle"
          >
            {node.label}
          </Text>
        </group>
      ))}

      {/* Connection lines */}
      {lineObjects.map((line, i) => (
        <primitive key={i} object={line} ref={(el: any) => { lineRefs.current[i] = el }} />
      ))}

      {/* Routing particles */}
      {Array.from({ length: NODES.length * PARTICLES_PER_NODE }).map((_, i) => (
        <mesh
          key={i}
          ref={(el) => { particleRefs.current[i] = el }}
          scale={0}
        >
          <sphereGeometry args={[0.08, 8, 8]} />
          <meshBasicMaterial color="#ffffff" />
        </mesh>
      ))}
    </>
  )
}
