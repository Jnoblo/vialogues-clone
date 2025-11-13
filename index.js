import express from 'express'
import cors from 'cors'
import sqlite3 from 'better-sqlite3'
import fs from 'fs'
import path from 'path'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcrypt'
import multer from 'multer'
import nodemailer from 'nodemailer'

const app = express()
app.use(cors())
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

const DB_FILE = './db.sqlite'
const SECRET = process.env.JWT_SECRET || 'demo_secret_key_v4'
const INVITE_SECRET = process.env.INVITE_SECRET || 'invite_secret_v4'

if (!fs.existsSync('./uploads')) fs.mkdirSync('./uploads')
if (!fs.existsSync('./client')) fs.mkdirSync('./client')

const db = new sqlite3(DB_FILE)
const schema = fs.readFileSync('./db_init.sql', 'utf8')
db.exec(schema)

// ensure demo admin exists
const admin = db.prepare('SELECT * FROM users WHERE email = ?').get('demo@vialogues.local')
if (!admin) {
  const hash = bcrypt.hashSync('admin123', 10)
  db.prepare('INSERT INTO users (email, password_hash, role, display_name, invited) VALUES (?, ?, ?, ?, ?)').run('demo@vialogues.local', hash, 'admin', 'Admin Démo', 0)
  console.log('Demo admin created: demo@vialogues.local / admin123')
}

// nodemailer transporter (Gmail recommended)
let transporter = null
if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  })
  console.log('Nodemailer configured')
} else {
  console.log('Nodemailer not configured - mail notifications disabled')
}

// auth middleware
function auth(req, res, next) {
  const header = req.headers.authorization
  if (!header) return res.status(401).json({ error: 'Missing token' })
  const token = header.split(' ')[1]
  try {
    const payload = jwt.verify(token, SECRET)
    req.user = payload
    next()
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' })
  }
}

// helper: generate project code
function genCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let s = ''
  for (let i=0;i<6;i++) s += chars.charAt(Math.floor(Math.random()*chars.length))
  return 'PRJ-' + s
}

// send email to project members
async function notifyProjectMembers(projectId, subject, text) {
  if (!transporter) return
  const rows = db.prepare('SELECT u.email FROM users u JOIN project_members pm ON u.id = pm.user_id WHERE pm.project_id = ?').all(projectId)
  const emails = rows.map(r=>r.email).filter(Boolean)
  if (!emails.length) return
  const mail = { from: process.env.SMTP_FROM || process.env.SMTP_USER, to: emails.join(','), subject, text }
  try { await transporter.sendMail(mail) } catch(e){ console.error('Failed to send mail', e) }
}

// --- Routes --- //

// Login
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email)
  if (!user) return res.status(401).json({ error: 'Invalid credentials' })
  if (!user.password_hash) return res.status(401).json({ error: 'Account not activated. Use invitation link.' })
  const ok = bcrypt.compareSync(password, user.password_hash)
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' })
  const token = jwt.sign({ id: user.id, email: user.email, role: user.role, display_name: user.display_name }, SECRET)
  res.json({ token, user: { id: user.id, email: user.email, role: user.role, display_name: user.display_name } })
})

// Projects
app.get('/api/projects', auth, (req, res) => {
  const projects = db.prepare('SELECT p.*, COUNT(v.id) as video_count FROM projects p LEFT JOIN videos v ON v.project_id = p.id GROUP BY p.id').all()
  res.json(projects)
})

app.post('/api/projects', auth, (req, res) => {
  const { title, description } = req.body
  const code = genCode()
  const info = db.prepare('INSERT INTO projects (title, description, code) VALUES (?, ?, ?)').run(title, description, code)
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(info.lastInsertRowid)
  db.prepare('INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, ?)').run(project.id, req.user.id, 'owner')
  res.json(project)
})

