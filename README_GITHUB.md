Vialogues Clone — V4 Admin + Invite (ready for GitHub)

Contenu: backend (index.js), sqlite schema (db_init.sql), client (client/index.html)

How to push to GitHub:
1. Unzip the project on your machine.
2. Create a new empty repo on GitHub, e.g. "vialogues-clone-v4".
3. From the project folder run:
   git init
   git add .
   git commit -m "V4 admin + invite"
   git branch -M main
   git remote add origin https://github.com/<your_username>/vialogues-clone-v4.git
   git push -u origin main

Replit import:
- In Replit, choose "Import from GitHub" and paste the repo URL.
- Add Replit secrets for SMTP as described in README_REPLIT.md if you want invitation emails.

Environment:
- PUBLIC_URL (optional): base public URL used in invite links (defaults to same origin)
- SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM (for Gmail, use app password)
- JWT_SECRET (optional), INVITE_SECRET (optional)

Demo credentials:
- demo@vialogues.local / admin123
