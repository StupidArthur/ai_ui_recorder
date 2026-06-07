export type SseEvent =
  | { type: 'queued'; ahead: number; total: number }
  | {
      type: 'progress'
      phase: string
      step: number
      total_steps: number
      message: string
    }
  | { type: 'done'; status: string; error?: string | null }

export function subscribeJob(
  jobId: string,
  onEvent: (event: SseEvent) => void,
): () => void {
  const url = `/api/jobs/${encodeURIComponent(jobId)}/stream`
  const es = new EventSource(url)

  es.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data) as SseEvent
      onEvent(data)
    } catch {
      // ignore parse errors
    }
  }

  es.onerror = () => {
    // EventSource will auto-reconnect; we don't stop here
  }

  // Return cleanup function
  return () => {
    es.close()
  }
}
