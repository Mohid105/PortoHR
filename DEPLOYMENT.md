# Deploying PortoHR to Hostinger

PortoHR is a Node.js (Express) application that stores its data in MongoDB. It serves its own web pages, so there is
one thing to deploy: the Node process, plus a MongoDB database it can reach.

> **A note on what has and has not been tested.** The app itself (production start-up checks, graceful shutdown,
> reverse-proxy settings, the Docker image, the PM2 and nginx files) was written for and exercised on a standard
> Linux/Node setup. I have not been able to log in to a Hostinger account, so the Hostinger-specific screens below
> follow Hostinger's documented flow for Node.js hosting and VPS plans. Menu names change from time to time; where a
> label differs, look for the closest match, and treat the first deployment as a rehearsal.

---

## 1. Pick your route

| | **A. Hostinger Node.js hosting** | **B. Hostinger VPS** |
|---|---|---|
| What it is | Managed Node.js app in hPanel (Business / Cloud style plans) | Your own Ubuntu server |
| Effort | Lowest: connect GitHub or upload a ZIP, set variables, start | More: you install Node, nginx, PM2, HTTPS |
| Control | Limited (no root, no nginx tuning) | Full |
| MongoDB | **Not included.** Use MongoDB Atlas | Atlas **or** install MongoDB on the same VPS |
| Best for | Getting live quickly with a small team | Larger teams, tighter control, data kept on your own server |

**Hostinger's ordinary shared web hosting (PHP/WordPress) cannot run PortoHR**: it has no long-running Node process and no
MongoDB. You need a plan that explicitly offers Node.js apps, or a VPS.

Either route also works with the included **Docker** image (section 6) on any host.

---

## 2. Before you deploy (every route)

### 2.1 Create the database (MongoDB Atlas)

1. Create a free account at <https://www.mongodb.com/atlas> and a cluster. The free **M0** tier is enough to start; move to a paid tier (which adds automated backups) before you rely on it.
2. **Database Access** → add a database user with a strong password, role *Read and write to any database*.
3. **Network Access** → add the address your app will connect *from*:
   - VPS: the VPS's public IP.
   - Hostinger Node.js hosting: Hostinger does not promise a fixed outgoing IP. Either ask Hostinger support for the app's outgoing IP, or allow `0.0.0.0/0` and rely on the long random database password. The second is common but is the weaker option, so use a password of 24+ random characters.
4. **Connect → Drivers** → copy the connection string and put a database name in it:

   ```
   mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/portohr?retryWrites=true&w=majority
   ```

   If the password contains symbols such as `@ : / ?`, URL-encode them (`@` becomes `%40`).

### 2.2 Settings (environment variables)

The app reads these. Set them in hPanel (route A) or in a `.env` file on the server (route B). Start from [`.env.example`](.env.example).

| Variable | Required | What it does |
|---|---|---|
| `NODE_ENV` | yes | `production`. Turns on the start-up safety checks and blocks the demo seed. |
| `MONGO_URI` | **yes** | The connection string from 2.1. |
| `JWT_SECRET` | **yes** | A random string of at least 32 characters. Changing it signs everyone out. Generate: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `APP_TIMEZONE` | recommended | The company's timezone, e.g. `Asia/Karachi`. Shifts, clock-ins, "today" and month ends follow it, even when the server runs in UTC. Default `Asia/Karachi`. |
| `PORT` | usually set by the host | Port the app listens on. Hostinger Node.js hosting provides it; on a VPS use `5000` behind nginx. |
| `TRUST_PROXY` | recommended | Number of proxies in front of the app. `1` for Hostinger or nginx. Without it, every visitor appears to come from the proxy's IP and the rate limits misfire. |
| `CORS_ORIGIN` | no | Leave **empty** when the pages and API share one domain (the normal case). Never `*` (the app refuses to start). |
| `JWT_EXPIRES_IN` | no | Login lifetime, default `8h`. |
| `API_RATE_LIMIT` | no | Requests per minute per IP, default `600`. |
| `MONGO_POOL_SIZE` | no | Database connections, default `10`. |

The app **refuses to start** in production if `MONGO_URI` or `JWT_SECRET` is missing or weak, or the timezone name is invalid, and the log says exactly which.

### 2.3 What to upload, and what never to

Deploy from Git where you can. If you upload a ZIP or use the File Manager instead, **do not include**:

