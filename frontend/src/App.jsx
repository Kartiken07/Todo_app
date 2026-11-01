import { useEffect, useMemo, useState } from 'react'
import { api } from './api.js'
import { DAY_PLAN } from './schedule.js'
import VolumeChart from './VolumeChart.jsx'
import './App.css'

const FILTERS = ['all', 'active', 'done']

const POP_PARTICLES = Array.from({ length: 10 }, (_, i) => i)

const TODAY_LABEL = new Date().toLocaleDateString(undefined, {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
})

function formatTime(time) {
  if (!time) return null
  const [h, m] = time.split(':').map(Number)
  const d = new Date()
  d.setHours(h, m, 0, 0)
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

function durationOf(start, end) {
  if (!start || !end) return null
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  const mins = eh * 60 + em - (sh * 60 + sm)
  if (mins <= 0) return null
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h && m) return `${h}h ${m}m`
  if (h) return `${h}h`
  return `${m}m`
}

function timeRange(task) {
  const start = formatTime(task.start_time)
  const end = formatTime(task.end_time)
  if (start && end) return `${start} – ${end}`
  if (start) return start
  return end
}

function bySchedule(a, b) {
  const x = a.start_time
  const y = b.start_time
  if (x && y && x !== y) return x < y ? -1 : 1
  if (x && !y) return -1
  if (!x && y) return 1
  if (a.done !== b.done) return a.done ? 1 : -1
  return b.id - a.id
}

