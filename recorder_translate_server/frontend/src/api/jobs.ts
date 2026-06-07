import { apiFetch } from './client'

export interface JobView {
  job_id: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  created_at: string
  updated_at: string
  current_phase: string
  current_step: number
  total_steps: number
  message: string
  queue_ahead: number
  queue_total: number
  error: string | null
}

export interface UploadResponse {
  job_id: string
  status: string
  queue_ahead: number
  queue_total: number
  total_steps: number
  current_step: number
}

export interface UploadProgress {
  loaded: number
  total: number
}

export function uploadJob(
  file: File,
  onProgress?: (p: UploadProgress) => void,
): Promise<UploadResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const formData = new FormData()
    formData.append('file', file)

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress({ loaded: e.loaded, total: e.total })
      }
    })

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText))
      } else {
        reject(new Error(`Upload failed: ${xhr.status} ${xhr.statusText}`))
      }
    })

    xhr.addEventListener('error', () => reject(new Error('Network error')))

    xhr.open('POST', '/api/upload')
    xhr.send(formData)
  })
}

export async function listJobs(): Promise<JobView[]> {
  return apiFetch<JobView[]>('/api/jobs')
}

export async function getJob(jobId: string): Promise<JobView> {
  return apiFetch<JobView>(`/api/jobs/${encodeURIComponent(jobId)}`)
}

export async function cancelJob(jobId: string): Promise<{ status: string }> {
  return apiFetch<{ status: string }>(`/api/jobs/${encodeURIComponent(jobId)}`, {
    method: 'DELETE',
  })
}

export function getDownloadUrl(jobId: string): string {
  return `/api/jobs/${encodeURIComponent(jobId)}/download`
}

export function getFileUrl(jobId: string, path: string): string {
  return `/api/jobs/${encodeURIComponent(jobId)}/file?p=${encodeURIComponent(path)}`
}
