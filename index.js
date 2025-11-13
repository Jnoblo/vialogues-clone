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
const SECRET = process.env.JWT_SECRET || 'demo_secret_key_v2'

if (!fs.existsSync('./uploads')) fs.mkdirSync('./uploads')
if (!fs.existsSync('./client')) fs.mkdirSync('./client')

const db = new sqlite3(DB_FILE)
const schema = fs.readFileSync('./db_init.sql', 'utf8')
db.exec(schema)

const admin = db.prepare('SELECT * FROM users WHERE email = ?').get('demo@vialogues.local')
if (!admin) {
  const hash = bcrypt.hashSync('admin123', 10)
  db.prepare('INSERT INTO users (email, password_hash, role, display_name) VALUES (?, ?, ?, ?)').run('demo@vialogues.local', hash, 'admin', 'Admin Démo')
  console.log('Demo admin created: demo@vialogues.local / admin123')
}

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

function genCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let s = ''
  for (let i=0;i<6;i++) s += chars.charAt(Math.floor(Math.random()*chars.length))
  return 'PRJ-' + s
}

async function notifyProjectMembers(projectId, subject, text) {
  if (!transporter) return
  const rows = db.prepare('SELECT u.email FROM users u JOIN project_members pm ON u.id = pm.user_id WHERE pm.project_id = ?').all(projectId)
  const emails = rows.map(r=>r.email).filter(Boolean)
  if (!emails.length) return
  const mail = {
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: emails.join(','),
    subject,
    text
  }
  try {
    await transporter.sendMail(mail)
  } catch (e) {
    console.error('Failed to send mail', e)
  }
}

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email)
  if (!user) return res.status(401).json({ error: 'Invalid credentials' })
  const ok = bcrypt.compareSync(password, user.password_hash)
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' })
  const token = jwt.sign({ id: user.id, email: user.email, role: user.role, display_name: user.display_name }, SECRET)
  res.json({ token, user: { id: user.id, email: user.email, role: user.role, display_name: user.display_name } })
})

app.get('/api/projects', auth, (req, res) => {
  const projects = db.prepare('SELECT * FROM projects').all()
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

app.get('/api/projects/code/:code', auth, (req, res) => {
  const p = db.prepare('SELECT * FROM projects WHERE code = ?').get(req.params.code)
  if (!p) return res.status(404).json({ error: 'Not found' })
  res.json(p)
})

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, './uploads'),
  filename: (req, file, cb) => cb(null, Date.now() + '_' + file.originalname)
})
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

app.post('/api/annotations', auth, async (req, res) => {
  const { video_id, time_seconds, content, category, parent_id } = req.body
  const info = db.prepare('INSERT INTO annotations (video_id, user_id, time_seconds, content, category, parent_id) VALUES (?, ?, ?, ?, ?, ?)').run(video_id, req.user.id, time_seconds, content, category || null, parent_id || null)
  const a = db.prepare('SELECT a.*, u.display_name FROM annotations a LEFT JOIN users u ON a.user_id=u.id WHERE a.id = ?').get(info.lastInsertRowid)
  try {
    const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(video_id)
    if (video) {
      const projectId = video.project_id
      const subject = `Nouvelle annotation sur le projet ${projectId}`
      const text = `${req.user.display_name || req.user.email} a ajouté une annotation au temps ${time_seconds}s :

${content}

Video: ${video.title || video.filename}
Project ID: ${projectId}`
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

app.use('/', express.static(path.join(process.cwd(), 'client')))

app.get('/', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'client', 'index.html'))
})

const port = process.env.PORT || 4000
app.listen(port, () => console.log(`Server started on port ${port}`))
