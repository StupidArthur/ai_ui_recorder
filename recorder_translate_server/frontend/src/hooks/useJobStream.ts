import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { SseEvent } from '@/api/sse'
import { subscribeJob } from '@/api/sse'
import type { JobView } from '@/api/jobs'

export function useJobStream(jobId: string | undefined) {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!jobId) return

    const unsubscribe = subscribeJob(jobId, (event: SseEvent) => {
      // Update the job query cache with latest data from SSE
      queryClient.setQueryData<JobView>(['job', jobId], (old) => {
        if (!old) return old
        switch (event.type) {
          case 'progress':
            return {
              ...old,
              status: 'running',
              current_phase: event.phase,
              current_step: event.step,
              total_steps: event.total_steps,
              message: event.message,
            }
          case 'done':
            return {
              ...old,
              status: event.status as JobView['status'],
              error: event.error ?? null,
            }
          default:
            return old
        }
      })

      // Invalidate jobs list when done
      if (event.type === 'done') {
        queryClient.invalidateQueries({ queryKey: ['jobs'] })
      }
    })

    return unsubscribe
  }, [jobId, queryClient])
}
