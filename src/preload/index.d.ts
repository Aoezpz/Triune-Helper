import type { TriuneBridge } from '@shared/ipc'

declare global {
  interface Window {
    triune: TriuneBridge
  }
}

export {}