// Admin: list all projects (admin role required)
app.get('/api/admin/projects', auth, (req, res) => {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' })
  const rows = db.prepare(`SELECT p.id, p.title, p.code, p.created_at, COUNT(DISTINCT v.id) as videos, COUNT(DISTINCT a.id) as annotations
    FROM projects p
    LEFT JOIN videos v ON v.project_id = p.id
    LEFT JOIN annotations a ON a.video_id = v.id
    GROUP BY p.id`).all()
  res.json(rows)
})

// Project members management and invite-by-link
app.get('/api/projects/:id/members', auth, (req, res) => {
  const rows = db.prepare('SELECT u.id, u.email, u.display_name, pm.role FROM users u JOIN project_members pm ON u.id = pm.user_id WHERE pm.project_id = ?').all(req.params.id)
  res.json(rows)
})

// Invite: generate invite token and send email with link
app.post('/api/projects/:id/members', auth, async (req, res) => {
  const projectId = req.params.id
  const { email, role } = req.body
  if (!email) return res.status(400).json({ error: 'Missing email' })
  // create user if not exists (no password yet), mark invited
  let user = db.prepare('SELECT * FROM users WHERE email = ?').get(email)
  if (!user) {
    const info = db.prepare('INSERT INTO users (email, password_hash, role, display_name, invited) VALUES (?, ?, ?, ?, ?)').run(email, null, 'user', null, 1)
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid)
  } else {
    // mark invited if already exists
    db.prepare('UPDATE users SET invited = 1 WHERE id = ?').run(user.id)
  }
  // create member entry (ignore duplicates)
  try { db.prepare('INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, ?)').run(projectId, user.id, role || 'annotator') } catch(e){}
  // generate invite token valid 48h
  const token = jwt.sign({ email: user.email, projectId, role: role || 'annotator' }, INVITE_SECRET, { expiresIn: '48h' })
  const inviteLink = `${process.env.PUBLIC_URL || ''}/invite?token=${token}`
  // send invite email if transporter
  if (transporter) {
    const subject = 'Invitation Vialogues — rejoindre un projet'
    const text = `Vous êtes invité·e à rejoindre un projet Vialogues. Cliquez sur le lien pour activer votre compte et créer un mot de passe (valide 48h):\n\n${inviteLink}`
    try { await transporter.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to: email, subject, text }) } catch(e){ console.error('Invite email failed', e) }
  }
  res.json({ ok: true, inviteLink })
})

// Accept invite: validate token (used by client to prefill email)
app.get('/api/invite/validate', (req, res) => {
  const token = req.query.token
  if (!token) return res.status(400).json({ error: 'Missing token' })
  try {
    const payload = jwt.verify(token, INVITE_SECRET)
    res.json({ ok: true, email: payload.email, projectId: payload.projectId, role: payload.role })
  } catch (e) {
    return res.status(400).json({ error: 'Invalid or expired token' })
  }
})

// Accept invite and set password
app.post('/api/invite/accept', (req, res) => {
  const { token, password, display_name } = req.body
  if (!token || !password) return res.status(400).json({ error: 'Missing token or password' })
  try {
    const payload = jwt.verify(token, INVITE_SECRET)
    const email = payload.email
    // set password_hash for user
    const hash = bcrypt.hashSync(password, 10)
    db.prepare('UPDATE users SET password_hash = ?, display_name = ?, invited = 0 WHERE email = ?').run(hash, display_name || null, email)
    // ensure project_members exists (was created at invite time)
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email)
    if (user) {
      try { db.prepare('INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, ?)').run(payload.projectId, user.id, payload.role || 'annotator') } catch(e){}
    }
    res.json({ ok: true })
  } catch (e) {
    return res.status(400).json({ error: 'Invalid or expired token' })
  }
})

// Videos and uploads
const storage = multer.diskStorage({ destination: (req, file, cb) => cb(null, './uploads'), filename: (req, file, cb) => cb(null, Date.now() + '_' + file.originalname) })
const upload = multer({ storage })

