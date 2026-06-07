export class ApiError extends Error {
  status: number
  body: string
  constructor(status: number, body: string) {
    super(`API Error ${status}: ${body}`)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...options,
    credentials: 'include',
  })
  if (!res.ok) {
    const body = await res.text()
    throw new ApiError(res.status, body)
  }
  return res.json() as Promise<T>
}