export default function App() {
  const [tasks, setTasks] = useState([])
  const [text, setText] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [filter, setFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [volumeKey, setVolumeKey] = useState(0)
  const [editingId, setEditingId] = useState(null)
  const [editText, setEditText] = useState('')
  const [editStart, setEditStart] = useState('')
  const [editEnd, setEditEnd] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [editError, setEditError] = useState('')
  const [pops, setPops] = useState([])

  const refreshVolume = () => setVolumeKey((k) => k + 1)

  useEffect(() => {
    api
      .list()
      .then((rows) => setTasks([...rows].sort(bySchedule)))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const visible = useMemo(() => {
    let list = tasks
    if (filter === 'active') list = list.filter((t) => !t.done)
    if (filter === 'done') list = list.filter((t) => t.done)
    return [...list].sort(bySchedule)
  }, [tasks, filter])

  const doneCount = tasks.filter((t) => t.done).length
  const timedCount = tasks.filter((t) => t.start_time).length
  const progress = tasks.length ? Math.round((doneCount / tasks.length) * 100) : 0

  async function addTask(e) {
    e.preventDefault()
    const value = text.trim()
    if (!value || busy) return
    if (startTime && endTime && startTime >= endTime) {
      setError('End time must be after start time')
      return
    }
    setBusy(true)
    setError('')
    try {
      const created = await api.create(value, startTime, endTime)
      setTasks((prev) => [...prev, created].sort(bySchedule))
      setText('')
      setStartTime('')
      setEndTime('')
      refreshVolume()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function addPlan() {
    if (busy) return
    const have = new Set(tasks.map((t) => `${t.text}::${t.start_time ?? ''}`))
    const items = DAY_PLAN.filter((p) => !have.has(`${p.text}::${p.start_time}`))
    if (!items.length) {
      setError('Your day plan is already in the list')
      return
    }
    setBusy(true)
    setError('')
    try {
      const created = await api.createBatch(items)
      setTasks((prev) => [...prev, ...created].sort(bySchedule))
      refreshVolume()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  function startEdit(task) {
    setEditingId(task.id)
    setEditText(task.text)
    setEditStart(task.start_time || '')
    setEditEnd(task.end_time || '')
    setEditNotes(task.notes || '')
    setEditError('')
  }

  function cancelEdit() {
    setEditingId(null)
    setEditError('')
  }

  async function saveEdit(e) {
    e.preventDefault()
    const value = editText.trim()
    if (!value || !editingId) return
    if (editStart && editEnd && editStart >= editEnd) {
      setEditError('End time must be after start time')
      return
    }
    setEditError('')
    try {
      const updated = await api.update(editingId, {
        text: value,
        start_time: editStart || null,
        end_time: editEnd || null,
        notes: editNotes.trim() || null,
      })
      setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)).sort(bySchedule))
      setEditingId(null)
    } catch (err) {
      setEditError(err.message)
    }
  }

  function firePop(id) {
    setPops((prev) => [...prev, id])
    setTimeout(() => setPops((prev) => prev.filter((x) => x !== id)), 800)
  }

  async function toggleTask(task) {
    setError('')
    const next = !task.done
    setTasks((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, done: next } : t)).sort(bySchedule),
    )
    if (next) firePop(task.id)
    try {
      await api.setDone(task.id, next)
      refreshVolume()
    } catch (err) {
      setError(err.message)
      setTasks((prev) =>
        prev.map((t) => (t.id === task.id ? { ...t, done: task.done } : t)).sort(bySchedule),
      )
    }
  }

  async function deleteTask(task) {
    setError('')
    if (editingId === task.id) cancelEdit()
    const previous = tasks
    setTasks((prev) => prev.filter((t) => t.id !== task.id))
    try {
      await api.remove(task.id)
      refreshVolume()
    } catch (err) {
      setError(err.message)
      setTasks(previous)
    }
  }

  async function clearDone() {
    const done = tasks.filter((t) => t.done)
    if (!done.length || busy) return
    cancelEdit()
    setBusy(true)
    setError('')
    const previous = tasks
    setTasks((prev) => prev.filter((t) => !t.done))
    try {
      await Promise.all(done.map((t) => api.remove(t.id)))
      refreshVolume()
    } catch (err) {
      setError(err.message)
      setTasks(previous)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page">
      <div className="glow glow-one" />
      <div className="glow glow-two" />

      <main className="card">
        <header className="header">
          <div>
            <h1>
              Today&apos;s To-Do<span className="dot">.</span>
            </h1>
            <p className="date">{TODAY_LABEL}</p>
          </div>
          <div className="ring" style={{ '--progress': `${progress * 3.6}deg` }}>
            <span>{progress}%</span>
          </div>
        </header>

        <form className="composer" onSubmit={addTask}>
          <div className="composer-main">
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="What needs to get done today?"
              maxLength={500}
              aria-label="New task"
            />
            <button type="submit" disabled={busy || !text.trim()}>
              Add
            </button>
          </div>
          <div className="time-row">
            <label className="time-field">
              <span>Start</span>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                aria-label="Start time"
              />
            </label>
            <span className="time-arrow" aria-hidden="true">
              →
            </span>
            <label className="time-field">
              <span>End</span>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                aria-label="End time"
              />
            </label>
            <span className="time-hint">optional</span>
          </div>
        </form>

        {error && <p className="error">{error}</p>}

        <nav className="tabs">
          {FILTERS.map((f) => (
            <button
              key={f}
              className={filter === f ? 'tab active' : 'tab'}
              onClick={() => setFilter(f)}
              type="button"
            >
              {f[0].toUpperCase() + f.slice(1)}
            </button>
          ))}
          <button className="plan-btn" type="button" onClick={addPlan} disabled={busy}>
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="3" y="4" width="18" height="17" rx="3" />
              <path d="M8 2v4M16 2v4M3 10h18M12 14v4M10 16h4" />
            </svg>
            Add day plan
          </button>
          <button className="clear" type="button" onClick={clearDone} disabled={busy || !doneCount}>
            Clear done
          </button>
        </nav>

        {loading ? (
          <p className="muted">Loading tasks…</p>
        ) : visible.length === 0 ? (
          <div className="empty">
            <span className="empty-icon" aria-hidden="true">
              <svg
                width="34"
                height="34"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M9 11l2 2 4-4" />
                <rect x="3" y="4" width="18" height="17" rx="3" />
                <path d="M8 2v4M16 2v4" />
              </svg>
            </span>
            <p>
              {filter === 'active'
                ? 'All done for today. Enjoy your day!'
                : filter === 'done'
                  ? 'No completed tasks yet.'
                  : 'Nothing on your plate yet — add your first task.'}
            </p>
          </div>
        ) : (
          <ul className="tasks">
            {visible.map((task) =>
              editingId === task.id ? (
                <li key={task.id} className="task editing">
                  <form className="edit-form" onSubmit={saveEdit}>
                    <input
                      className="edit-title"
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      placeholder="Task title"
                      maxLength={500}
                      aria-label="Task title"
                      autoFocus
                    />
                    <div className="edit-row">
                      <label className="time-field">
                        <span>Start</span>
                        <input
                          type="time"
                          value={editStart}
                          onChange={(e) => setEditStart(e.target.value)}
                          aria-label="Start time"
                        />
                      </label>
                      <span className="time-arrow" aria-hidden="true">
                        →
                      </span>
                      <label className="time-field">
                        <span>End</span>
                        <input
                          type="time"
                          value={editEnd}
                          onChange={(e) => setEditEnd(e.target.value)}
                          aria-label="End time"
                        />
                      </label>
                    </div>
                    <input
                      className="edit-notes"
                      value={editNotes}
                      onChange={(e) => setEditNotes(e.target.value)}
                      placeholder="Notes (optional)"
                      maxLength={1000}
                      aria-label="Notes"
                    />
                    {editError && <p className="edit-error">{editError}</p>}
                    <div className="edit-actions">
                      <button type="submit" className="save">
                        Save
                      </button>
                      <button type="button" className="cancel" onClick={cancelEdit}>
                        Cancel
                      </button>
                    </div>
                  </form>
                </li>
              ) : (
                <li key={task.id} className={task.done ? 'task done' : 'task'}>
                  {pops.includes(task.id) && (
                    <span className="pop" aria-hidden="true">
                      {POP_PARTICLES.map((i) => (
                        <i key={i} style={{ '--i': i }} />
                      ))}
                    </span>
                  )}
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={task.done}
                      onChange={() => toggleTask(task)}
                    />
                    <span className="mark" />
                  </label>
                  <div className="body">
                    <span className="text">{task.text}</span>
                    {task.notes && <span className="notes">{task.notes}</span>}
                  </div>
                  {(task.start_time || task.end_time) && (
                    <span
                      className="time-badge"
                      title={durationOf(task.start_time, task.end_time) || 'Scheduled time'}
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                      >
                        <circle cx="12" cy="12" r="9" />
                        <path d="M12 7v5l3 2" />
                      </svg>
                      {timeRange(task)}
                      {durationOf(task.start_time, task.end_time) && (
                        <em className="dur">{durationOf(task.start_time, task.end_time)}</em>
                      )}
                    </span>
                  )}
                  <div className="actions">
                    <button
                      type="button"
                      className="edit"
                      onClick={() => startEdit(task)}
                      aria-label={`Edit ${task.text}`}
                      title="Edit task"
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M12 20h9" />
                        <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className="delete"
                      onClick={() => deleteTask(task)}
                      aria-label={`Delete ${task.text}`}
                      title="Delete task"
                    >
                      ✕
                    </button>
                  </div>
                </li>
              ),
            )}
          </ul>
        )}

        <footer className="footer">
          <span>
            {doneCount}/{tasks.length} completed
          </span>
          <span>{tasks.length - doneCount} left today</span>
          <span>{timedCount} scheduled</span>
        </footer>

        <VolumeChart refreshKey={volumeKey} />
      </main>
    </div>
  )
}
