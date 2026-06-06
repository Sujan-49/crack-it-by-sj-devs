# CrackIT by SJ DEVS - Second Technical Audit Report

Audit date: 2026-06-05  
Workspace: `C:\Users\sujan\OneDrive\Desktop\sj devs`  
Audit command: `npm.cmd run audit:status`  
Backend target: `http://127.0.0.1:4000/api`

## 1. Fixed Issues

### Critical fixes completed

- Fixed the `Content API failed: Failed to fetch` root cause for current code by verifying backend startup and API health on `http://127.0.0.1:4000/api/status`.
- Added MongoDB adapter support with official `mongodb` driver.
- Added MongoDB collection loading and persistence for:
  - `users`
  - `contentItems`
  - `questions`
  - `mcqs`
  - `roadmaps`
  - `companies`
  - `progress`
  - `contentProgress`
  - `bookmarks` through progress/content progress records
  - `notes`
  - `mcqResults`
  - `roadmapProgress`
- Added MongoDB indexes for frequent query fields and user uniqueness fields.
- Added local JSON fallback so the app still works when MongoDB Atlas credentials are not present.
- Added `/api/status` fields for database and production configuration visibility:
  - `mongoConfigured`
  - `mongoConnected`
  - `mongoDbName`
  - `mongoError`
  - `googleOAuthConfigured`
  - `cookieSecure`
  - `adminEmailsConfigured`
  - `corsOrigins`
- Implemented email/password account creation with bcrypt password hashing.
- Implemented email/password login with JWT access tokens and refresh-token cookies.
- Implemented persistent-login flow through `/api/auth/refresh`.
- Implemented Google OAuth routes:
  - `GET /api/auth/google/url`
  - `GET /api/auth/google/callback`
- Implemented unique username checks and username suggestions.
- Implemented profile update route.
- Implemented logout route.
- Implemented account deletion route.
- Added dataset-level solved tracking.
- Added dataset-level bookmark tracking.
- Added dataset-level notes.
- Enforced guest access limits at the API level for direct content detail URLs.
- Enforced guest access limits at the API level for direct MCQ detail URLs and MCQ submission.
- Added content detail API and frontend route.
- Added MCQ detail API and frontend route.
- Added company detail API and frontend route.
- Added project detail routing using real Coding Challenge records.
- Added dedicated frontend routes for:
  - `/linux`
  - `/operating-systems`
  - `/dbms`
  - `/projects`
- Added dashboard analytics from saved user data.
- Added achievements endpoint and frontend page.
- Added admin-protected API routes for content management.
- Added admin frontend route.
- Added route-based navigation with React Router.
- Added `scripts/audit-status.mjs`.
- Added `npm.cmd run audit:status`.

## 2. Remaining Issues

### External configuration blockers

