import { contextBridge, ipcRenderer } from 'electron'
import type { EventChannel, EventMap, InvokeChannel, InvokeMap, TriuneBridge } from '@shared/ipc'

/**
 * The renderer gets exactly two functions and no Node. Everything that touches
 * the filesystem, the network or the window lives on the other side of this
 * bridge.
 */
const bridge: TriuneBridge = {
  invoke: (channel, payload) => ipcRenderer.invoke(channel, payload),
  on: <C extends EventChannel>(channel: C, listener: (payload: EventMap[C]) => void) => {
    const wrapped = (_e: unknown, payload: EventMap[C]): void => listener(payload)
    ipcRenderer.on(channel, wrapped)
    return () => {
      ipcRenderer.off(channel, wrapped)
    }
  }
}

contextBridge.exposeInMainWorld('triune', bridge)

// Re-exported only so the type imports above aren't erased as unused.
export type { InvokeChannel, InvokeMap }
