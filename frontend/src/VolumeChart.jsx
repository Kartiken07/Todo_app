import { useEffect, useState } from 'react'
import { api } from './api.js'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const TODAY_ISO = new Date().toISOString().slice(0, 10)

function weekdayIndex(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  const t = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4]
  const year = m < 3 ? y - 1 : y
  return (
    year + Math.floor(year / 4) - Math.floor(year / 100) + Math.floor(year / 400) + t[m - 1] + d
  ) % 7
}

function formatLabel(day) {
  return WEEKDAYS[weekdayIndex(day)]
}

export default function VolumeChart({ refreshKey }) {
  const [data, setData] = useState([])

  useEffect(() => {
    api.volume().then(setData).catch(() => setData([]))
  }, [refreshKey])

  const max = Math.max(1, ...data.map((d) => Math.max(d.created, d.completed)))

  return (
    <section className="volume">
      <div className="volume-head">
        <h2>Task volume</h2>
        <span className="volume-sub">last 7 days</span>
      </div>
      <div className="chart">
        {data.map((d) => (
          <div key={d.day} className={d.day === TODAY_ISO ? 'col today' : 'col'}>
            <div className="bars">
              <div
                className="bar created"
                style={{ height: `${(d.created / max) * 100}%` }}
                title={`${d.created} added`}
              >
                {d.created > 0 && <span className="val">{d.created}</span>}
              </div>
              <div
                className="bar completed"
                style={{ height: `${(d.completed / max) * 100}%` }}
                title={`${d.completed} completed`}
              >
                {d.completed > 0 && <span className="val">{d.completed}</span>}
              </div>
            </div>
            <span className="label">{formatLabel(d.day)}</span>
          </div>
        ))}
      </div>
      <div className="legend">
        <span>
          <i className="key created" /> added
        </span>
        <span>
          <i className="key completed" /> completed
        </span>
      </div>
    </section>
  )
}
