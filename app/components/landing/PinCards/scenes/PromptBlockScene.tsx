'use client'

import { useRef, useMemo, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { RoundedBox, Text } from '@react-three/drei'
import * as THREE from 'three'

interface SceneProps {
  isActive: boolean
}

const TRAFFIC_LIGHTS = [
  { x: -2.2, color: '#ef4444' },
  { x: -2.0, color: '#f59e0b' },
  { x: -1.8, color: '#10b981' },
]

const FEATURES = [
  { title: 'AI-Powered', desc: 'Smart automation', color: '#ff6b00' },
  { title: 'Zero Code', desc: 'Just describe it', color: '#10b981' },
  { title: 'Instant Deploy', desc: 'Go live in seconds', color: '#3b82f6' },
]

export default function PromptBlockScene({ isActive }: SceneProps) {
  const groupRef = useRef<THREE.Group>(null!)
  const promptGroupRef = useRef<THREE.Group>(null!)
  const browserGroupRef = useRef<THREE.Group>(null!)
  const cursorRef = useRef<THREE.Mesh>(null!)

  const progressRef = useRef(0)
  const hasActivated = useRef(false)
  const cursorTime = useRef(0)

  const [hoveredNavCta, setHoveredNavCta] = useState(false)
  const [hoveredHeroCta, setHoveredHeroCta] = useState(false)
  const [hoveredCard, setHoveredCard] = useState<number | null>(null)

  const promptMat = useMemo(() => new THREE.MeshPhysicalMaterial({
    color: '#231710',
    metalness: 0.3,
    roughness: 0.4,
    transparent: true,
    opacity: 1,
  }), [])

  const promptGlowMat = useMemo(() => new THREE.MeshBasicMaterial({
    color: '#ff6b00',
    transparent: true,
    opacity: 0.4,
  }), [])

  const browserMat = useMemo(() => new THREE.MeshPhysicalMaterial({
    color: '#ffffff',
    roughness: 0.5,
    metalness: 0.05,
    transparent: true,
    opacity: 1,
  }), [])

  const chromeMat = useMemo(() => new THREE.MeshBasicMaterial({
    color: '#f1f5f9',
    transparent: true,
    opacity: 1,
  }), [])

  const urlBarMat = useMemo(() => new THREE.MeshBasicMaterial({
    color: '#e2e8f0',
    transparent: true,
    opacity: 1,
  }), [])

  const cardMat = useMemo(() => new THREE.MeshBasicMaterial({
    color: '#f8fafc',
    transparent: true,
    opacity: 1,
  }), [])

  const navCtaMat = useMemo(() => new THREE.MeshBasicMaterial({
    color: '#ff6b00',
    transparent: true,
    opacity: 1,
  }), [])

  const heroCtaMat = useMemo(() => new THREE.MeshBasicMaterial({
    color: '#ff6b00',
    transparent: true,
    opacity: 1,
  }), [])

  useFrame((_, delta) => {
    if (isActive && !hasActivated.current) {
      hasActivated.current = true
    }
    if (!isActive) {
      hasActivated.current = false
    }

    const target = isActive ? 1 : 0
    progressRef.current += (target - progressRef.current) * delta * 2.5
    const p = progressRef.current

    cursorTime.current += delta

    if (promptGroupRef.current) {
      promptGroupRef.current.scale.setScalar(1 - p)
      promptMat.opacity = 1 - p
      promptGlowMat.opacity = (1 - p) * 0.4
    }

    if (browserGroupRef.current) {
      browserGroupRef.current.scale.setScalar(p)
    }

    if (cursorRef.current) {
      cursorRef.current.visible = Math.sin(cursorTime.current * 6) > 0 && p < 0.1
    }

    if (groupRef.current) {
      groupRef.current.rotation.y += delta * (0.2 - p * 0.12)
    }

    // Interactive hover effects
    navCtaMat.color.set(hoveredNavCta ? '#ea580c' : '#ff6b00')
    heroCtaMat.color.set(hoveredHeroCta ? '#ea580c' : '#ff6b00')
  })

  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[5, 5, 5]} intensity={0.4} />

      <group ref={groupRef}>
        {/* ===== PROMPT BAR ===== */}
        <group ref={promptGroupRef}>
          <RoundedBox args={[4.2, 0.6, 0.3]} radius={0.15}>
            <primitive object={promptMat} attach="material" />
          </RoundedBox>

          <RoundedBox args={[4.6, 0.8, 0.1]} radius={0.2}>
            <primitive object={promptGlowMat} attach="material" />
          </RoundedBox>

          <mesh position={[-1.8, 0, 0.16]}>
            <planeGeometry args={[0.22, 0.22]} />
            <meshBasicMaterial color="#ff6b00" transparent opacity={0.9} />
          </mesh>

          <Text
            position={[-1.35, 0, 0.16]}
            fontSize={0.2}
            color="rgba(255,255,255,0.45)"
            anchorX="left"
            anchorY="middle"
          >
            Describe your app...
          </Text>

          <mesh ref={cursorRef} position={[1.4, 0, 0.16]}>
            <planeGeometry args={[0.025, 0.22]} />
            <meshBasicMaterial color="#ff6b00" />
          </mesh>
        </group>

        {/* ===== BROWSER WINDOW ===== */}
        <group ref={browserGroupRef} scale={0}>
          <RoundedBox args={[5.2, 3.6, 0.35]} radius={0.12}>
            <primitive object={browserMat} attach="material" />
          </RoundedBox>

          {/* Chrome toolbar */}
          <mesh position={[0, 1.6, 0.18]}>
            <planeGeometry args={[5.0, 0.4]} />
            <primitive object={chromeMat} attach="material" />
          </mesh>

          <mesh position={[0, 1.4, 0.18]}>
            <planeGeometry args={[5.0, 0.01]} />
            <meshBasicMaterial color="#e2e8f0" />
          </mesh>

          {TRAFFIC_LIGHTS.map((dot, i) => (
            <mesh key={i} position={[dot.x, 1.6, 0.19]}>
              <circleGeometry args={[0.055, 12]} />
              <meshBasicMaterial color={dot.color} />
            </mesh>
          ))}

          <mesh position={[0.1, 1.6, 0.19]}>
            <planeGeometry args={[3.6, 0.22]} />
            <primitive object={urlBarMat} attach="material" />
          </mesh>

          <Text
            position={[-1.5, 1.6, 0.2]}
            fontSize={0.09}
            color="#64748b"
            anchorX="left"
            anchorY="middle"
          >
            https://prompify.app
          </Text>

          {/* ===== PAGE CONTENT ===== */}
          <mesh position={[0, 1.08, 0.18]}>
            <planeGeometry args={[4.8, 0.35]} />
            <meshBasicMaterial color="#ffffff" transparent opacity={1} />
          </mesh>

          <Text
            position={[-2.1, 1.08, 0.19]}
            fontSize={0.15}
            color="#ff6b00"
            anchorX="left"
            anchorY="middle"
          >
            Prompify
          </Text>

          {['Features', 'Pricing', 'Docs'].map((label, i) => (
            <Text
              key={i}
              position={[0.2 + i * 0.55, 1.08, 0.19]}
              fontSize={0.1}
              color="#64748b"
              anchorX="left"
              anchorY="middle"
            >
              {label}
            </Text>
          ))}

          {/* Nav CTA button (interactive) */}
          <mesh
            position={[2.0, 1.08, 0.19]}
            onPointerEnter={() => setHoveredNavCta(true)}
            onPointerLeave={() => setHoveredNavCta(false)}
          >
            <planeGeometry args={[0.65, 0.22]} />
            <primitive object={navCtaMat} attach="material" />
          </mesh>
          <Text
            position={[2.0, 1.08, 0.2]}
            fontSize={0.09}
            color="#ffffff"
            anchorX="center"
            anchorY="middle"
          >
            Get Started
          </Text>

          {/* Hero section */}
          <Text
            position={[-1.8, 0.5, 0.18]}
            fontSize={0.28}
            color="#0f172a"
            anchorX="left"
            anchorY="middle"
          >
            Build Apps with AI
          </Text>

          <Text
            position={[-1.8, 0.15, 0.18]}
            fontSize={0.1}
            color="#64748b"
            anchorX="left"
            anchorY="middle"
            maxWidth={3}
          >
            Describe your idea in plain English and get a
            working app instantly. No coding required.
          </Text>

          {/* Hero CTA (interactive) */}
          <mesh
            position={[-1.8, -0.25, 0.18]}
            onPointerEnter={() => setHoveredHeroCta(true)}
            onPointerLeave={() => setHoveredHeroCta(false)}
          >
            <planeGeometry args={[1.0, 0.25]} />
            <primitive object={heroCtaMat} attach="material" />
          </mesh>
          <Text
            position={[-1.8, -0.25, 0.19]}
            fontSize={0.1}
            color="#ffffff"
            anchorX="center"
            anchorY="middle"
          >
            Start Prompting
          </Text>

          {/* Feature cards (interactive) */}
          {FEATURES.map((feature, i) => {
            const x = -1.8 + i * 1.8
            const isHovered = hoveredCard === i
            return (
              <group key={i}>
                <mesh
                  position={[x, -0.9, 0.18]}
                  onPointerEnter={() => setHoveredCard(i)}
                  onPointerLeave={() => setHoveredCard(null)}
                  scale={isHovered ? [1.05, 1.05, 1] : [1, 1, 1]}
                >
                  <planeGeometry args={[1.4, 0.7]} />
                  <primitive object={cardMat} attach="material" />
                </mesh>
                <mesh position={[x, -0.55, 0.19]}>
                  <planeGeometry args={[1.4, 0.04]} />
                  <meshBasicMaterial color={feature.color} />
                </mesh>
                <Text
                  position={[x, -0.8, 0.19]}
                  fontSize={0.11}
                  color={isHovered ? feature.color : '#0f172a'}
                  anchorX="center"
                  anchorY="middle"
                >
                  {feature.title}
                </Text>
                <Text
                  position={[x, -1.0, 0.19]}
                  fontSize={0.08}
                  color="#94a3b8"
                  anchorX="center"
                  anchorY="middle"
                >
                  {feature.desc}
                </Text>
              </group>
            )
          })}
        </group>
      </group>
    </>
  )
}
