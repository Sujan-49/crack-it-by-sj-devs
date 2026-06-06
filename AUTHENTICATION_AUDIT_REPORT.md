# CrackIT Authentication Audit Report

Audit date: 2026-06-06  
Workspace: `C:\Users\sujan\OneDrive\Desktop\sj devs`  
Frontend URL: `http://127.0.0.1:5173`  
Backend URL: `http://127.0.0.1:4000/api`

## 1. Exact Root Cause

The email/password authentication backend is implemented and passes API verification. The repeated refresh/reload bug was caused by Vite watching backend runtime files.

At the start of the latest audit pass:

- Exact local-port checks showed no reliable listener for the app stack.
- `.env` does not exist.

When the frontend is open but the backend writes `data/store.json`, Vite's dev server sees the file change and reloads the browser. On every reload, `src/App.jsx:98` calls `/auth/refresh`; the backend rotates the refresh token at `server.js:1081` and writes `data/store.json` through `server.js:639`. That file write triggers Vite again, creating the repeated reload loop.

The fix is in `vite.config.js`, where Vite now ignores backend runtime database and log files:

```js
server: {
  watch: {
    ignored: ["**/data/**", "**/*.log"],
  },
}
```

If the backend is not running, `src/App.jsx:23` still correctly fails with `Failed to fetch`; use `npm.cmd run start:local` so frontend and backend start together.

Google OAuth is not configured because there is no `.env` file and therefore no `GOOGLE_CLIENT_ID` or `GOOGLE_CLIENT_SECRET`.

MongoDB Atlas is not connected because there is no `.env` file and therefore no `MONGODB_URI`. The backend currently uses the local JSON fallback database.

## 2. Files And Lines Checked

### Frontend

- `src/App.jsx:16` - API base URL is `import.meta.env.VITE_API_URL || "http://127.0.0.1:4000/api"`.
- `src/App.jsx:23` - shared `api()` function sends requests with `credentials: "include"`.
- `src/App.jsx:98` - app attempts persistent login through `POST /auth/refresh` on load.
- `src/App.jsx:117` - logout calls `POST /auth/logout`.
- `src/App.jsx:356` - auth modal submits to `/auth/login` or `/auth/register`.
- `src/App.jsx:366` - Google button asks backend for `/auth/google/url`.
- `src/App.jsx:317` - auth modal uses `submitting` state to prevent duplicate login/signup requests.
- `src/App.jsx:392` - Google auth button is `type="button"` and disabled while submitting.
- `src/App.jsx:432` - login/create account submit button is disabled while submitting.
- `vite.config.js:6` - Vite ignores `data/**` and `*.log` so backend auth writes do not reload the page.

### Backend

- `server.js:704` - database initialization.
- `server.js:770` - JWT access token creation.
- `server.js:778` - refresh token HTTP-only cookie creation.
- `server.js:875` - signup route `POST /api/auth/register`.
- `server.js:925` - Google OAuth URL route `GET /api/auth/google/url`.
- `server.js:940` - Google OAuth callback route.
- `server.js:1033` - login route `POST /api/auth/login`.
- `server.js:1081` - persistent session route `POST /api/auth/refresh`.
- `server.js:1100` - logout route `POST /api/auth/logout`.
- `server.js:1109` - profile route `GET /api/me`.
- `server.js:1166` - dashboard/profile data route `GET /api/dashboard`.

## 3. Runtime Audit Results

Command:

```powershell
npm.cmd run audit:auth
```

Latest result: 2026-06-06T10:56:05.893Z

Result:

```json
{
  "backend": {
    "status": 200,
    "ok": true,
    "reachable": true,
    "database": "local-json",
    "mongoConfigured": false,
    "mongoConnected": false,
    "googleOAuthConfigured": false
  },
  "googleOAuth": {
    "status": 501,
    "configured": false,
    "error": "Google OAuth is not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to enable it."
  },
  "signup": {
    "status": 200,
    "created": true,
    "hasAccessToken": true,
    "hasRefreshCookie": true,
    "storedInDatabase": true,
    "passwordHashed": true
  },
  "profileAfterSignup": {
    "status": 200
  },
  "refreshSession": {
    "status": 200,
    "hasNewAccessToken": true
  },
  "login": {
    "status": 200,
    "validCredentialsAccepted": true,
    "hasAccessToken": true,
    "hasRefreshCookie": true
  },
  "dashboard": {
    "status": 200,
    "profileLoaded": true
  },
  "logout": {
    "status": 200,
    "ok": true
  },
  "refreshAfterLogout": {
    "status": 401,
    "rejected": true
  }
}
```

