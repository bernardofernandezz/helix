import { useEffect } from 'react'
import { useAppStore } from '../store'

/** Refresh cached auth on surface mount so post-launch revocation appears; retain the cached display while fetching. */
export function useHelixProfileAuthStatusRefresh(): void {
  const fetchAuthStatus = useAppStore((state) => state.fetchHelixProfileAuthStatus)
  useEffect(() => {
    void fetchAuthStatus()
  }, [fetchAuthStatus])
}
