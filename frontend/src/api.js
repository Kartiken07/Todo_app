async function request(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const detail = body.detail
    const message = Array.isArray(detail)
      ? detail.map((d) => d.msg).join('; ')
      : detail || `Request failed (${res.status})`
    throw new Error(message)
  }
  if (res.status === 204) return null
  return res.json()
}

export const api = {
  list: () => request('/api/tasks'),
  create: (text, startTime, endTime) =>
    request('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({
        text,
        start_time: startTime || null,
        end_time: endTime || null,
      }),
    }),
  createBatch: (items) =>
    request('/api/tasks/batch', {
      method: 'POST',
      body: JSON.stringify({
        tasks: items.map((item) => ({
          text: item.text,
          start_time: item.start_time || null,
          end_time: item.end_time || null,
          notes: item.notes || null,
        })),
      }),
    }),
  setDone: (id, done) =>
    request(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify({ done }) }),
  update: (id, patch) =>
    request(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  remove: (id) => request(`/api/tasks/${id}`, { method: 'DELETE' }),
  volume: () => request('/api/stats/volume'),
}
