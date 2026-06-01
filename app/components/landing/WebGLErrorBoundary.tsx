'use client'

import { Component, type ReactNode } from 'react'

interface Props { children: ReactNode }
interface State { failed: boolean }

export default class WebGLErrorBoundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  render() {
    if (this.state.failed) {
      return (
        <div
          className="w-full h-full flex items-center justify-center"
          style={{ minHeight: 320 }}
        >
          <p style={{ color: '#a07050', fontSize: '0.8rem', opacity: 0.6 }}>
            3D view unavailable on this device.
          </p>
        </div>
      )
    }
    return this.props.children
  }
}
