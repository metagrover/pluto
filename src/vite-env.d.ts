/// <reference types="vite/client" />

interface Window {
    ipcRenderer: {
        invoke: (channel: string, ...args: any[]) => Promise<any>
        send: (channel: string, ...args: any[]) => void
        on: (channel: string, listener: (event: any, ...args: any[]) => void) => void
        off: (channel: string, listener: (...args: any[]) => void) => void
    }
    audioLoopback: {
        enable: () => Promise<void>
        disable: () => Promise<void>
    }
}