- `.env` (put settings in the host's panel instead)
- `node_modules/` (the host installs it)
- **`key` and `key.pub`**: these sit in the project folder on the development machine. `key` is a GitHub access token. They are git-ignored and excluded from the Docker image, but a hand-made ZIP will happily include them. Delete the files from any archive you upload.
- `test/`, `devserver.tmp.js`, `deploy/` (harmless, but not needed at runtime)

---

## 3. Route A: Hostinger Node.js hosting

1. In hPanel go to **Websites → Add website → Node.js Apps** (the wording may be "Node.js Web App"). Choose **Import Git repository** (preferred; authorise GitHub and pick the repo and branch) or **Upload your website files** with a ZIP made as in 2.3.
2. Framework: **Express.js** or "Other". Node version: **20 or 22**.
3. Commands:
   - Install: `npm ci --omit=dev` (or `npm install --omit=dev`)
   - Build: *leave empty.* The stylesheet (`public/css/tailwind.css`) is already built and committed.
   - Start: `npm start` (runs `node src/server.js`). Entry file: `src/server.js`.
4. Add the environment variables from 2.2 in the app's **Environment variables** section: at least `NODE_ENV`, `MONGO_URI`, `JWT_SECRET`, `APP_TIMEZONE`, `TRUST_PROXY`.
5. Deploy. Watch the build/runtime log: you should see `MongoDB connected` and `PortoHR listening`.
6. Connect your domain and make sure **HTTPS / free SSL** is switched on for it.
7. Create the first administrator (section 5). Hostinger Node.js plans normally offer a terminal or SSH for this. If yours does not, run the command from your own computer instead: put the production `MONGO_URI` in a local `.env`, run `npm run create-admin -- ...`, then delete that local `.env`.

---

## 4. Route B: Hostinger VPS (Ubuntu 22.04 / 24.04)

Run these as a normal user with `sudo`. Replace `hr.example.com` with your domain and point its DNS **A record** at the VPS first.

**1. Update, firewall, Node.js 20**

```bash
sudo apt update && sudo apt upgrade -y
sudo ufw allow OpenSSH && sudo ufw allow 'Nginx Full' && sudo ufw enable
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs nginx git
sudo npm install -g pm2
```

**2. Get the code**

```bash
sudo mkdir -p /srv/portohr && sudo chown $USER /srv/portohr
git clone <your-repo-url> /srv/portohr && cd /srv/portohr
npm ci --omit=dev
```

**3. Settings.** Copy the template, edit it, and lock it down:

```bash
cp .env.example .env
nano .env            # set MONGO_URI, JWT_SECRET, APP_TIMEZONE; keep PORT=5000 and TRUST_PROXY=1
chmod 600 .env
```

Using a local MongoDB instead of Atlas? Install it from MongoDB's official repository, enable authentication, bind it to `127.0.0.1` only, and use `mongodb://USER:PASSWORD@127.0.0.1:27017/portohr?authSource=admin`. Then you are responsible for backups (section 8).

**4. Create the first administrator** (section 5), then start the app under PM2:

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup          # run the command it prints, so the app restarts after a reboot
pm2 logs portohr --lines 30
```

**5. nginx and HTTPS**

```bash
sudo cp deploy/nginx.portohr.conf /etc/nginx/sites-available/portohr
sudo nano /etc/nginx/sites-available/portohr     # change server_name to your domain
sudo ln -s /etc/nginx/sites-available/portohr /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d hr.example.com           # adds HTTPS and auto-renewal
```

Open `https://hr.example.com/api/health`. It should answer `"success": true` and `"database": "connected"`.

---

## 5. First run

Create the first HR administrator. The demo seed (`npm run seed`) is deliberately **blocked in production**, because it creates accounts with a published password.

```bash
npm run create-admin -- --email=you@company.com --first=Sara --last=Khan
```

It prints a one-time temporary password. Sign in at your domain with that email and password; you are asked to choose a new one straight away. (Optional flags: `--code=EMP-0001`, `--designation="HR Manager"`, `--password=...`.)

Then set the company up, roughly in this order:

1. **Admin → Departments**, locations and the organisation tree. Employees can only be added to departments that exist.
2. **Attendance → Import, periods & rules**: shifts, the attendance policy (grace, overtime, web clock-in rules), and holidays.
3. **Leave** types and entitlements, and **Payroll** settings.
4. Add people: **Core HR → New employee** (one full-screen form for everything), or **Import** a CSV of existing staff.
5. **Admin → Access**: give managers and HR their logins; the new-employee form can create a login and show its temporary password once.
6. Add a **second HR Admin** so the company is never locked out by one lost password.

---

## 6. Docker (any host, including a VPS)

```bash
docker build -t portohr .
docker run -d --name portohr --restart unless-stopped -p 127.0.0.1:5000:5000 --env-file .env portohr
docker exec -it portohr node src/scripts/create-admin.js --email=you@company.com --first=Sara --last=Khan
```

Put nginx (section 4, step 5) in front of it for HTTPS. The image runs as a non-root user and has a health check on `/api/health`.

---

## 7. Updating

```bash
cd /srv/portohr
git pull
npm ci --omit=dev
pm2 restart portohr          # Docker: rebuild the image and re-run; Hostinger Node.js apps: redeploy
```

The app shuts down cleanly on restart (it finishes in-flight requests and closes the database), so a restart takes a few seconds and loses nothing.

Before building a zip, run `npm run stamp`. It puts a fresh version on every stylesheet and script address in the pages, so browsers and Hostinger's cache download the new files instead of showing the old design after an upload.

If you change any page's styling classes during development, run `npm run css:compile` and commit `public/css/tailwind.css` before deploying. Production never runs the build.

---

## 8. Backups: do this before real data goes in

Everything, **including uploaded documents** (they are stored in the database), lives in MongoDB, so a database backup is a full backup.

- **Atlas paid tiers:** turn on *Cloud Backup* (continuous or scheduled snapshots).
- **Atlas free tier / own MongoDB:** schedule a daily dump and copy it off the server:

  ```bash
  mongodump --uri="$MONGO_URI" --gzip --archive=/srv/backups/portohr-$(date +%F).gz
  ```

  Keep at least 14 days, store a copy somewhere other than the same server, and **test a restore** once:
  `mongorestore --uri="mongodb://localhost:27017" --gzip --archive=portohr-DATE.gz --nsFrom='portohr.*' --nsTo='portohr_restore_test.*'`

---

## 9. Security checklist

- [ ] HTTPS on, and `http://` redirects to it.
- [ ] `JWT_SECRET` is a fresh random value, kept only in the server's settings. Not in Git.
- [ ] `.env` is `chmod 600` (VPS) and not in any ZIP or repository.
- [ ] `key` / `key.pub` (the GitHub token) are not on the server and not in any archive. **If that token has ever been shared or committed anywhere, revoke it in GitHub and create a new one.**
- [ ] Atlas network access lists your server (avoid `0.0.0.0/0` where you can), and the database password is long and random.
- [ ] Two HR Admin accounts; every temporary password changed.
- [ ] `CORS_ORIGIN` is empty (or exactly your own site).
- [ ] Backups run and a restore has been tested.
- [ ] `npm audit --omit=dev` is looked at now and then, and the server's OS updates are applied.
- [ ] The nginx / Hostinger firewall exposes only ports 80/443 (and SSH); MongoDB is not open to the internet.

What the app already does for you: strict Content-Security-Policy and security headers, login lockout and rate limits, passwords stored hashed, sessions invalidated on password change or "sign out everywhere", per-role and per-record access checks on every API call, file-type checking on uploads, an audit log, and an export log for every downloaded report.

---

## 10. Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| App exits at start with `Cannot start in production:` | The message lists what is wrong: set `MONGO_URI`, a 32+ character `JWT_SECRET`, a valid `APP_TIMEZONE`, and no `CORS_ORIGIN=*`. |
| `MongoServerSelectionError` / cannot connect | Atlas **Network Access** does not list the server's IP, the password in `MONGO_URI` has unescaped symbols, or the database user lacks rights. |
| nginx shows **502 Bad Gateway** | The Node app is not running: `pm2 status`, `pm2 logs portohr`. Check `PORT` matches the `proxy_pass` port (5000). |
| Everyone gets "Too many requests" | `TRUST_PROXY` is not set, so all visitors share the proxy's IP. Set `TRUST_PROXY=1`. |
| Times, lateness or month ends look off | `APP_TIMEZONE` is wrong for the company. Fix it and restart. Existing records keep the times they were saved with. |
| Document upload fails on large files | nginx `client_max_body_size` is below 6 MB (the sample sets 8 MB), or the file is over the 5 MB limit the app enforces. |
| Everyone was signed out suddenly | `JWT_SECRET` changed (or the app restarted with a different one). They sign in again; nothing is lost. |
| Pages look unstyled | `public/css/tailwind.css` is missing from the upload. Run `npm run css:compile` where Tailwind is installed and deploy the file. |
| `create-admin` says a login already exists | The admin was already created. Ask another HR Admin to reset the password (Admin → Access), or pass a different `--email`. |

---

## 11. Good to know about size and limits

- The app runs as **one process**. Rate limits and login-lockout counters live in that process's memory, so do not run several copies behind a load balancer without moving them to a shared store first. One small VPS or Hostinger Node.js plan comfortably serves a company of a few hundred people.
- Reports read up to 50,000 records at a time and say so when a report is cut short. Add a date or department condition for bigger questions.
- The **Vercel** files in the repository (`vercel.json`, `api/index.js`) are an alternative serverless entry and are **not used** on Hostinger.