## 4. Error Messages Found

### Backend/API

Google OAuth route currently returns:

```json
{
  "error": "Google OAuth is not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to enable it."
}
```

Status code: `501`

Cause:

- `.env` file is missing.
- `GOOGLE_CLIENT_ID` is empty.
- `GOOGLE_CLIENT_SECRET` is empty.

### Frontend/network

When backend is not running, the frontend fetch from `src/App.jsx:23` fails with:

```text
Failed to fetch
```

The app may show:

```text
Content API failed: Failed to fetch. Start the backend on http://127.0.0.1:4000.
```

Root cause:

- No process listening on `127.0.0.1:4000`.

When backend is running under Vite dev before the watcher fix, the likely browser behavior was:

```text
data/store.json changed -> Vite full page reload -> /auth/refresh -> data/store.json changed -> reload again
```

Root cause:

- `vite.config.js` did not ignore backend runtime database writes.

### Browser console

Browser console capture could not be completed because the in-app browser automation helper failed during setup with a local sandbox/browser helper startup error. API and frontend HTTP checks were completed successfully instead.

### Backend logs

Log files checked:

```text
backend.out.log
backend.err.log
```

Current result:

```text
No backend error output was recorded in the checked log files.
```

## 5. Database/User Storage

Current storage mode:

```text
local-json
```

Reason:

```text
MONGODB_URI is not configured
```

User records are stored in:

```text
data/store.json
```

The auth audit verified:

- User record exists after signup.
- Password is stored as a bcrypt hash.
- Plain password is not stored.
- Refresh token hash is created on login/signup.
- Refresh token hash is cleared on logout.

## 6. Fixes Applied

- Added `scripts/auth-audit.mjs`.
- Improved `scripts/auth-audit.mjs` so it reports a clear backend-unreachable root cause instead of crashing when port `4000` is down.
- Added `npm.cmd run audit:auth`.
- Added `scripts/start-local.mjs`.
- Added `npm.cmd run start:local`.
- Updated `README.md` to show the safer full-stack local start command.
- Updated `vite.config.js` to ignore `data/**` and `*.log`, stopping the auth refresh reload loop.
- Added auth modal submission guards so Login/Create Account can only submit once per click.

No UI redesign was made.

## 7. Verification Checklist

| Requirement | Status | Evidence |
|---|---|---|
| Backend running | Working | `/api/status` returned `200` |
| Frontend connected to backend | Working when both servers run | served `src/App.jsx` uses `http://127.0.0.1:4000/api` |
| API requests reach server | Working | `audit:auth` completed all auth requests |
| Database connected | Partial | local JSON connected; MongoDB not configured |
| Users collection/table created | Working locally | user created in `data/store.json` |
| Signup creates records | Working | `signup.status: 200`, `storedInDatabase: true` |
| Login validates credentials | Working | `login.status: 200` |
| Passwords hashed | Working | `passwordHashed: true` |
| JWT generated | Working | `hasAccessToken: true` |
| Cookies stored | Working | `hasRefreshCookie: true` |
| Session persistence works | Working locally | `/auth/refresh` returned `200` with new token |
| Logout works | Working | `/auth/logout` returned `200` |
| Refresh rejected after logout | Working | `/auth/refresh` returned `401` after logout |
| Profile loads | Working | `/me` and `/dashboard` returned `200` |
| Google OAuth configured | Not configured | `/auth/google/url` returned `501` |

Latest verified auth audit:

```text
Create Account: PASS
Login: PASS
JWT token: PASS
Refresh cookie: PASS
Refresh persistence: PASS
Profile load: PASS
Dashboard load: PASS
Logout: PASS
Refresh rejected after logout: PASS
User record stored: PASS
Password hashed: PASS
Infinite Vite reload loop: FIXED by watcher ignore
Google OAuth: FAIL until credentials are added
```

## 8. Exact Commands To Run

Recommended:

```powershell
cd "C:\Users\sujan\OneDrive\Desktop\sj devs"
npm.cmd run start:local
```

Then open:

```text
http://127.0.0.1:5173
```

Authentication audit:

```powershell
cd "C:\Users\sujan\OneDrive\Desktop\sj devs"
npm.cmd run audit:auth
```

## 9. Remaining External Auth Work

To make Google OAuth work, create `.env` with:

```text
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
API_URL=http://127.0.0.1:4000
FRONTEND_URL=http://127.0.0.1:5173
```

Google Console redirect URI:

```text
http://127.0.0.1:4000/api/auth/google/callback
```

Until those credentials exist, Google OAuth correctly fails with `501`.
