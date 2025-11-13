Vialogues Clone — V4 Admin + Invite (Replit-ready)

Features:
- Global admin page listing all projects (accessible to users with role 'admin')
- Project administration with invite-by-link (invitation valid 48 hours)
- Users activate account by following the invite link and setting a password
- CSV export, timecode jump, replies, categories included from previous versions

Demo admin:
- email: demo@vialogues.local
- password: admin123

Gmail SMTP setup (Replit secrets):
- SMTP_HOST = smtp.gmail.com
- SMTP_PORT = 587
- SMTP_USER = your_email@gmail.com
- SMTP_PASS = your_app_password (create via Google Account -> Security -> App passwords)
- SMTP_FROM = optional (defaults to SMTP_USER)
- PUBLIC_URL = https://<your-repl-or-domain>  (optional, used to build invite links)

Run:
npm install
npm start
Open at http://localhost:4000 or Replit URL.
