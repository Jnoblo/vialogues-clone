import express from 'express'
import cors from 'cors'
import sqlite3 from 'better-sqlite3'
import fs from 'fs'
import path from 'path'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcrypt'
import multer from 'multer'

const app = express()
app.use(cors())
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

const DB_FILE = './db.sqlite'
const SECRET = 'demo_secret_key_v1'

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
  const info = db.prepare('INSERT INTO projects (title, description) VALUES (?, ?)').run(title, description)
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(info.lastInsertRowid)
  res.json(project)
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

app.post('/api/annotations', auth, (req, res) => {
  const { video_id, time_seconds, content } = req.body
  const info = db.prepare('INSERT INTO annotations (video_id, user_id, time_seconds, content) VALUES (?, ?, ?, ?)').run(video_id, req.user.id, time_seconds, content)
  const a = db.prepare('SELECT a.*, u.display_name FROM annotations a LEFT JOIN users u ON a.user_id=u.id WHERE a.id = ?').get(info.lastInsertRowid)
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
