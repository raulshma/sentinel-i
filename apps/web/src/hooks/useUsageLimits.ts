import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

export interface UsageLimitsData {
  configured: boolean
  data?: {
    label: string
    limit: number | null
    limit_reset: string | null
    limit_remaining: number | null
    include_byok_in_limit: boolean
    usage: number
    usage_daily: number
    usage_weekly: number
    usage_monthly: number
    byok_usage: number
    byok_usage_daily: number
    byok_usage_weekly: number
    byok_usage_monthly: number
    is_free_tier: boolean
  }
}

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? ''

export const useUsageLimits = () => {
  const [data, setData] = useState<UsageLimitsData | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchUsage = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/api/v1/usage`)
      if (!res.ok) {
        setError('Failed to fetch usage data')
        return
      }
      const json = (await res.json()) as UsageLimitsData
      setData(json)
    } catch {
      setError('Network error')
    } finally {
      setIsLoading(false)
    }
  }, [])

  const startPolling = useCallback(() => {
    void fetchUsage()
    if (intervalRef.current) clearInterval(intervalRef.current)
    intervalRef.current = setInterval(() => void fetchUsage(), 60_000)
  }, [fetchUsage])

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [])

  return useMemo(
    () => ({ data, isLoading, error, fetchUsage, startPolling, stopPolling }),
    [data, isLoading, error, fetchUsage, startPolling, stopPolling],
  )
}
