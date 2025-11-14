
// V5: Express server with Peertube video URL support and navigation menu
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

// demo admin
const admin = db.prepare("SELECT * FROM users WHERE email = ?").get("demo@vialogues.local")
if (!admin) {
  const hash = bcrypt.hashSync("admin123", 10)
  db.prepare("INSERT INTO users (email,password_hash,role,display_name) VALUES (?,?,?,?)")
    .run("demo@vialogues.local", hash, "admin", "Admin Démo")
}

// SMTP
let transporter = null
if (process.env.SMTP_HOST) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  })
}

function auth(req,res,next){
  const h=req.headers.authorization
  if(!h) return res.status(401).json({error:"Missing token"})
  try{
    const token=h.split(" ")[1]
    req.user=jwt.verify(token,SECRET)
    next()
  }catch(e){ return res.status(401).json({error:"Invalid token"})}
}

// Peertube support: video entry may contain peertube_url instead of file
const upload = multer({ storage: multer.diskStorage({
  destination:(req,file,cb)=>cb(null,"./uploads"),
  filename:(req,file,cb)=>cb(null,Date.now()+"_"+file.originalname)
})})

app.post("/api/videos/upload", auth, upload.single("video"), (req,res)=>{
  const { project_id, title, description, peertube_url } = req.body
  let filename=null
  if(req.file) filename=req.file.filename
  const info = db.prepare(
    "INSERT INTO videos (project_id, filename, title, description, peertube_url) VALUES (?,?,?,?,?)"
  ).run(project_id, filename, title, description, peertube_url||null)
  res.json(db.prepare("SELECT * FROM videos WHERE id=?").get(info.lastInsertRowid))
})

app.get("/api/videos/:id", auth, (req,res)=>{
  res.json(db.prepare("SELECT * FROM videos WHERE id=?").get(req.params.id))
})

app.get("/api/videos/project/:pid", auth, (req,res)=>{
  res.json(db.prepare("SELECT * FROM videos WHERE project_id=?").all(req.params.pid))
})

app.get("/uploads/:f",(req,res)=>{
  res.sendFile(path.resolve("./uploads/"+req.params.f))
})

// Annotations
app.post("/api/annotations", auth, (req,res)=>{
  const {video_id,time_seconds,content,category,parent_id}=req.body
  const info=db.prepare(
    "INSERT INTO annotations (video_id,user_id,time_seconds,content,category,parent_id) VALUES (?,?,?,?,?,?)"
  ).run(video_id,req.user.id,time_seconds,content,category,parent_id)
  res.json(db.prepare("SELECT * FROM annotations WHERE id=?").get(info.lastInsertRowid))
})

app.get("/api/annotations/video/:vid", auth, (req,res)=>{
  res.json(db.prepare(
    "SELECT a.*, u.display_name FROM annotations a LEFT JOIN users u ON a.user_id=u.id WHERE video_id=? ORDER BY time_seconds"
  ).all(req.params.vid))
})

// Projects
app.get("/api/projects", auth,(req,res)=>{
  res.json(db.prepare("SELECT * FROM projects").all())
})

app.post("/api/projects", auth,(req,res)=>{
  const {title,description}=req.body
  const code="PRJ-"+Math.random().toString(36).substring(2,8).toUpperCase()
  const info=db.prepare("INSERT INTO projects (title,description,code) VALUES (?,?,?)").run(title,description,code)
  res.json(db.prepare("SELECT * FROM projects WHERE id=?").get(info.lastInsertRowid))
})

// Auth
app.post("/api/auth/login",(req,res)=>{
  const {email,password}=req.body
  const u=db.prepare("SELECT * FROM users WHERE email=?").get(email)
  if(!u) return res.status(401).json({error:"Invalid"})
  if(!bcrypt.compareSync(password,u.password_hash)) return res.status(401).json({error:"Invalid"})
  const token=jwt.sign(u,SECRET)
  res.json({token,user:u})
})

// CSV export simplified
app.get("/api/export/:pid", auth,(req,res)=>{
  const rows=db.prepare(
    "SELECT v.title as video, a.time_seconds, u.display_name, a.category, a.content FROM annotations a JOIN videos v ON a.video_id=v.id JOIN users u ON a.user_id=u.id WHERE v.project_id=? ORDER BY v.id,a.time_seconds"
  ).all(req.params.pid)
  const csv=["video;time;user;category;content"]
  rows.forEach(r=>csv.push([r.video,r.time_seconds,r.display_name,r.category,r.content.replace(';',',')].join(";")))
  res.setHeader("Content-Type","text/csv")
  res.send(csv.join("\n"))
})

// Serve SPA
app.use("/", express.static("client"))
app.get("*",(req,res)=>res.sendFile(path.resolve("client/index.html")))

app.listen(4000,()=>console.log("V5 running"))
