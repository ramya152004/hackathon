# CertiFlow — Local Setup & Verification Guide

> This guide enables any reviewer or teammate to start CertiFlow from a fresh clone and run all automated verification tests.

---

## 1. Quickstart (Native Node.js Runner)

### Prerequisites
- **Node.js**: v18.0.0 or higher (v20+ recommended)
- **npm**: v9.0.0 or higher

### Step-by-Step Commands
```bash
# 1. Clone the repository
git clone https://github.com/ramya152004/hackathon.git
cd hackathon

# 2. Install dependencies (One-command setup)
npm run setup

# 3. Run all automated tests (49 tests across 7 suites)
npm test

# 4. Start the backend API server
npm start
```
*API and Public Verification Portal will be live at `http://localhost:3000`.*

---

## 2. Interactive Frontend Dashboard Setup

To explore the multi-persona admin dashboard:

```bash
cd frontend/frontend
cp .env.example .env     # demo settings (one-click login with the demo password)
npm install
npm run dev
```

**Login:** username = the persona name (`anika`, `dev`, `meera`, `kabir`, `neha`, `farah`), password = `Certiflow@2026`. In the default demo mode the UI does this for you when you click a person. Set `VITE_DEMO_MODE=false` in `frontend/frontend/.env` to see a real sign-in form.
*Open `http://localhost:5173` in your browser.*

---

## 3. Docker Compose Setup (Single Command)

If you prefer running in containers with PostgreSQL and Redis:

```bash
# Start PostgreSQL 16, Redis 7, and CertiFlow API
docker compose up -d

# Verify health status
docker compose ps
```

---

## 4. Verification Checkpoints

1. **Run Automated Test Suite**:
   ```bash
   npm test
   ```
   Expected output:
   ```text
   ℹ tests 49
   ℹ suites 7
   ℹ pass 49
   ℹ fail 0
   ```

2. **Verify Public Portal**:
   Open [http://localhost:3000/verify?code=PRAGATI-2026-N01-0001](http://localhost:3000/verify?code=PRAGATI-2026-N01-0001) in your browser.

3. **Verify API Health Endpoint**:
   ```bash
   curl http://localhost:3000/api/health
   # {"status":"ok","service":"CertiFlow API"}
   ```