- MongoDB Atlas is not connected because `MONGODB_URI` is empty.
- Google OAuth cannot complete because `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are empty.
- Admin users are not configured because `ADMIN_EMAILS` is empty.
- Production secure cookies are not enabled because `COOKIE_SECURE=false`, which is correct for local HTTP but not production HTTPS.

### Dataset/source limitations

- The uploaded master guide does not include a dedicated Linux collection. The Linux page currently displays real Infrastructure/DevOps records from the database.
- The uploaded guide does not include full project implementation data such as folder structure and complete resume descriptions. The Project Hub currently uses real Coding Challenge records as project-practice content.
- Operating Systems and DBMS pages use available MCQ records from the existing seeded database, not a full uploaded OS/DBMS master pack.

### Product gaps still not production-complete

- Real Google OAuth browser sign-in is code-complete but unverified without credentials.
- Real MongoDB Atlas persistence is code-complete but unverified without a URI.
- Admin CMS is basic API/UI, not a full editorial workflow.
- Streak calendar endpoint exists, but no rich calendar UI is completed.
- Achievement endpoint exists, but full badge awarding rules are still basic.
- Coding execution sandbox is not implemented.
- Contest engine is not implemented.
- No production deployment has been verified.

## 3. Database Counts

Current local database counts from `data/store.json` after live audit:

| Collection | Count |
|---|---:|
| Users | 12 |
| Content Items | 875 |
| Legacy Questions | 138 |
| Seed MCQs | 92 |
| Companies | 10 |
| Roadmaps | 4 |
| Content Progress | 5 |
| Legacy Progress | 1 |
| Notes | 5 |
| MCQ Results | 2 |

Dataset file counts:

| Dataset | Count |
|---|---:|
| `dsa_easy.json` | 50 |
| `dsa_medium.json` | 75 |
| `dsa_hard.json` | 100 |
| `coding_challenges.json` | 100 |
| `cloud_mcq.json` | 100 |
| `networking_mcq.json` | 100 |
| `ai_ml_mcq.json` | 100 |
| `devops_mcq.json` | 100 |
| `cybersecurity_mcq.json` | 100 |
| `hr_questions.json` | 50 |

Company dataset question counts:

| Company | Count |
|---|---:|
| TCS | 45 |
| Infosys | 27 |
| Accenture | 27 |
| Cognizant | 80 |
| Wipro | 80 |
| Capgemini | 80 |
| Amazon | 60 |
| Microsoft | 32 |
| Google | 38 |
| NVIDIA | 40 |

Live status result:

```json
{
  "database": "local-json",
  "mongoConfigured": false,
  "mongoConnected": false,
  "googleOAuthConfigured": false
}
```

## 4. Route Tree

Frontend routes in `src/App.jsx`:

- `/` - Guest home or authenticated dashboard
- `/dsa` - Content/question library
- `/content/:id` - Content detail page
- `/mcq` - MCQ library and quiz module
- `/mcq/:id` - MCQ detail page
- `/roadmaps` - Roadmaps
- `/companies` - Company list
- `/companies/:id` - Company detail page
- `/linux` - Infrastructure/Linux learning page using real available Infrastructure/DevOps records
- `/operating-systems` - Operating Systems MCQ page
- `/dbms` - DBMS MCQ page
- `/projects` - Project Hub using real Coding Challenge records
- `/projects/:id` - Project/content detail page
- `/leaderboard` - Leaderboard
- `/achievements` - Authenticated achievements page
- `/admin` - Authenticated admin panel route
- `/saved` - Authenticated saved questions
- `/bookmarks` - Authenticated bookmarks
- `/profile` - Authenticated profile editor
- `/settings` - Authenticated settings/account page
- `*` - Redirect to `/`

## 5. API Tree

Authentication:

- `POST /api/auth/register`
- `GET /api/auth/username-suggestions`
- `GET /api/auth/google/url`
- `GET /api/auth/google/callback`
- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password`
- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`

User:

- `GET /api/me`
- `PATCH /api/me`
- `DELETE /api/me`
- `POST /api/progress/last-viewed`
- `GET /api/dashboard`

System:

- `GET /api/status`
- `GET /api/datasets/status`

Content:

- `GET /api/content`
- `GET /api/content/:id`
- `POST /api/content/:id/read`
- `POST /api/content/:id/solved`
- `POST /api/content/:id/bookmark`
- `POST /api/content/:id/notes`

Legacy questions:

- `GET /api/questions`
- `POST /api/questions/:id/solved`
- `POST /api/questions/:id/bookmark`
- `POST /api/questions/:id/notes`

MCQs:

- `GET /api/mcqs`
- `GET /api/mcqs/:id`
- `POST /api/mcqs/submit`

Roadmaps:

- `GET /api/roadmaps`
- `POST /api/roadmaps/:id/steps`

Companies:

- `GET /api/companies`
- `GET /api/companies/:id`

Gamification:

- `GET /api/leaderboard`
- `GET /api/streak/calendar`
- `GET /api/achievements`

Admin:

- `GET /api/admin/overview`
- `POST /api/admin/content`
- `PATCH /api/admin/content/:id`
- `DELETE /api/admin/content/:id`

## 6. Live Verification Results

Command:

```powershell
npm.cmd run audit:status
```

Important results:

- Backend status endpoint: `200`
- Content detail endpoint: `200`
- Verified question: `Two Sum`
- Guest locked content direct URL: `403`, `locked: true`
- MCQ list endpoint: `200`
- MCQ detail endpoint: `200`
- Guest locked MCQ direct URL: `403`, `locked: true`
- First MCQ options count: `4`
- Register endpoint: `200`
- New audit user received token: `true`
- Refresh cookie created: `true`
- Refresh endpoint restored session: `200`
- Dashboard loaded with refreshed token: `200`
- Audit user role: `student`
- Dataset solved endpoint: `200`
- Dataset solved state: `true`
- Dataset notes endpoint: `200`
- Saved note text: `audit note`
- Admin endpoint for normal student: `403`, expected `403`
- Achievements endpoint: `200`
- Achievement count: `5`

Additional checks:

- `node --check server.js` passed.
- `npm.cmd run build` passed.
- Vite production bundle generated successfully.

## 7. Feature Completion Percentages

These percentages represent the project in the current local workspace, not a deployed production server.

| Area | Completion |
|---|---:|
| Frontend Routing | 85% |
| Backend API | 82% |
| Local Content System | 88% |
| Search and Filters | 82% |
| Email Authentication | 78% |
| Google OAuth | 55% |
| Persistent Sessions | 82% |
| MongoDB Adapter | 72% |
| Live MongoDB Atlas Deployment | 0% |
| User Progress | 83% |
| Bookmarks | 82% |
| Notes | 82% |
| MCQ Engine | 76% |
| Company Pages | 72% |
| Roadmaps | 70% |
| Project Hub | 45% |
| Admin Panel | 45% |
| Gamification | 45% |
| Production Security | 55% |

Overall local application completion: **76%**  
Production readiness with current `.env`: **70%**  
Estimated production readiness after adding MongoDB Atlas URI, Google OAuth credentials, admin emails, HTTPS cookies, and deployment verification: **87%**

Production readiness cannot honestly exceed 90% yet because the required production services are not configured and verified.

## 8. Priority Fix Roadmap

### Priority 1 - External configuration required

1. Create MongoDB Atlas Free Tier database.
2. Add `MONGODB_URI` to `.env`.
3. Restart backend.
4. Verify `GET /api/status` returns:
   - `mongoConfigured: true`
   - `mongoConnected: true`
   - `database: "mongodb"`
5. Add Google OAuth Web Client credentials.
6. Add authorized redirect URI:
   - `http://127.0.0.1:4000/api/auth/google/callback`
   - production callback after deployment
