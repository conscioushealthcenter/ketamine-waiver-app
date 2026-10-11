'use client'

import { useState, useEffect } from 'react'

interface WaiverEntry {
  id: string
  name: string
  uploadedAt: string
}

export default function AdminPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [authed, setAuthed] = useState(false)
  const [patients, setPatients] = useState<Record<string, WaiverEntry[]>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const authHeaders = { 'x-admin-username': username, 'x-admin-password': password }

  const login = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/admin/list', {
        headers: authHeaders,
      })
      if (!res.ok) {
        setError('Incorrect username or password')
        return
      }
      const data = await res.json()
      setPatients(data.patients)
      setAuthed(true)
    } catch {
      setError('Connection error')
    } finally {
      setLoading(false)
    }
  }

  const refresh = async () => {
    const res = await fetch('/api/admin/list', {
      headers: authHeaders,
    })
    const data = await res.json()
    setPatients(data.patients)
  }

  const download = async (id: string, name: string) => {
    const res = await fetch(`/api/admin/download?id=${encodeURIComponent(id)}`, {
      headers: authHeaders,
    })
    if (!res.ok) return
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name || 'waiver.pdf'
    a.click()
    URL.revokeObjectURL(url)
  }

  const toggleExpand = (name: string) => {
    setExpanded(prev => ({ ...prev, [name]: !prev[name] }))
  }

  const formatDate = (iso: string) => {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
  }

  const patientNames = Object.keys(patients).sort()

  if (!authed) {
    return (
      <div className="admin-page">
        <div className="admin-login-card">
          <h2>Admin Access</h2>
          <p style={{ fontSize: '0.8rem', color: '#9e9b94', marginBottom: '1.5rem', lineHeight: 1.5 }}>
            Enter your admin credentials to view and download patient waiver submissions.
          </p>
          <input
            type="text"
            className="admin-input"
            placeholder="Username"
            value={username}
            autoComplete="username"
            onChange={e => setUsername(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && login()}
            style={{ marginBottom: '0.75rem' }}
          />
          <input
            type="password"
            className="admin-input"
            placeholder="Password"
            value={password}
            autoComplete="current-password"
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && login()}
          />
          {error && <p style={{ color: '#c0392b', fontSize: '0.75rem', marginBottom: '0.75rem' }}>{error}</p>}
          <button className="admin-btn" onClick={login} disabled={loading}>
            {loading ? 'Verifying…' : 'Sign In'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="admin-page">
      <div className="admin-header">
        <div>
          <h1>Waiver Submissions</h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <span>{patientNames.length} patient{patientNames.length !== 1 ? 's' : ''}</span>
          <button
            onClick={refresh}
            style={{
              background: 'none', border: '1px solid rgba(255,255,255,0.2)',
              color: 'white', padding: '0.35rem 0.8rem', borderRadius: '2px',
              fontSize: '0.72rem', cursor: 'pointer', letterSpacing: '0.06em',
              fontFamily: 'DM Sans, sans-serif',
            }}
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="admin-container">
        {patientNames.length === 0 ? (
          <div className="loading">No submissions yet.</div>
        ) : (
          patientNames.map(name => (
            <div key={name} className="patient-group">
              <div
                className="patient-group-header"
                onClick={() => toggleExpand(name)}
              >
                <h3>{name}</h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <span>{patients[name].length} waiver{patients[name].length !== 1 ? 's' : ''}</span>
                  <span style={{ fontSize: '0.7rem', color: '#9e9b94' }}>
                    {expanded[name] ? '▲' : '▼'}
                  </span>
                </div>
              </div>

              {(expanded[name] ?? true) && patients[name].map((waiver, i) => (
                <div key={waiver.id} className="waiver-item">
                  <div>
                    <div className="waiver-date">{formatDate(waiver.uploadedAt)}</div>
                    <div style={{ fontSize: '0.7rem', color: '#b0ae9a', marginTop: '0.15rem' }}>
                      {waiver.name}
                    </div>
                  </div>
                  <button
                    className="download-btn"
                    onClick={() => download(waiver.id, waiver.name)}
                  >
                    Download PDF
                  </button>
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