app.post('/api/videos/upload', auth, upload.single('video'), (req, res) => {
  const { project_id, title, description } = req.body
  if (!req.file) return res.status(400).json({ error: 'No file' })
  const filename = req.file.filename
  const info = db.prepare('INSERT INTO videos (project_id, filename, title, description) VALUES (?, ?, ?, ?)').run(project_id, filename, title, description)
  const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(info.lastInsertRowid)
  res.json(video)
})

app.get('/api/videos/:id', auth, (req, res) => {
  const v = db.prepare('SELECT * FROM videos WHERE id = ?').get(req.params.id)
  res.json(v)
})

app.get('/api/videos/project/:projectId', auth, (req, res) => {
  const list = db.prepare('SELECT * FROM videos WHERE project_id = ?').all(req.params.projectId)
  res.json(list)
})

app.get('/uploads/:filename', (req, res) => {
  const fp = path.join(process.cwd(), 'uploads', req.params.filename)
  res.sendFile(path.resolve(fp))
})

// Annotations and notifications
app.post('/api/annotations', auth, async (req, res) => {
  const { video_id, time_seconds, content, category, parent_id } = req.body
  const info = db.prepare('INSERT INTO annotations (video_id, user_id, time_seconds, content, category, parent_id) VALUES (?, ?, ?, ?, ?, ?)').run(video_id, req.user.id, time_seconds, content, category || null, parent_id || null)
  const a = db.prepare('SELECT a.*, u.display_name FROM annotations a LEFT JOIN users u ON a.user_id=u.id WHERE a.id = ?').get(info.lastInsertRowid)
  try {
    const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(video_id)
    if (video) {
      const projectId = video.project_id
      const subject = `Nouvelle annotation sur le projet ${projectId}`
      const text = `${req.user.display_name || req.user.email} a ajouté une annotation au temps ${time_seconds}s :\n\n${content}\n\nVideo: ${video.title || video.filename}\nProject ID: ${projectId}`
      await notifyProjectMembers(projectId, subject, text)
    }
  } catch (e) {
    console.error('Notification error', e)
  }
  res.json(a)
})

app.get('/api/annotations/video/:videoId', auth, (req, res) => {
  const list = db.prepare('SELECT a.*, u.display_name FROM annotations a LEFT JOIN users u ON a.user_id=u.id WHERE a.video_id = ? ORDER BY a.time_seconds').all(req.params.videoId)
  res.json(list)
})

// Export CSV for project
app.get('/api/annotations/export/:projectId', auth, (req, res) => {
  const projectId = req.params.projectId
  const rows = db.prepare(`SELECT an.*, v.title as video_title, u.display_name as author_name FROM annotations an LEFT JOIN videos v ON an.video_id = v.id LEFT JOIN users u ON an.user_id = u.id WHERE v.project_id = ? ORDER BY v.id, an.time_seconds`).all(projectId)
  const header = ['nom_video','timecode','utilisateur','categorie','contenu','parent_id']
  const lines = [header.join(';')]
  rows.forEach(r => {
    const line = [
      (r.video_title || '').replace(/\n/g,' '),
      r.time_seconds || 0,
      (r.author_name || '').replace(/;/g,',').replace(/\n/g,' '),
      (r.category || '').replace(/;/g,','),
      (r.content || '').replace(/\n/g,' ').replace(/;/g,','),
      r.parent_id || ''
    ]
    lines.push(line.join(';'))
  })
  const csv = lines.join('\n')
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="annotations_project_${projectId}.csv"`)
  res.send(csv)
})

// Serve client
app.use('/', express.static(path.join(process.cwd(), 'client')))
app.get('/', (req, res) => { res.sendFile(path.join(process.cwd(), 'client', 'index.html')) })

const port = process.env.PORT || 4000
app.listen(port, () => console.log(`Server started on port ${port}`))