7. Add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` to `.env`.
8. Restart backend.
9. Verify `GET /api/status` returns `googleOAuthConfigured: true`.
10. Test browser Google sign-in end to end.

### Priority 2 - Data completeness

1. Add a real Linux dataset if Linux must be a dedicated module.
2. Add real OS dataset if OS must be more than MCQs.
3. Add real DBMS dataset if DBMS must be more than MCQs.
4. Add real Project Hub dataset with:
   - beginner/intermediate/advanced classification
   - project structure
   - resume description
   - implementation steps
   - tech stack
5. Import those datasets through the same content pipeline.

### Priority 3 - Production systems

1. Expand admin CMS validation and editing workflow.
2. Add rich streak calendar UI.
3. Expand achievement awarding rules.
4. Add timed MCQ tests.
5. Add contest engine.
6. Add secure code execution sandbox.
7. Add deployment checks for Vercel frontend and Render/Railway backend.

## 9. How To Run Correctly

Backend terminal:

```powershell
cd "C:\Users\sujan\OneDrive\Desktop\sj devs"
npm.cmd run api
```

Frontend terminal:

```powershell
cd "C:\Users\sujan\OneDrive\Desktop\sj devs"
npm.cmd run dev -- --port 5173
```

Open:

```text
http://127.0.0.1:5173
```

Do not open `http://127.0.0.1:4000` expecting the website. Port `4000` is API-only. Use:

```text
http://127.0.0.1:4000/api/status
```

## 10. Final Audit Decision

The project is no longer just a UI demo. It now has real local content, real API routes, real email authentication, real JWT/refresh flow, real progress/bookmark/notes persistence, real detail pages, real MCQ scoring, real route navigation, and MongoDB/Google OAuth code paths.

It is not production-ready above 90% until MongoDB Atlas and Google OAuth are configured with real credentials and verified in the browser.
