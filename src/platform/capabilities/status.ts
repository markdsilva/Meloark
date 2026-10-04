import { create } from 'zustand'

type Outcome = 'unverified' | 'available' | 'limited' | 'unavailable'
export const usePlatformStatus = create<{ storage: Outcome; storageReason?: string; handles: Outcome; handleReason?: string; pickerReason?: string }>(() => ({ storage: 'unverified', handles: 'unverified' }))
export function storageOutcome(error?: unknown) {
  usePlatformStatus.setState(error ? { storage: error instanceof DOMException && error.name === 'QuotaExceededError' ? 'limited' : 'unavailable', storageReason: error instanceof Error ? error.message : 'Browser storage failed.' }
    : { storage: 'available', storageReason: undefined })
}
export function handleOutcome(error?: unknown) {
  usePlatformStatus.setState(error ? { handles: 'limited', handleReason: error instanceof Error ? error.message : 'This folder handle could not be remembered.' } : { handles: 'available', handleReason: undefined })
}
