import express from 'express'
import cors from 'cors'
import sqlite3 from 'better-sqlite3'
import fs from 'fs'
import path from 'path'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcrypt'

const app = express()
app.use(cors())
app.use(express.json())

const dbFile = './db.sqlite'
const db = new sqlite3(dbFile)
const SECRET = 'demo_secret_key'

// Création de la base si nécessaire
const schema = fs.readFileSync('./db_init.sql', 'utf8')
db.exec(schema)

// Vérifier ou créer un compte démo admin
const adminExists = db.prepare('SELECT * FROM users WHERE email = ?').get('demo@vialogues.local')
if (!adminExists) {
  const hash = bcrypt.hashSync('admin123', 10)
  db.prepare('INSERT INTO users (email, password_hash, role, display_name) VALUES (?, ?, ?, ?)').run('demo@vialogues.local', hash, 'admin', 'Admin Démo')
}

// Middleware auth
function auth(req, res, next) {
  const header = req.headers.authorization
  if (!header) return res.status(401).json({ error: 'Missing token' })
  const token = header.split(' ')[1]
  try {
    const payload = jwt.verify(token, SECRET)
    req.user = payload
    next()
  } catch {
    res.status(401).json({ error: 'Invalid token' })
  }
}

// Routes
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email)
  if (!user) return res.status(401).json({ error: 'Invalid credentials' })
  const ok = bcrypt.compareSync(password, user.password_hash)
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' })
  const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, SECRET)
  res.json({ token, user: { email: user.email, role: user.role } })
})

app.get('/api/projects', auth, (req, res) => {
  const projects = db.prepare('SELECT * FROM projects').all()
  res.json(projects)
})

app.get('/', (req, res) => {
  res.send('<h2>Serveur Vialogues Clone opérationnel 🎬</h2><p>Connectez-vous sur /api/auth/login</p>')
})

const port = process.env.PORT || 4000
app.listen(port, () => console.log(`✅ Serveur lancé sur le port ${port}`))
