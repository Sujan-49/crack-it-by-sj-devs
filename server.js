import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { MongoClient } from "mongodb";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, "data");
const datasetDir = join(dataDir, "datasets");
const dbPath = join(dataDir, "store.json");

function loadLocalEnv() {
  const envPath = join(__dirname, ".env");
  if (!existsSync(envPath)) return;
  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [key, ...valueParts] = trimmed.split("=");
    if (!process.env[key]) process.env[key] = valueParts.join("=").replace(/^["']|["']$/g, "");
  }
}

loadLocalEnv();

const datasetFiles = [
  "dsa_easy.json",
  "dsa_medium.json",
  "dsa_hard.json",
  "coding_challenges.json",
  "dsa_mcq.json",
  "os_mcq.json",
  "dbms_mcq.json",
  "linux_mcq.json",
  "system_design_mcq.json",
  "cloud_mcq.json",
  "networking_mcq.json",
  "ai_ml_mcq.json",
  "devops_mcq.json",
  "cybersecurity_mcq.json",
  "hr_questions.json",
];
const masterPackPaths = [
  "C:\\Users\\sujan\\.codex\\attachments\\11d4680d-e438-41a0-9937-8faf0346bf4b\\pasted-text.txt",
  "C:\\Users\\sujan\\.codex\\attachments\\a422aaf7-ffb7-44bc-85eb-60321e7bdce2\\pasted-text.txt",
  "C:\\Users\\sujan\\.codex\\attachments\\986f5bfd-780c-4fd6-81b3-88781244b790\\pasted-text.txt",
];
const JWT_SECRET = process.env.JWT_SECRET || "crackit-local-dev-secret";
const REFRESH_SECRET = process.env.REFRESH_SECRET || "crackit-local-refresh-secret";
const FRONTEND_URL = process.env.FRONTEND_URL || "http://127.0.0.1:5173";
const API_URL = process.env.API_URL || "http://127.0.0.1:4000";
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const MONGODB_URI = process.env.MONGODB_URI || "";
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME || "crackit";
const MONGODB_STRICT = String(process.env.MONGODB_STRICT || "false").toLowerCase() === "true";
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "").split(",").map((email) => email.trim().toLowerCase()).filter(Boolean);
const COOKIE_SECURE = String(process.env.COOKIE_SECURE || "false").toLowerCase() === "true";
const CORS_ORIGINS = (process.env.CORS_ORIGINS || "http://127.0.0.1:5173,http://127.0.0.1:5174,http://localhost:5173,http://localhost:5174")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const app = express();

let activeDb = null;
let mongoClient = null;
let mongoDatabase = null;
let mongoPersistTimer = null;
let mongoReady = false;
let mongoError = "";

const mongoCollections = [
  "users",
  "contentItems",
  "questions",
  "mcqs",
  "roadmaps",
  "companies",
  "progress",
  "contentProgress",
  "mcqResults",
  "notes",
  "roadmapProgress",
];

app.use(cors({ origin: CORS_ORIGINS, credentials: true }));
app.use(express.json({ limit: "1mb" }));

const today = () => new Date().toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.floor((new Date(b) - new Date(a)) / 86400000);
const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const normalizeUsername = (text) => slug(text).replaceAll("-", "") || "user";
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const strongPasswordPattern = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
const rateBuckets = new Map();
const GUEST_UNLOCK_PERCENT = 35;

const contentReferenceNote = "Content is extracted from the uploaded Ultimate Tech Interview Master Guide. Company tags are preparation signals and can vary by year, role, campus, team, and interviewer.";
const learningResources = {
  default: {
    youtube: [
      { title: "freeCodeCamp", url: "https://www.youtube.com/@freecodecamp", note: "Long-form coding courses for beginners and revision." },
      { title: "Fireship", url: "https://www.youtube.com/@Fireship", note: "Fast explainers for modern developer tools and trends." },
      { title: "The Net Ninja", url: "https://www.youtube.com/@NetNinja", note: "Clean web development playlists with project practice." },
    ],
    docs: [
      { title: "MDN Web Docs", url: "https://developer.mozilla.org/", note: "Best free reference for HTML, CSS, JavaScript, and browser APIs." },
      { title: "roadmap.sh", url: "https://roadmap.sh/", note: "Visual roadmaps for software, DevOps, backend, frontend, and AI paths." },
      { title: "GitHub Docs", url: "https://docs.github.com/", note: "Git, GitHub Actions, collaboration, and project publishing." },
    ],
    certificates: [
      { title: "freeCodeCamp Certifications", url: "https://www.freecodecamp.org/learn/", note: "Free certificates for web, JavaScript, data, backend, and more." },
      { title: "GitHub Foundations", url: "https://resources.github.com/learn/certifications/", note: "Good entry certificate for GitHub workflow and collaboration." },
    ],
  },
  dsa: {
    youtube: [
      { title: "takeUforward", url: "https://www.youtube.com/@takeUforward", note: "DSA sheets, interview patterns, and company prep." },
      { title: "NeetCode", url: "https://www.youtube.com/@NeetCode", note: "Pattern-based LeetCode explanations." },
      { title: "Abdul Bari", url: "https://www.youtube.com/@abdul_bari", note: "Algorithms explained from fundamentals." },
    ],
    docs: [
      { title: "CP-Algorithms", url: "https://cp-algorithms.com/", note: "Competitive programming algorithms with implementation notes." },
      { title: "VisuAlgo", url: "https://visualgo.net/en", note: "Animated data structure and algorithm visualizations." },
    ],
    certificates: [
      { title: "HackerRank Problem Solving Basic", url: "https://www.hackerrank.com/skills-verification/problem_solving_basic", note: "Short certificate useful for fundamentals." },
      { title: "HackerRank Problem Solving Intermediate", url: "https://www.hackerrank.com/skills-verification/problem_solving_intermediate", note: "Better after arrays, strings, trees, graphs, and DP practice." },
    ],
  },
  web: {
    youtube: [
      { title: "Kevin Powell", url: "https://www.youtube.com/@KevinPowell", note: "Modern CSS and layout mastery." },
      { title: "Web Dev Simplified", url: "https://www.youtube.com/@WebDevSimplified", note: "Practical React, JavaScript, and web app concepts." },
      { title: "JavaScript Mastery", url: "https://www.youtube.com/@javascriptmastery", note: "Full-stack project builds and deployment workflows." },
    ],
    docs: [
      { title: "React Docs", url: "https://react.dev/", note: "Official React learning and API reference." },
      { title: "Node.js Learn", url: "https://nodejs.org/en/learn", note: "Official Node.js guides and backend concepts." },
      { title: "Express Docs", url: "https://expressjs.com/", note: "Routing, middleware, APIs, and server basics." },
    ],
    certificates: [
      { title: "Meta Front-End Developer", url: "https://www.coursera.org/professional-certificates/meta-front-end-developer", note: "Industry-recognized frontend path." },
      { title: "freeCodeCamp Responsive Web Design", url: "https://www.freecodecamp.org/learn/2022/responsive-web-design/", note: "Free proof for HTML/CSS foundations." },
    ],
  },
  cloud: {
    youtube: [
      { title: "AWS Events", url: "https://www.youtube.com/@AWSEventsChannel", note: "AWS service explainers and architecture sessions." },
      { title: "Microsoft Azure", url: "https://www.youtube.com/@MicrosoftAzure", note: "Azure fundamentals and real cloud patterns." },
      { title: "Google Cloud Tech", url: "https://www.youtube.com/@googlecloudtech", note: "Cloud infrastructure, data, and AI platform videos." },
    ],
    docs: [
      { title: "AWS Skill Builder", url: "https://skillbuilder.aws/", note: "Official AWS learning paths." },
      { title: "Microsoft Learn", url: "https://learn.microsoft.com/training/", note: "Free Azure, cloud, and developer learning modules." },
      { title: "Google Cloud Skills Boost", url: "https://www.cloudskillsboost.google/", note: "Hands-on Google Cloud labs and learning paths." },
    ],
    certificates: [
      { title: "AWS Certified Cloud Practitioner", url: "https://aws.amazon.com/certification/certified-cloud-practitioner/", note: "Best beginner cloud certificate." },
      { title: "Microsoft Azure Fundamentals AZ-900", url: "https://learn.microsoft.com/en-us/credentials/certifications/exams/az-900/", note: "Beginner Azure certificate for placement resumes." },
      { title: "Google Cloud Digital Leader", url: "https://cloud.google.com/learn/certification/cloud-digital-leader", note: "Beginner Google Cloud certificate." },
    ],
  },
  devops: {
    youtube: [
      { title: "TechWorld with Nana", url: "https://www.youtube.com/@TechWorldwithNana", note: "Docker, Kubernetes, CI/CD, and DevOps explained clearly." },
      { title: "KodeKloud", url: "https://www.youtube.com/@KodeKloud", note: "DevOps labs, Linux, Kubernetes, and cloud practice." },
      { title: "Bret Fisher", url: "https://www.youtube.com/@BretFisher", note: "Docker and container operations." },
    ],
    docs: [
      { title: "Docker Docs", url: "https://docs.docker.com/", note: "Official Docker guides and Compose references." },
      { title: "Kubernetes Docs", url: "https://kubernetes.io/docs/home/", note: "Official Kubernetes concepts and tasks." },
      { title: "GitHub Actions Docs", url: "https://docs.github.com/actions", note: "CI/CD pipelines for student projects." },
    ],
    certificates: [
      { title: "CKAD", url: "https://training.linuxfoundation.org/certification/certified-kubernetes-application-developer-ckad/", note: "Strong Kubernetes developer certificate." },
      { title: "Docker Foundations", url: "https://www.docker.com/certification/", note: "Useful Docker learning/certification direction." },
    ],
  },
  cybersecurity: {
    youtube: [
      { title: "John Hammond", url: "https://www.youtube.com/@_JohnHammond", note: "CTFs, malware analysis, and security practice." },
      { title: "NetworkChuck", url: "https://www.youtube.com/@NetworkChuck", note: "Networking and cybersecurity beginner projects." },
      { title: "PortSwigger", url: "https://www.youtube.com/@PortSwiggerTV", note: "Web security and Burp Suite learning." },
    ],
    docs: [
      { title: "OWASP Top 10", url: "https://owasp.org/www-project-top-ten/", note: "Must-know web security risks." },
      { title: "PortSwigger Web Security Academy", url: "https://portswigger.net/web-security", note: "Free hands-on web security labs." },
      { title: "TryHackMe", url: "https://tryhackme.com/", note: "Beginner-friendly security labs and rooms." },
    ],
    certificates: [
      { title: "ISC2 Certified in Cybersecurity", url: "https://www.isc2.org/certifications/cc", note: "Good entry-level cybersecurity certificate." },
      { title: "CompTIA Security+", url: "https://www.comptia.org/certifications/security", note: "Popular baseline security certificate." },
    ],
  },
  ai: {
    youtube: [
      { title: "StatQuest", url: "https://www.youtube.com/@statquest", note: "Machine learning and statistics made simple." },
      { title: "3Blue1Brown", url: "https://www.youtube.com/@3blue1brown", note: "Math intuition for linear algebra and neural networks." },
      { title: "Krish Naik", url: "https://www.youtube.com/@krishnaik06", note: "AI/ML projects, data science, and interview prep." },
    ],
    docs: [
      { title: "scikit-learn User Guide", url: "https://scikit-learn.org/stable/user_guide.html", note: "Core ML algorithms and examples." },
      { title: "Hugging Face Learn", url: "https://huggingface.co/learn", note: "Transformers, NLP, LLMs, and practical AI workflows." },
      { title: "Kaggle Learn", url: "https://www.kaggle.com/learn", note: "Free data science and ML micro-courses." },
    ],
    certificates: [
      { title: "Google Professional ML Engineer", url: "https://cloud.google.com/learn/certification/machine-learning-engineer", note: "Advanced certificate after ML and cloud basics." },
      { title: "IBM Data Science Professional Certificate", url: "https://www.coursera.org/professional-certificates/ibm-data-science", note: "Good structured data science path." },
    ],
  },
};

const productProjects = [
  {
    id: "placement-command-center",
    level: "Advanced",
    title: "Placement Command Center",
    oneLine: "A real student dashboard that tracks DSA, MCQs, projects, resumes, and company readiness.",
    audience: "Final year students, placement cells, and coding clubs.",
    techStack: ["React", "Node.js", "Express", "MongoDB", "JWT", "Chart.js"],
    features: ["Student profile and progress timeline", "DSA and MCQ completion tracker", "Company readiness score", "Weekly goals", "Exportable progress report"],
    database: ["users", "progress", "mcq_results", "projects", "company_readiness", "weekly_goals"],
    apis: ["GET /api/dashboard", "POST /api/progress", "GET /api/readiness", "POST /api/goals", "GET /api/reports/export"],
    architecture: "Frontend dashboard talks to REST APIs, APIs calculate progress from saved attempts, MongoDB stores every user action.",
    buildPlan: ["Design dashboard data model", "Create progress APIs", "Connect DSA and MCQ events", "Build readiness scoring rules", "Add PDF/print report"],
    resumeDescription: "Built a full-stack placement analytics platform that tracks student learning progress, predicts company readiness, and generates weekly improvement plans.",
    interviewQuestions: ["How did you calculate readiness score?", "How do you prevent duplicate progress records?", "How would this scale for 10,000 students?"],
  },
  {
    id: "local-ats-resume-analyzer",
    level: "Intermediate",
    title: "Offline ATS Resume Analyzer",
    oneLine: "A free resume checker that scores resumes using rules, keywords, skills, and project strength.",
    audience: "Freshers preparing resumes without paid tools.",
    techStack: ["React", "Node.js", "PDF.js", "MongoDB", "Tailwind"],
    features: ["PDF upload", "Keyword extraction", "ATS score", "Missing skills", "Project quality score", "Improvement checklist"],
    database: ["resume_reports", "keyword_sets", "job_roles", "user_profiles"],
    apis: ["POST /api/resume/analyze", "GET /api/resume/reports", "GET /api/roles/:id/keywords"],
    architecture: "PDF text is parsed locally, scored with transparent rules, and reports are saved for comparison over time.",
    buildPlan: ["Parse PDF text", "Create role keyword sets", "Score sections and skills", "Show missing keywords", "Store previous reports"],
    resumeDescription: "Created an offline ATS resume analyzer that parses PDF resumes, scores role fit, detects missing keywords, and suggests practical improvements.",
    interviewQuestions: ["How do you parse PDF reliably?", "What scoring rules did you use?", "How would you reduce false positives?"],
  },
  {
    id: "college-coding-arena",
    level: "Advanced",
    title: "College Coding Arena",
    oneLine: "A contest platform for colleges with MCQs, coding rounds, scoreboards, and anti-duplicate question selection.",
    audience: "Coding clubs and placement training teams.",
    techStack: ["React", "Node.js", "MongoDB", "Socket-ready APIs", "Monaco Editor"],
    features: ["Contest creation", "Timed tests", "Random question sets", "Leaderboard", "Attempt history", "Admin review"],
    database: ["contests", "contest_questions", "submissions", "scoreboards", "contest_sessions"],
    apis: ["POST /api/contests", "GET /api/contests/:id", "POST /api/contests/:id/submit", "GET /api/leaderboard/:contestId"],
    architecture: "Contest service selects non-duplicate questions, stores attempts, calculates scores, and exposes live-friendly leaderboard endpoints.",
    buildPlan: ["Create contest schema", "Add timer and test session", "Build submission scoring", "Create leaderboard query", "Add admin contest tools"],
    resumeDescription: "Developed a college coding contest platform with timed tests, randomized question selection, submission scoring, and leaderboards.",
    interviewQuestions: ["How do you stop repeated questions?", "How do you calculate rank efficiently?", "How would you add code execution safely?"],
  },
  {
    id: "developer-portfolio-cms",
    level: "Beginner",
    title: "Developer Portfolio CMS",
    oneLine: "A portfolio builder where students manage projects, skills, blogs, and public profile pages.",
    audience: "Students applying for internships and off-campus roles.",
    techStack: ["React", "Node.js", "MongoDB", "Cloudinary optional", "Tailwind"],
    features: ["Project manager", "Skill tags", "Public portfolio page", "Blog notes", "Contact form", "SEO meta editor"],
    database: ["profiles", "projects", "skills", "posts", "messages"],
    apis: ["GET /api/u/:username", "POST /api/projects", "POST /api/posts", "POST /api/messages"],
    architecture: "Admin editor saves structured profile content, public routes render fast portfolio pages from database data.",
    buildPlan: ["Create profile schema", "Build project CRUD", "Build public profile route", "Add contact form", "Add SEO metadata"],
    resumeDescription: "Built a developer portfolio CMS that lets users publish projects, skills, blogs, and contact forms from a custom dashboard.",
    interviewQuestions: ["How do public profile URLs work?", "How do you protect edit routes?", "How would you improve SEO?"],
  },
  {
    id: "devops-deployment-dashboard",
    level: "Intermediate",
    title: "DevOps Deployment Dashboard",
    oneLine: "A dashboard that monitors deployments, build status, environment variables, and incident notes.",
    audience: "Students learning CI/CD and real production workflows.",
    techStack: ["React", "Node.js", "Docker", "GitHub Actions", "MongoDB"],
    features: ["Deployment timeline", "Environment checklist", "Build status cards", "Incident log", "Rollback checklist"],
    database: ["deployments", "environments", "incidents", "checklists"],
    apis: ["POST /api/deployments", "GET /api/deployments", "POST /api/incidents", "PATCH /api/checklists/:id"],
    architecture: "GitHub Actions can call webhook APIs, dashboard stores deployment metadata and operational notes.",
    buildPlan: ["Create deployment schema", "Add GitHub webhook endpoint", "Build status dashboard", "Add incident log", "Write rollback checklist flow"],
    resumeDescription: "Implemented a DevOps dashboard that tracks deployments, CI/CD status, incidents, and production readiness checklists.",
    interviewQuestions: ["How does CI/CD webhook integration work?", "What should be tracked during a deployment?", "How would you secure webhooks?"],
  },
  {
    id: "secure-notes-lab",
    level: "Beginner",
    title: "Secure Notes Lab",
    oneLine: "A notes app built to demonstrate authentication, encryption concepts, and security best practices.",
    audience: "Students learning full-stack plus cybersecurity fundamentals.",
    techStack: ["React", "Node.js", "Express", "MongoDB", "bcrypt", "JWT"],
    features: ["Secure notes CRUD", "Password hashing", "Session handling", "Security checklist", "Activity logs"],
    database: ["users", "notes", "sessions", "audit_logs"],
    apis: ["POST /api/auth/register", "POST /api/auth/login", "GET /api/notes", "POST /api/notes", "DELETE /api/notes/:id"],
    architecture: "Authenticated APIs protect notes, passwords are hashed, audit logs record sensitive actions.",
    buildPlan: ["Build auth flow", "Add protected notes APIs", "Add audit logs", "Add basic encryption discussion", "Write security test checklist"],
    resumeDescription: "Created a secure notes application demonstrating password hashing, JWT sessions, protected REST APIs, and security audit logging.",
    interviewQuestions: ["Why hash passwords?", "Where should JWTs be stored?", "How would you protect against XSS and CSRF?"],
  },
];

const projectExpansionIdeas = [
  ["Campus Doubt Solver", "Beginner", "A Q&A platform for college students with topics, answers, votes, and accepted solutions.", ["React", "Node.js", "MongoDB", "Express"], ["Ask doubts", "Answer threads", "Topic tags", "Accepted answer", "Upvotes"]],
  ["Interview Experience Vault", "Beginner", "A searchable library where students share company interview rounds, questions, difficulty, and tips.", ["React", "Node.js", "MongoDB"], ["Company filters", "Role filters", "Experience form", "Difficulty badges", "Search"]],
  ["DSA Revision Tracker", "Beginner", "A revision planner that tracks solved problems, weak topics, bookmarks, and revision dates.", ["React", "LocalStorage", "Tailwind"], ["Problem checklist", "Weak topic tags", "Revision reminders", "Bookmarks", "Progress rings"]],
  ["SQL Practice Playground", "Intermediate", "A browser SQL challenge system with tables, query tasks, expected outputs, and explanations.", ["React", "Node.js", "SQLite", "Express"], ["Query editor", "Expected output", "Challenge sets", "Hints", "Result checker"]],
  ["Linux Command Trainer", "Beginner", "A safe Linux command learning app with command cards, examples, quizzes, and simulated outputs.", ["React", "JavaScript", "Tailwind"], ["Command search", "Examples", "Simulated terminal", "Quizzes", "Cheat sheets"]],
  ["Networking Packet Visualizer", "Intermediate", "An interactive visual guide for DNS, TCP handshake, HTTP request flow, and routing basics.", ["React", "Canvas", "Node.js"], ["Packet animation", "Protocol notes", "Quiz mode", "Flow diagrams", "Revision cards"]],
  ["OS Scheduling Simulator", "Intermediate", "A simulator for FCFS, SJF, Round Robin, and Priority scheduling with Gantt charts.", ["React", "JavaScript", "Chart.js"], ["Process input", "Gantt chart", "Waiting time", "Turnaround time", "Algorithm comparison"]],
  ["DBMS Normalization Lab", "Intermediate", "A tool that explains 1NF, 2NF, 3NF, keys, dependencies, and normalization examples.", ["React", "Node.js", "MongoDB"], ["Dependency input", "Normal form checker", "Examples", "MCQs", "Interview notes"]],
  ["Cloud Cost Estimator", "Intermediate", "A simple cloud architecture cost estimator for compute, storage, database, and bandwidth choices.", ["React", "Node.js", "JSON Rules"], ["Service selection", "Monthly estimate", "Architecture tips", "Export report", "Cost warnings"]],
  ["DevOps Pipeline Builder", "Advanced", "A visual CI/CD pipeline planner that maps build, test, Docker, deploy, rollback, and monitoring steps.", ["React", "Node.js", "MongoDB"], ["Pipeline stages", "YAML snippets", "Rollback plan", "Environment variables", "Deployment checklist"]],
  ["Cyber Security Lab Tracker", "Intermediate", "A practice tracker for OWASP labs, CTF rooms, vulnerability notes, and remediation steps.", ["React", "Node.js", "MongoDB"], ["Lab log", "Risk category", "Fix notes", "Evidence upload", "Progress heatmap"]],
  ["AI Project Notebook", "Intermediate", "A project notebook for datasets, experiments, metrics, model versions, and final observations.", ["React", "Node.js", "MongoDB", "Python optional"], ["Dataset notes", "Experiment table", "Metrics", "Model cards", "Project report"]],
  ["Resume Project Mapper", "Beginner", "A tool that maps projects to resume bullet points, skills, impact metrics, and interview talking points.", ["React", "LocalStorage"], ["Project forms", "Resume bullets", "Skills extraction", "Impact prompts", "Interview Q&A"]],
  ["Portfolio Roast Checklist", "Beginner", "A portfolio review tool that checks README quality, live links, project depth, and profile completeness.", ["React", "LocalStorage"], ["Checklist", "Score", "Suggestions", "Project gaps", "Shareable report"]],
  ["College Placement CRM", "Advanced", "A placement-cell dashboard for drives, student eligibility, applications, shortlists, and selected candidates.", ["React", "Node.js", "MongoDB", "Express"], ["Drive manager", "Eligibility filters", "Application tracker", "Shortlist view", "CSV export"]],
  ["Hackathon Team Finder", "Intermediate", "A platform where students create skill profiles and find teammates for hackathons and projects.", ["React", "Node.js", "MongoDB"], ["Skill matching", "Project ideas", "Team invites", "Availability", "Chat-ready schema"]],
  ["Internship Application Tracker", "Beginner", "A Kanban tracker for internship applications, deadlines, referrals, tasks, and follow-ups.", ["React", "LocalStorage"], ["Application cards", "Deadline alerts", "Status columns", "Referral notes", "Follow-up checklist"]],
  ["Company Readiness Matrix", "Intermediate", "A dashboard that compares required topics for each company with the student's current preparation.", ["React", "Node.js", "MongoDB"], ["Company profiles", "Topic gaps", "Readiness score", "Study plan", "Progress charts"]],
  ["Mock HR Interview Board", "Beginner", "A structured HR practice app with questions, answer templates, STAR stories, and self-ratings.", ["React", "LocalStorage"], ["Question bank", "Answer builder", "STAR format", "Self score", "Improvement tips"]],
  ["Group Discussion Prep Arena", "Beginner", "A GD preparation hub with topics, openings, arguments, closing statements, and common mistakes.", ["React", "JavaScript"], ["Topic cards", "Argument builder", "Opening examples", "Mistake checklist", "Timer"]],
  ["Aptitude Sprint App", "Intermediate", "A placement aptitude trainer with quantitative, logical, verbal, timer, score, and explanation screens.", ["React", "Node.js", "MongoDB"], ["Timed tests", "Topic filters", "Explanations", "Score history", "Weak topic report"]],
  ["System Design Sketchbook", "Advanced", "A system design practice notebook for requirements, APIs, database schema, scaling, and tradeoffs.", ["React", "Node.js", "MongoDB"], ["Requirement editor", "API planner", "Schema planner", "Tradeoff notes", "Export design"]],
  ["API Documentation Portal", "Intermediate", "A documentation site generator for REST APIs with endpoints, schemas, examples, and auth notes.", ["React", "Node.js", "Markdown"], ["Endpoint docs", "Schema cards", "Example requests", "Auth notes", "Versioning"]],
  ["Bug Tracker Lite", "Beginner", "A software bug tracker with issue states, priorities, comments, labels, and release notes.", ["React", "Node.js", "MongoDB"], ["Issue CRUD", "Priority", "Labels", "Comments", "Release notes"]],
  ["Feature Flag Dashboard", "Advanced", "A dashboard for managing feature flags, rollout percentage, environments, and audit history.", ["React", "Node.js", "MongoDB"], ["Flag manager", "Environment targeting", "Rollout rules", "Audit logs", "SDK-ready API"]],
  ["Realtime Polling App", "Intermediate", "A polling platform for classrooms and events with live results, share links, and anonymous voting.", ["React", "Node.js", "WebSocket", "MongoDB"], ["Poll creation", "Live results", "Share links", "Anonymous votes", "Export results"]],
  ["Markdown Knowledge Base", "Beginner", "A personal knowledge base with markdown notes, tags, search, bookmarks, and reading mode.", ["React", "LocalStorage", "Markdown"], ["Markdown editor", "Tags", "Search", "Bookmarks", "Reading mode"]],
  ["Open Source Contribution Tracker", "Intermediate", "A tracker for issues, pull requests, repositories, skills learned, and contribution streaks.", ["React", "Node.js", "MongoDB"], ["Repo list", "Issue tracker", "PR notes", "Skill tags", "Contribution report"]],
  ["Microservice Health Monitor", "Advanced", "A dashboard for service health, uptime checks, latency, incidents, and dependency status.", ["React", "Node.js", "MongoDB"], ["Health endpoints", "Latency charts", "Incident log", "Dependency map", "Alerts-ready schema"]],
  ["Personal Finance Tracker", "Intermediate", "A full-stack expense tracker with budgets, categories, monthly reports, and CSV export.", ["React", "Node.js", "MongoDB"], ["Expense CRUD", "Budgets", "Charts", "CSV export", "Monthly report"]],
  ["E-Commerce Admin Panel", "Advanced", "An admin system for products, orders, inventory, coupons, customers, and sales analytics.", ["React", "Node.js", "MongoDB"], ["Product CRUD", "Orders", "Inventory", "Coupons", "Sales charts"]],
  ["Learning Management System", "Advanced", "A course platform with lessons, quizzes, progress tracking, certificates, and admin content tools.", ["React", "Node.js", "MongoDB"], ["Courses", "Lessons", "Quizzes", "Progress", "Certificates"]],
  ["Chat App with Moderation", "Advanced", "A room-based chat application with moderation tools, message search, and user roles.", ["React", "Node.js", "Socket.io", "MongoDB"], ["Rooms", "Messages", "Roles", "Moderation", "Search"]],
  ["Job Board Portal", "Intermediate", "A job and internship board with company listings, filters, saved jobs, and application status.", ["React", "Node.js", "MongoDB"], ["Listings", "Filters", "Saved jobs", "Applications", "Admin posting"]],
  ["Scholarship Finder", "Beginner", "A searchable scholarship directory with eligibility filters, deadlines, documents, and reminders.", ["React", "LocalStorage"], ["Eligibility filters", "Deadline list", "Document checklist", "Bookmarks", "Reminder notes"]],
  ["Certificate Planner", "Beginner", "A planner that maps career goals to certificates, study resources, exam dates, and revision plans.", ["React", "LocalStorage"], ["Certificate list", "Goal mapping", "Exam dates", "Study plan", "Progress"]],
  ["GitHub Profile Analyzer", "Intermediate", "A local checklist tool that reviews repository quality, README depth, commits, and pinned projects.", ["React", "LocalStorage"], ["Repo checklist", "README review", "Pinned project score", "Commit goals", "Profile tips"]],
  ["Code Snippet Manager", "Beginner", "A searchable snippet vault for algorithms, SQL queries, Linux commands, and interview templates.", ["React", "LocalStorage"], ["Snippet CRUD", "Tags", "Search", "Copy button", "Categories"]],
  ["Team Project Planner", "Intermediate", "A collaboration planner with tasks, owners, deadlines, milestones, and meeting notes.", ["React", "Node.js", "MongoDB"], ["Tasks", "Owners", "Milestones", "Meeting notes", "Progress board"]],
  ["Attendance Analytics Dashboard", "Intermediate", "A college attendance analytics tool with subject-wise trends, shortage alerts, and reports.", ["React", "Node.js", "MongoDB"], ["Subject tracker", "Charts", "Shortage alerts", "Reports", "CSV import"]],
  ["Library Management System", "Intermediate", "A library system with books, members, issue/return flow, fines, and search.", ["React", "Node.js", "MongoDB"], ["Book catalog", "Members", "Issue return", "Fine rules", "Search"]],
  ["Hostel Complaint Portal", "Beginner", "A student complaint portal with categories, status tracking, admin assignment, and feedback.", ["React", "Node.js", "MongoDB"], ["Complaint form", "Status", "Admin assignment", "Feedback", "Reports"]],
  ["Event Registration System", "Beginner", "An event platform with registrations, QR check-in, capacity limits, and attendee export.", ["React", "Node.js", "MongoDB"], ["Events", "Registration", "QR check-in", "Capacity", "Export"]],
  ["Quiz Battle Arena", "Intermediate", "A quiz game where students battle on CS topics with timers, scores, and rematch flow.", ["React", "Node.js", "MongoDB"], ["Topic battle", "Timer", "Scoreboard", "Rematch", "History"]],
  ["Code Review Checklist App", "Beginner", "A checklist app for reviewing pull requests, readability, performance, security, and tests.", ["React", "LocalStorage"], ["Review checklist", "Categories", "Score", "Notes", "Export"]],
  ["API Rate Limiter Demo", "Advanced", "A backend demo that implements token bucket, fixed window, and sliding window rate limiters.", ["Node.js", "Express", "Redis optional", "React"], ["Limiter modes", "API demo", "Metrics", "Tests", "Docs"]],
  ["URL Shortener with Analytics", "Intermediate", "A URL shortener with custom slugs, click analytics, QR codes, and expiration dates.", ["React", "Node.js", "MongoDB"], ["Short links", "Analytics", "QR code", "Expiry", "Custom slug"]],
  ["File Sharing Portal", "Advanced", "A file sharing app with upload, access links, expiry, download logs, and role permissions.", ["React", "Node.js", "MongoDB", "Storage"], ["Upload", "Share links", "Expiry", "Download logs", "Permissions"]],
  ["Study Streak Habit Tracker", "Beginner", "A habit tracker focused on DSA, MCQs, notes, projects, and communication practice.", ["React", "LocalStorage"], ["Daily habits", "Streaks", "Heatmap", "Goals", "Weekly review"]],
  ["Technical Blog Platform", "Intermediate", "A blogging platform for technical notes with markdown, tags, comments, and reading stats.", ["React", "Node.js", "MongoDB"], ["Markdown posts", "Tags", "Comments", "Reading stats", "SEO"]],
  ["Placement Resource Library", "Intermediate", "A curated resource platform with notes, links, certificates, playlists, and user bookmarks.", ["React", "Node.js", "MongoDB"], ["Resource cards", "Filters", "Bookmarks", "Admin curation", "Tags"]],
];

const techDomainProjectPack = [
  ["Software Engineering & Web Development", "Beginner", "Personal Portfolio Website", "Build a responsive static website to showcase resume, projects, skills, and contact links.", ["HTML", "CSS", "JavaScript", "GitHub Pages"], ["Responsive sections", "Project gallery", "Resume download", "Contact form", "SEO metadata"]],
  ["Software Engineering & Web Development", "Beginner", "CLI Task Tracker", "Create a command-line to-do application to learn state management, file storage, and basic app structure.", ["Python", "JSON", "File I/O", "CLI"], ["Add/edit/delete tasks", "Status filters", "Local file persistence", "Due date sorting", "Command help menu"]],
  ["Software Engineering & Web Development", "Intermediate", "E-Commerce Storefront", "Build a full-stack store with product browsing, cart, authentication, orders, and admin product management.", ["React", "Node.js", "Express", "MongoDB/PostgreSQL"], ["Product catalog", "Shopping cart", "User authentication", "Order workflow", "Admin inventory panel"]],
  ["Software Engineering & Web Development", "Intermediate", "Weather Dashboard", "Create a forecast dashboard that consumes weather data and turns it into charts, alerts, and saved locations.", ["React", "Weather API", "Chart.js", "LocalStorage"], ["City search", "Forecast cards", "Charts", "Saved locations", "Weather alerts"]],
  ["Software Engineering & Web Development", "Advanced", "Real-Time Collaborative Code Editor", "Build a browser IDE where multiple users can edit code together with live presence and rooms.", ["React", "Node.js", "Socket.io", "Monaco Editor", "MongoDB"], ["Live code editing", "Room sharing", "User cursors", "Chat panel", "Session history"]],
  ["Software Engineering & Web Development", "Advanced", "Microservices Ticketing System", "Design an event-driven ticket purchase platform that handles high-concurrency booking workflows.", ["Next.js", "Node.js", "Docker", "Kubernetes", "NATS/Kafka"], ["Service boundaries", "Event bus", "Order expiry", "Payment workflow", "Deployment manifests"]],

  ["AI & Machine Learning", "Beginner", "House Price Predictor", "Train a regression model that predicts house prices from structured housing features and explains key factors.", ["Python", "pandas", "scikit-learn", "Jupyter"], ["Dataset cleaning", "Feature engineering", "Linear regression", "Model metrics", "Prediction form"]],
  ["AI & Machine Learning", "Beginner", "Spam SMS Classifier", "Build an NLP classifier that detects spam messages and explains text preprocessing decisions.", ["Python", "scikit-learn", "Naive Bayes", "NLP"], ["Text cleaning", "Vectorization", "Spam/ham prediction", "Accuracy report", "Confusion matrix"]],
  ["AI & Machine Learning", "Intermediate", "Image Classification API", "Train an image classifier and expose it through a backend API for real application integration.", ["Python", "PyTorch/TensorFlow", "FastAPI/Flask", "Docker"], ["Image upload", "CNN model", "Prediction API", "Confidence scores", "Model version notes"]],
  ["AI & Machine Learning", "Intermediate", "Document RAG Knowledge Bot", "Build a document question-answering system over personal PDFs using local embeddings or an open-source vector store.", ["Python", "LangChain optional", "FAISS/Chroma", "FastAPI", "React"], ["PDF ingestion", "Chunking", "Vector search", "Answer citations", "Conversation history"]],
  ["AI & Machine Learning", "Advanced", "Real-Time Edge Object Detection", "Run YOLO-style object detection on live video and optimize it for low-resource edge devices.", ["Python", "YOLOv8", "OpenCV", "Raspberry Pi optional"], ["Video stream input", "Object boxes", "FPS tracking", "Model optimization", "Edge deployment notes"]],
  ["AI & Machine Learning", "Advanced", "Custom LLM Fine-Tuning Lab", "Fine-tune an open-source language model on a narrow dataset and evaluate output quality safely.", ["Python", "Hugging Face", "QLoRA", "Datasets", "Weights & Biases optional"], ["Dataset preparation", "Fine-tuning script", "Evaluation prompts", "Model card", "Inference demo"]],

  ["Cybersecurity", "Beginner", "Password Strength Analyzer", "Create a password auditing tool that estimates entropy and warns about common weak patterns.", ["Python", "Regex", "CLI", "Security Rules"], ["Entropy score", "Pattern checks", "Common password warnings", "Improvement tips", "Report output"]],
  ["Cybersecurity", "Beginner", "Educational Keylogger Lab", "Build a strictly local, sandboxed keystroke recorder to understand spyware behavior and defense controls.", ["Python", "Local Sandbox", "Security Notes"], ["Local-only capture", "Explicit consent banner", "Log viewer", "Defense checklist", "Ethics warning"]],
  ["Cybersecurity", "Intermediate", "Network Packet Sniffer", "Build a packet analyzer that captures local traffic metadata and explains protocols like TCP, UDP, DNS, and HTTP.", ["Python", "Scapy", "Networking", "CLI"], ["Packet capture", "Protocol filters", "Summary table", "Export logs", "Protocol explanations"]],
  ["Cybersecurity", "Intermediate", "Automated Vulnerability Scanner", "Create a safe scanner that checks basic web security headers, cookies, and common misconfigurations.", ["Python", "Requests", "ReportLab", "OWASP"], ["Header checks", "Cookie checks", "Risk scoring", "PDF report", "Fix recommendations"]],
  ["Cybersecurity", "Advanced", "Sandboxed Ransomware Simulation and Decryptor", "Build a safe encryption/decryption simulator to study ransomware mechanics without harmful behavior.", ["Python", "Cryptography", "Sandbox", "Security Report"], ["Test folder only", "Encryption demo", "Decryptor", "Key handling notes", "Defense checklist"]],
  ["Cybersecurity", "Advanced", "Enterprise SIEM Home Lab", "Deploy a log monitoring lab that collects, parses, visualizes, and alerts on security events.", ["Wazuh/ELK", "Linux", "Docker", "Virtual Machines"], ["Log agents", "Dashboards", "Alert rules", "Incident notes", "Detection reports"]],

  ["Networking", "Beginner", "Ping Sweep Tool", "Discover active devices on a local network using ICMP-style checks and summarize reachable hosts.", ["Python", "Networking", "CLI"], ["CIDR input", "Host discovery", "Timeout control", "CSV output", "Scan summary"]],
  ["Networking", "Beginner", "Subnet Calculator", "Build a calculator that converts IP/CIDR input into subnet mask, broadcast address, and usable ranges.", ["Python", "CLI", "IP Math"], ["CIDR parsing", "Network address", "Broadcast address", "Usable range", "Binary explanation"]],
  ["Networking", "Intermediate", "Multi-Threaded Chat Server and Client", "Create a TCP/UDP chat room to understand sockets, transport protocols, and concurrent clients.", ["Python/C", "Sockets", "Threads", "TCP/UDP"], ["Server rooms", "Client commands", "Threaded handling", "Message broadcast", "Disconnect handling"]],
  ["Networking", "Intermediate", "Custom Load Balancer", "Implement a layer-4 style software load balancer that distributes requests across backend services.", ["Node.js/Python", "Networking", "Round Robin", "Docker"], ["Backend pool", "Round-robin routing", "Health checks", "Request logs", "Failover behavior"]],
  ["Networking", "Advanced", "Software-Defined Network Controller", "Prototype an SDN controller that changes routing behavior in a virtual network lab.", ["OpenFlow", "Mininet", "Python", "Networking"], ["Topology setup", "Flow rules", "Route changes", "Traffic monitoring", "Lab report"]],
  ["Networking", "Advanced", "Custom VPN Implementation", "Build a basic point-to-point VPN lab using TUN/TAP concepts and encrypted packet transport.", ["Linux", "TUN/TAP", "AES", "Python/C"], ["Tunnel setup", "Encryption", "Packet forwarding", "Key exchange notes", "Security limitations"]],

  ["DevOps", "Beginner", "Dockerize a Web App", "Take a Node.js or Python web app and package it into a repeatable container workflow.", ["Docker", "Node.js/Python", "Docker Compose"], ["Dockerfile", "Compose setup", "Environment variables", "Local run script", "Image documentation"]],
  ["DevOps", "Beginner", "Basic CI Pipeline", "Set up GitHub Actions to lint, test, and report build status on every push.", ["GitHub Actions", "YAML", "Unit Tests", "Linting"], ["Workflow file", "Lint job", "Test job", "Status badge", "Failure logs"]],
  ["DevOps", "Intermediate", "Infrastructure as Code AWS Lab", "Use Terraform to provision a VPC, subnets, compute, and database resources as repeatable infrastructure.", ["Terraform", "AWS", "VPC", "EC2", "RDS"], ["Terraform modules", "VPC design", "Public/private subnets", "EC2 setup", "RDS notes"]],
  ["DevOps", "Intermediate", "Monitoring and Alerting Stack", "Deploy Prometheus and Grafana to monitor server metrics and trigger alerts from defined thresholds.", ["Prometheus", "Grafana", "Docker Compose", "Linux"], ["Metrics collection", "Dashboards", "Alert rules", "Service health", "Runbook notes"]],
  ["DevOps", "Advanced", "GitOps Kubernetes Deployment", "Deploy apps to Kubernetes using Git as the source of truth and ArgoCD for automatic sync.", ["Kubernetes", "ArgoCD", "Git", "Docker"], ["K8s manifests", "ArgoCD app", "Git sync", "Rollback flow", "Environment overlays"]],
  ["DevOps", "Advanced", "Zero-Downtime Deployment Pipeline", "Implement blue-green or canary deployment flow with health checks and rollback decisions.", ["AWS", "CodePipeline", "ECS", "Load Balancer"], ["Blue/green release", "Canary traffic", "Health checks", "Rollback plan", "Deployment report"]],

  ["Cloud Computing", "Beginner", "Serverless Image Resizer", "Resize uploaded images automatically using object storage events and serverless functions.", ["AWS Lambda", "S3", "Node.js/Python", "CloudWatch"], ["Upload trigger", "Thumbnail generation", "Output bucket", "Logs", "Error handling"]],
  ["Cloud Computing", "Beginner", "Static Cloud Resume", "Host a professional resume site on cloud storage with CDN, HTTPS, and a custom domain.", ["AWS S3", "CloudFront", "DNS", "HTTPS"], ["Static hosting", "CDN setup", "Custom domain", "SSL", "Deployment checklist"]],
  ["Cloud Computing", "Intermediate", "Serverless Note-Taking App", "Build a serverless CRUD app with API Gateway, functions, NoSQL storage, and user authentication.", ["AWS API Gateway", "Lambda", "DynamoDB", "Cognito"], ["CRUD API", "Auth", "NoSQL schema", "Serverless deploy", "Access rules"]],
  ["Cloud Computing", "Intermediate", "Automated Cloud Cost Optimizer", "Scan cloud resources for idle or unattached assets and generate cost-saving actions.", ["Python", "Boto3", "AWS", "Automation"], ["Idle resource scan", "Cost report", "Stop/delete suggestions", "Dry-run mode", "Audit log"]],
  ["Cloud Computing", "Advanced", "Highly Available Video Streaming Platform", "Architect a video platform with autoscaling, transcoding, cache layers, and storage design.", ["AWS", "EC2 Auto Scaling", "S3", "MediaConvert", "ElastiCache"], ["Upload flow", "Transcoding pipeline", "Metadata cache", "Load balancing", "Architecture diagram"]],
  ["Cloud Computing", "Advanced", "Multi-Cloud Disaster Recovery", "Design a failover system that replicates data between cloud providers and documents recovery steps.", ["AWS", "Azure/GCP", "Replication", "Terraform"], ["Primary/secondary setup", "Database replication", "Failover plan", "RTO/RPO notes", "Recovery drill"]],

  ["Data Engineering", "Beginner", "Web Scraper and Database", "Scrape job listings, clean the records, and store searchable data in a local database.", ["Python", "BeautifulSoup/Selenium", "SQLite", "pandas"], ["Scraper", "Data cleaning", "SQLite schema", "Search queries", "CSV export"]],
  ["Data Engineering", "Beginner", "Basic ETL Script", "Extract public CSV data, clean it with pandas, and load it into PostgreSQL for analysis.", ["Python", "pandas", "PostgreSQL", "SQL"], ["Extract step", "Transform rules", "Load script", "Validation checks", "SQL report"]],
  ["Data Engineering", "Intermediate", "Automated Airflow Pipeline", "Orchestrate a daily financial data pipeline with extraction, transformation, loading, and monitoring.", ["Apache Airflow", "Python", "BigQuery/Snowflake", "Docker"], ["DAG schedule", "API extraction", "Transform task", "Warehouse load", "Failure alerts"]],
  ["Data Engineering", "Intermediate", "dbt Data Modeling Project", "Transform raw warehouse data into documented, tested, analytics-ready models using dbt.", ["dbt", "SQL", "Data Warehouse", "Git"], ["Staging models", "Mart models", "Tests", "Documentation", "Lineage graph"]],
  ["Data Engineering", "Advanced", "Real-Time Streaming Analytics", "Ingest clickstream-style events, process them in real time, and store query-ready results.", ["Apache Kafka", "Spark Streaming", "Cassandra", "Docker"], ["Event producer", "Kafka topics", "Stream processing", "Cassandra sink", "Analytics dashboard"]],
];

productProjects.push(...techDomainProjectPack.map(([domain, level, title, oneLine, techStack, features]) => ({
  id: `domain-${slug(title)}`,
  level,
  title,
  oneLine,
  audience: `${domain} learners building resume-ready proof of skill.`,
  techStack,
  features,
  database: ["users_or_operators", slug(title).replaceAll("-", "_"), "activity_logs", "reports", "configuration"],
  apis: [`GET /api/projects/${slug(title)}`, `POST /api/projects/${slug(title)}/run`, `GET /api/projects/${slug(title)}/reports`, `PATCH /api/projects/${slug(title)}/settings`],
  architecture: `${title} is structured as a practical ${domain} project with a clear user workflow, data layer, service layer, reporting output, and deployment-ready documentation.`,
  buildPlan: ["Define the real user workflow", "Design inputs, outputs, and data model", "Build the core engine or CRUD flow", "Add reports, logs, and validation", "Write README, architecture notes, and demo script"],
  resumeDescription: `Built ${title}, a ${level.toLowerCase()} ${domain} project with practical workflows, structured data handling, reports, and interview-ready architecture documentation.`,
  interviewQuestions: ["Why did you choose this architecture?", "What edge cases did you handle?", "How would you secure and scale this project?", "What would you improve in version 2?"],
})));

productProjects.push(...projectExpansionIdeas.map(([title, level, oneLine, techStack, features]) => ({
  id: slug(title),
  level,
  title,
  oneLine,
  audience: "Students preparing for internships, placements, and project interviews.",
  techStack,
  features,
  database: ["users", slug(title).replaceAll("-", "_"), "activity_logs", "bookmarks", "reports"],
  apis: [`GET /api/${slug(title)}`, `POST /api/${slug(title)}`, `PATCH /api/${slug(title)}/:id`, `DELETE /api/${slug(title)}/:id`],
  architecture: `${title} uses a React interface, REST APIs, structured storage, validation, and clear separation between public views and admin actions.`,
  buildPlan: ["Define user stories", "Design database schema", "Build CRUD APIs", "Connect responsive UI", "Add validation and reporting"],
  resumeDescription: `Built ${title}, a ${level.toLowerCase()} full-stack product with structured data models, REST APIs, responsive UI, and interview-ready architecture documentation.`,
  interviewQuestions: ["Why did you choose this tech stack?", "How is the database schema designed?", "How would you scale this product for more users?"],
})));

function resourcesForTopic(topic = "") {
  const keyText = String(topic || "").toLowerCase();
  const keys = ["default"];
  if (/dsa|array|string|tree|graph|dynamic|algorithm|coding/.test(keyText)) keys.push("dsa");
  if (/web|react|javascript|node|frontend|backend|project/.test(keyText)) keys.push("web");
  if (/cloud|aws|azure|gcp/.test(keyText)) keys.push("cloud");
  if (/devops|linux|docker|kubernetes|ci|cd/.test(keyText)) keys.push("devops");
  if (/cyber|security|xss|injection|owasp/.test(keyText)) keys.push("cybersecurity");
  if (/ai|ml|machine|learning|llm|data/.test(keyText)) keys.push("ai");
  const merged = { youtube: [], docs: [], certificates: [] };
  for (const key of keys) {
    const group = learningResources[key];
    for (const type of Object.keys(merged)) {
      for (const item of group?.[type] || []) {
        if (!merged[type].some((existing) => existing.url === item.url)) merged[type].push(item);
      }
    }
  }
  return merged;
}

const knownCompanies = ["TCS", "Infosys", "Wipro", "Cognizant", "Accenture", "Capgemini", "IBM", "HCL", "Zoho", "Amazon", "Microsoft", "Google", "Meta", "Facebook", "NVIDIA", "Nvidia", "Oracle", "Salesforce", "Adobe", "Uber", "Airbnb", "MAANG"];
const topicHints = {
  Arrays: ["array", "subarray", "matrix", "zeroes", "interval", "sum"],
  Strings: ["string", "substring", "palindrome", "anagram", "prefix", "word"],
  "Linked Lists": ["linked list", "node", "list"],
  Stacks: ["stack", "parentheses", "histogram"],
  Queues: ["queue", "bfs"],
  Trees: ["tree", "bst", "binary"],
  Heap: ["heap", "kth", "top k", "median", "scheduler"],
  Graphs: ["graph", "island", "course", "network", "route", "path"],
  Greedy: ["greedy", "jump", "gas station"],
  Backtracking: ["permutation", "subset", "combination", "n-queens", "sudoku"],
  "Dynamic Programming": ["dp", "coin", "robber", "decode", "distance", "balloons", "egg", "partition"],
  "Bit Manipulation": ["bit", "xor", "power of two"],
  "Sliding Window": ["window", "substring", "anagram"],
  Recursion: ["recursion", "recursive"],
};

function cleanText(text) {
  return text
    .replaceAll("â€”", "-")
    .replaceAll("ï‚·", "")
    .replaceAll("`", "'")
    .replace(/\r/g, "");
}

function readMasterPackText() {
  for (const sourcePath of masterPackPaths) {
    if (existsSync(sourcePath)) return cleanText(readFileSync(sourcePath, "utf8"));
  }
  return "";
}

function readDatasetFile(fileName, fallback) {
  const filePath = join(datasetDir, fileName);
  if (!existsSync(filePath)) return fallback;
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function readDatasetContent() {
  if (!existsSync(datasetDir)) return [];
  return datasetFiles.flatMap((fileName) => {
    const records = readDatasetFile(fileName, []);
    return Array.isArray(records) ? records : [];
  });
}

function datasetStatus() {
  const files = Object.fromEntries(datasetFiles.map((fileName) => {
    const records = readDatasetFile(fileName, []);
    return [fileName, Array.isArray(records) ? records.length : 0];
  }));
  const companyQuestions = readDatasetFile("company_questions.json", {});
  return {
    directory: datasetDir,
    files,
    companyQuestions: Object.fromEntries(Object.entries(companyQuestions).map(([company, entry]) => [company, entry.questions?.length || 0])),
    totalContentItems: Object.values(files).reduce((sum, count) => sum + count, 0),
  };
}

function inferTopic(question, fallback = "General") {
  const lower = question.toLowerCase();
  const found = Object.entries(topicHints).find(([, hints]) => hints.some((hint) => lower.includes(hint)));
  return found?.[0] || fallback;
}

function normalizeCompany(company) {
  if (company === "Facebook") return "Meta";
  if (company === "Nvidia") return "NVIDIA";
  return company;
}

function parseCompanies(text) {
  const explicit = text.match(/Company:\s*([^.\n]+)/i)?.[1] || text.match(/Asked in:\s*([^)]+)/i)?.[1] || "";
  const candidates = explicit ? explicit.split(/,|\/| and /i).map((item) => item.trim()) : knownCompanies.filter((company) => text.toLowerCase().includes(company.toLowerCase()));
  return [...new Set(candidates.map(normalizeCompany).filter(Boolean))];
}

function makeContentItem({ question, category, type, difficulty = "General", companyTags = [], topicTags = [], sourceLine = "" }, index) {
  const cleanQuestion = question.replace(/\s+/g, " ").replace(/[.]+$/, "").trim();
  return {
    id: `${slug(`${type}-${difficulty}-${cleanQuestion}`)}-${index}`,
    question: cleanQuestion,
    category,
    type,
    difficulty,
    companyTags: [...new Set(companyTags.map(normalizeCompany))],
    topicTags: [...new Set(topicTags.filter(Boolean))],
    source: "Ultimate Tech Interview Master Guide",
    sourceLine,
    referenceNote: contentReferenceNote,
  };
}

function parseMasterPackContent() {
  const datasetItems = readDatasetContent();
  if (datasetItems.length) return datasetItems;

  const text = readMasterPackText();
  if (!text) return [];
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const items = [];
  let section = "";
  let difficulty = "";
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (/^dsa easy/.test(lower)) { section = "dsa"; difficulty = "Easy"; continue; }
    if (/^dsa medium/.test(lower)) { section = "dsa"; difficulty = "Medium"; continue; }
    if (/^dsa hard/.test(lower)) { section = "dsa"; difficulty = "Hard"; continue; }
    if (/^100 coding challenges/.test(lower)) { section = "coding"; difficulty = "Mixed"; continue; }
    if (/^cloud mcq/.test(lower)) { section = "cloud"; difficulty = "MCQ"; continue; }
    if (/^networking mcq/.test(lower)) { section = "networking"; difficulty = "MCQ"; continue; }
    if (/^ai and ml mcq/.test(lower)) { section = "ai"; difficulty = "MCQ"; continue; }
    if (/^devops mcq/.test(lower)) { section = "devops"; difficulty = "MCQ"; continue; }
    if (/^cybersecurity/.test(lower)) { section = "cyber"; difficulty = "MCQ"; continue; }
    if (/^hr questions/.test(lower)) { section = "hr"; difficulty = "HR"; continue; }
    if (/^notes$/i.test(line)) section = "";

    if (!section || line.length < 4) continue;
    if (/^(this document|source-based|how to use|practice|for mcqs|cloud mcq coverage|networking mcq preparation|ai and ml mcq preparation|devops mcq preparation|cybersecurity interview preparation|these hr questions)/i.test(line)) continue;

    let question = line.replace(/^\d+\.\s*/, "").trim();
    if (!question) continue;

    if (section === "dsa") {
      const title = question.split(/\s+-\s+Company:/i)[0].replace(/^\[(Easy|Medium|Hard)\]\s*/i, "").trim();
      const companies = parseCompanies(question);
      const topic = inferTopic(title, "DSA");
      items.push(makeContentItem({
        question: title,
        category: "Engineering Fundamentals",
        type: "DSA",
        difficulty,
        companyTags: companies,
        topicTags: ["DSA", topic],
        sourceLine: line,
      }, items.length + 1));
      continue;
    }

    if (section === "coding") {
      items.push(makeContentItem({
        question,
        category: "Career Preparation",
        type: "Coding Challenge",
        difficulty: "Mixed",
        companyTags: ["TCS", "Accenture", "MAANG"],
        topicTags: ["Coding Challenges", inferTopic(question, "Problem Solving")],
        sourceLine: line,
      }, items.length + 1));
      continue;
    }

    const sectionMap = {
      cloud: ["Infrastructure", "MCQ", "Cloud Computing"],
      networking: ["Engineering Fundamentals", "MCQ", "Computer Networks"],
      ai: ["Modern Technologies", "MCQ", "AI", "Machine Learning"],
      devops: ["Infrastructure", "MCQ", "DevOps"],
      cyber: ["Modern Technologies", "MCQ", "Cybersecurity"],
      hr: ["Career Preparation", "HR Question", "HR Questions"],
    };
    const [category, type, ...topics] = sectionMap[section] || ["Career Preparation", "Question", "General"];
    items.push(makeContentItem({
      question,
      category,
      type,
      difficulty,
      companyTags: parseCompanies(question),
      topicTags: topics,
      sourceLine: line,
    }, items.length + 1));
  }
  return items;
}

const questionSeeds = [
  ["Two Sum", "Easy", "Arrays", ["Amazon", "Google", "TCS", "Accenture"], 10],
  ["Valid Parentheses", "Easy", "Stacks", ["Meta", "Infosys", "Microsoft"], 10],
  ["Merge Two Sorted Lists", "Easy", "Linked Lists", ["Amazon", "Microsoft"], 10],
  ["Best Time to Buy and Sell Stock", "Easy", "Arrays", ["Amazon", "Apple", "NVIDIA"], 10],
  ["Valid Palindrome", "Easy", "Strings", ["Meta", "TCS"], 10],
  ["Invert Binary Tree", "Easy", "Trees", ["Google", "Accenture"], 10],
  ["Maximum Subarray", "Easy", "Arrays", ["Amazon", "LinkedIn", "Infosys"], 10],
  ["Binary Search", "Easy", "Binary Search", ["Apple", "TCS", "NVIDIA"], 10],
  ["Reverse Linked List", "Easy", "Linked Lists", ["Amazon", "TCS", "NVIDIA"], 10],
  ["Contains Duplicate", "Easy", "Hashing", ["Google", "Accenture"], 10],
  ["Climbing Stairs", "Easy", "DP", ["Google", "TCS"], 10],
  ["Symmetric Tree", "Easy", "Trees", ["Microsoft", "Infosys"], 10],
  ["Missing Number", "Easy", "Arrays", ["Amazon", "TCS"], 10],
  ["Move Zeroes", "Easy", "Arrays", ["Bloomberg", "NVIDIA"], 10],
  ["Pascal's Triangle", "Easy", "Arrays", ["Apple", "Infosys"], 10],
  ["Majority Element", "Easy", "Arrays", ["Amazon", "TCS"], 10],
  ["Diameter of Binary Tree", "Easy", "Trees", ["Meta", "Accenture"], 10],
  ["Middle of the Linked List", "Easy", "Linked Lists", ["Google", "TCS"], 10],
  ["Palindrome Linked List", "Easy", "Linked Lists", ["Amazon", "Infosys"], 10],
  ["Reverse String", "Easy", "Strings", ["Apple", "NVIDIA", "TCS"], 10],
  ["Roman to Integer", "Easy", "Strings", ["Microsoft", "TCS"], 10],
  ["Longest Common Prefix", "Easy", "Strings", ["Amazon", "Accenture"], 10],
  ["Valid Anagram", "Easy", "Hashing", ["Uber", "Infosys"], 10],
  ["Plus One", "Easy", "Arrays", ["Google", "TCS"], 10],
  ["Single Number", "Easy", "Bit Manipulation", ["Amazon", "TCS"], 10],
  ["Intersection of Two Arrays", "Easy", "Hashing", ["Meta", "Infosys"], 10],
  ["Happy Number", "Easy", "Math", ["Twitter", "TCS"], 10],
  ["Is Subsequence", "Easy", "Strings", ["Pinterest", "NVIDIA"], 10],
  ["Min Stack", "Easy", "Stacks", ["Amazon", "Accenture", "NVIDIA"], 10],
  ["Path Sum", "Easy", "Trees", ["Microsoft", "TCS"], 10],
  ["Search Insert Position", "Easy", "Binary Search", ["Apple", "Infosys"], 10],
  ["Same Tree", "Easy", "Trees", ["Google", "NVIDIA"], 10],
  ["Merge Sorted Array", "Easy", "Arrays", ["Meta", "Accenture", "Wipro"], 10],
  ["Length of Last Word", "Easy", "Strings", ["Apple", "TCS"], 10],
  ["Add Binary", "Easy", "Strings", ["Meta", "Infosys"], 10],
  ["Remove Element", "Easy", "Arrays", ["Amazon", "TCS"], 10],
  ["Find First Occurrence in String", "Easy", "Strings", ["Microsoft", "NVIDIA"], 10],
  ["Power of Two", "Easy", "Bit Manipulation", ["Google", "Infosys", "Accenture"], 10],
  ["Fibonacci Number", "Easy", "Math", ["Amazon", "TCS", "Accenture"], 10],
  ["Armstrong Number", "Easy", "Math", ["TCS", "Infosys"], 10],
  ["Add Two Numbers", "Medium", "Linked Lists", ["Amazon", "Microsoft", "Google"], 25],
  ["Longest Substring Without Repeating Characters", "Medium", "Sliding Window", ["Google", "Amazon", "NVIDIA"], 25],
  ["Longest Palindromic Substring", "Medium", "Strings", ["Amazon", "TCS"], 25],
  ["Container With Most Water", "Medium", "Two Pointers", ["Meta", "Google", "Accenture"], 25],
  ["3Sum", "Medium", "Two Pointers", ["Amazon", "Meta", "Infosys"], 25],
  ["Letter Combinations of a Phone Number", "Medium", "Backtracking", ["Google", "TCS"], 25],
  ["Remove Nth Node From End of List", "Medium", "Linked Lists", ["Meta", "NVIDIA"], 25],
  ["Generate Parentheses", "Medium", "Backtracking", ["Amazon", "Accenture"], 25],
  ["Search in Rotated Sorted Array", "Medium", "Binary Search", ["Microsoft", "TCS"], 25],
  ["Combination Sum", "Medium", "Backtracking", ["Amazon", "NVIDIA"], 25],
  ["Permutations", "Medium", "Backtracking", ["Google", "TCS"], 25],
  ["Rotate Image", "Medium", "Matrix", ["Amazon", "Accenture"], 25],
  ["Group Anagrams", "Medium", "Hashing", ["Meta", "Microsoft", "Infosys"], 25],
  ["Spiral Matrix", "Medium", "Matrix", ["Amazon", "NVIDIA"], 25],
  ["Jump Game", "Medium", "Greedy", ["Meta", "Accenture"], 25],
  ["Merge Intervals", "Medium", "Intervals", ["Google", "Amazon", "TCS"], 25],
  ["Insert Interval", "Medium", "Intervals", ["Google", "Infosys"], 25],
  ["Unique Paths", "Medium", "DP", ["Amazon", "NVIDIA"], 25],
  ["Set Matrix Zeroes", "Medium", "Matrix", ["Microsoft", "TCS"], 25],
  ["Sort Colors", "Medium", "Two Pointers", ["Meta", "Accenture"], 25],
  ["Subsets", "Medium", "Backtracking", ["Amazon", "Infosys"], 25],
  ["Word Search", "Medium", "Backtracking", ["Amazon", "NVIDIA"], 25],
  ["Decode Ways", "Medium", "DP", ["Meta", "TCS"], 25],
  ["Validate Binary Search Tree", "Medium", "Trees", ["Microsoft", "Google", "Accenture"], 25],
  ["Binary Tree Level Order Traversal", "Medium", "Trees", ["Amazon", "Infosys"], 25],
  ["Construct Binary Tree from Preorder and Inorder", "Medium", "Trees", ["Google", "TCS"], 25],
  ["Flatten Binary Tree to Linked List", "Medium", "Trees", ["Meta", "NVIDIA"], 25],
  ["Clone Graph", "Medium", "Graphs", ["Amazon", "TCS"], 25],
  ["Gas Station", "Medium", "Greedy", ["Google", "Infosys"], 25],
  ["LRU Cache", "Medium", "Design", ["Amazon", "Google", "NVIDIA", "TCS"], 25],
  ["Evaluate Reverse Polish Notation", "Medium", "Stacks", ["Microsoft", "TCS"], 25],
  ["Maximum Product Subarray", "Medium", "DP", ["Amazon", "Infosys"], 25],
  ["Find Minimum in Rotated Sorted Array", "Medium", "Binary Search", ["Meta", "NVIDIA"], 25],
  ["Number of Islands", "Medium", "Graphs", ["Amazon", "Google", "Accenture"], 25],
  ["Course Schedule", "Medium", "Graphs", ["Google", "TCS"], 25],
  ["Implement Trie", "Medium", "Tries", ["Meta", "Infosys"], 25],
  ["Design Add and Search Words", "Medium", "Tries", ["Amazon", "NVIDIA"], 25],
  ["Word Break", "Medium", "DP", ["Google", "TCS"], 25],
  ["Linked List Cycle II", "Medium", "Linked Lists", ["Microsoft", "Accenture"], 25],
  ["Reorder List", "Medium", "Linked Lists", ["Amazon", "Infosys"], 25],
  ["Product of Array Except Self", "Medium", "Arrays", ["Meta", "TCS"], 25],
  ["Find the Duplicate Number", "Medium", "Arrays", ["Amazon", "NVIDIA"], 25],
  ["Longest Increasing Subsequence", "Medium", "DP", ["Google", "Accenture"], 25],
  ["Coin Change", "Medium", "DP", ["Amazon", "Google", "TCS"], 25],
  ["Top K Frequent Elements", "Medium", "Heap", ["Amazon", "TCS"], 25],
  ["Kth Largest Element in an Array", "Medium", "Heap", ["Google", "Accenture", "NVIDIA"], 25],
  ["Subarray Sum Equals K", "Medium", "Prefix Sum", ["Amazon", "NVIDIA"], 25],
  ["Task Scheduler", "Medium", "Heap", ["Microsoft", "TCS"], 25],
  ["Median of Two Sorted Arrays", "Hard", "Binary Search", ["Google", "Amazon", "NVIDIA"], 50],
  ["Regular Expression Matching", "Hard", "DP", ["Meta", "NVIDIA"], 50],
  ["Merge K Sorted Lists", "Hard", "Heap", ["Google", "Amazon"], 50],
  ["Reverse Nodes in K-Group", "Hard", "Linked Lists", ["Microsoft", "Amazon"], 50],
  ["Longest Valid Parentheses", "Hard", "Stacks", ["Microsoft", "Meta"], 50],
  ["Sudoku Solver", "Hard", "Backtracking", ["NVIDIA", "Google"], 50],
  ["First Missing Positive", "Hard", "Arrays", ["Amazon", "Google"], 50],
  ["Trapping Rain Water", "Hard", "Two Pointers", ["Amazon", "Accenture"], 50],
  ["Wildcard Matching", "Hard", "DP", ["NVIDIA", "Google"], 50],
  ["N-Queens", "Hard", "Backtracking", ["Google", "TCS Digital"], 50],
  ["Text Justification", "Hard", "Strings", ["Amazon"], 50],
  ["Edit Distance", "Hard", "DP", ["Google", "Adobe", "NVIDIA"], 50],
  ["Minimum Window Substring", "Hard", "Sliding Window", ["Amazon", "Google"], 50],
  ["Largest Rectangle in Histogram", "Hard", "Stacks", ["Microsoft", "Meta"], 50],
  ["Maximal Rectangle", "Hard", "DP", ["Meta", "Amazon"], 50],
  ["Serialize and Deserialize Binary Tree", "Hard", "Trees", ["Amazon", "Google"], 50],
  ["Binary Tree Maximum Path Sum", "Hard", "Trees", ["Amazon", "Microsoft"], 50],
  ["Alien Dictionary", "Hard", "Graphs", ["Google", "Amazon"], 50],
  ["Word Ladder II", "Hard", "Graphs", ["Meta", "Amazon"], 50],
  ["Critical Connections in a Network", "Hard", "Graphs", ["Google", "Amazon"], 50],
  ["Reconstruct Itinerary", "Hard", "Graphs", ["Google"], 50],
  ["Cheapest Flights Within K Stops", "Hard", "Graphs", ["Amazon", "Google"], 50],
  ["Find Median from Data Stream", "Hard", "Heap", ["Google", "Amazon"], 50],
  ["Burst Balloons", "Hard", "DP", ["Google", "Adobe"], 50],
  ["Palindrome Partitioning II", "Hard", "DP", ["Google", "Amazon"], 50],
  ["Super Egg Drop", "Hard", "DP", ["Google"], 50],
  ["Split Array Largest Sum", "Hard", "Binary Search", ["Google", "Amazon"], 50],
  ["Basic Calculator", "Hard", "Stacks", ["Amazon", "Microsoft"], 50],
  ["Expression Add Operators", "Hard", "Backtracking", ["Google", "Meta"], 50],
  ["Word Search II", "Hard", "Tries", ["Amazon", "Google"], 50],
  ["Palindrome Pairs", "Hard", "Tries", ["Google", "Amazon"], 50],
  ["Count of Smaller Numbers After Self", "Hard", "Segment Tree", ["Google", "Amazon"], 50],
  ["LFU Cache", "Hard", "Design", ["Google", "Amazon", "NVIDIA"], 50],
  ["Max Points on a Line", "Hard", "Math", ["Google", "Meta"], 50],
  ["Remove Invalid Parentheses", "Hard", "Backtracking", ["Google", "Meta"], 50],
  ["Bus Routes", "Hard", "Graphs", ["Google", "Amazon"], 50],
  ["Making a Large Island", "Hard", "Graphs", ["Google"], 50],
  ["Concatenated Words", "Hard", "DP", ["Amazon", "Google"], 50],
  ["Race Car", "Hard", "DP", ["Google"], 50],
  ["Longest Increasing Path in a Matrix", "Hard", "Graphs", ["Google", "Amazon"], 50],
  ["Design In-Memory File System", "Hard", "Design", ["Google"], 50],
  ["Optimal Account Balancing", "Hard", "Backtracking", ["Google"], 50],
  ["Meeting Rooms III", "Hard", "Heap", ["NVIDIA", "Google"], 50],
  ["Thread-safe Queue Design", "Hard", "Systems", ["NVIDIA"], 50],
  ["Producer Consumer Problem", "Hard", "Systems", ["NVIDIA"], 50],
  ["Custom Memory Pool", "Hard", "Systems", ["NVIDIA"], 50],
  ["Rate Limiter Design", "Hard", "System Design", ["Google", "Amazon"], 50],
  ["URL Shortener Design", "Hard", "System Design", ["Google", "Microsoft"], 50],
];

const dsaExpansionTopics = {
  Arrays: ["Prefix Sum", "Kadane", "Two Pointers", "Sorting", "Intervals", "Matrix"],
  Strings: ["Anagram", "Palindrome", "Substring", "Pattern Matching", "Frequency Map", "Parsing"],
  "Linked Lists": ["Fast Slow Pointers", "Reversal", "Merge", "Cycle Detection", "Dummy Node", "Pointer Rewiring"],
  Stacks: ["Monotonic Stack", "Expression Evaluation", "Parentheses", "Next Greater Element", "Histogram", "Min Stack"],
  Queues: ["BFS Queue", "Deque", "Sliding Window Maximum", "Circular Queue", "Task Processing", "Level Order"],
  Trees: ["DFS", "BFS", "BST", "Lowest Common Ancestor", "Path Sum", "Serialization"],
  Graphs: ["BFS", "DFS", "Topological Sort", "Union Find", "Shortest Path", "Connected Components"],
  DP: ["1D DP", "2D DP", "Knapsack", "LIS", "Grid DP", "Interval DP"],
  Greedy: ["Intervals", "Scheduling", "Heap Greedy", "Sorting Greedy", "Reachability", "Resource Allocation"],
  Backtracking: ["Subsets", "Permutations", "Combinations", "Grid Search", "Constraint Search", "Partitioning"],
};

const dsaExpansionTasks = [
  "Find the minimum operations for",
  "Count valid arrangements in",
  "Return the lexicographically smallest result for",
  "Detect whether a valid configuration exists in",
  "Compute the maximum score from",
  "Recover the original order from",
  "Remove the fewest invalid elements in",
  "Split input into optimal groups for",
  "Find all stable states in",
  "Optimize the running cost of",
  "Build a validation routine for",
  "Find the longest balanced segment in",
  "Calculate the number of reachable states in",
  "Return the first conflicting pair in",
  "Compress repeated decisions in",
  "Find the shortest transformation for",
  "Choose the best boundary for",
  "Track rolling constraints in",
  "Merge overlapping decisions in",
  "Find the hidden duplicate pattern in",
  "Restore missing checkpoints in",
  "Calculate interview-ready edge cases for",
  "Design an efficient query answerer for",
  "Compare two encoded structures in",
  "Find the safest traversal path in",
  "Reorder values to satisfy constraints in",
  "Calculate the minimum penalty for",
  "Return all unique outputs from",
  "Check consistency of dependencies in",
  "Find the optimal pivot for",
];

const expansionCompanies = [
  ["Amazon", "TCS", "Accenture"],
  ["Google", "Microsoft", "NVIDIA"],
  ["Infosys", "Wipro", "Capgemini"],
  ["Adobe", "Uber", "Oracle"],
  ["Meta", "Salesforce", "Zoho"],
];

function generatedQuestionSeeds() {
  const difficulties = ["Easy", "Medium", "Hard"];
  const xpByDifficulty = { Easy: 10, Medium: 25, Hard: 50 };
  const seeds = [];
  let companyIndex = 0;
  for (const [topic, patterns] of Object.entries(dsaExpansionTopics)) {
    patterns.forEach((pattern, patternIndex) => {
      dsaExpansionTasks.forEach((task, taskIndex) => {
        const difficulty = difficulties[(patternIndex + taskIndex) % difficulties.length];
        const title = `${task} ${pattern} ${topic}`;
        seeds.push([title, difficulty, topic, expansionCompanies[companyIndex % expansionCompanies.length], xpByDifficulty[difficulty]]);
        companyIndex += 1;
      });
    });
  }
  return seeds;
}

const allQuestionSeeds = [
  ...questionSeeds,
  ...generatedQuestionSeeds().filter(([title]) => !questionSeeds.some(([existingTitle]) => existingTitle === title)),
];

const mcqSeeds = [
  ["Stack follows?", ["FIFO", "LIFO", "Random", "None"], ["LIFO"], "Stack uses last in, first out.", "DSA"],
  ["Which data structure is best for BFS?", ["Stack", "Queue", "Trie", "Heap"], ["Queue"], "BFS explores level by level, so a queue is the natural structure.", "DSA"],
  ["Binary search requires?", ["Sorted data", "Only strings", "Hash table", "Tree only"], ["Sorted data"], "Binary search depends on ordered search space.", "DSA"],
  ["Which technique solves overlapping subproblems?", ["Dynamic Programming", "Binary Search only", "Sorting only", "Hashing only"], ["Dynamic Programming"], "DP stores reusable answers for repeated subproblems.", "DSA"],
  ["Which command shows current directory?", ["ls", "pwd", "cd", "dir"], ["pwd"], "pwd prints the current working directory.", "Linux"],
  ["Which command changes permissions?", ["chmod", "grep", "pwd", "touch"], ["chmod"], "chmod modifies file permission bits.", "Linux"],
  ["Which command searches text patterns?", ["grep", "mkdir", "cd", "whoami"], ["grep"], "grep filters text by pattern.", "Linux"],
  ["Which file commonly stores scheduled cron jobs?", ["crontab", "hosts", "shadow", "resolv.conf"], ["crontab"], "crontab stores cron schedule entries.", "Linux"],
  ["DNS is used to?", ["Encrypt packets", "Resolve domain names", "Compile code", "Schedule process"], ["Resolve domain names"], "DNS maps domain names to IP addresses.", "Networking"],
  ["TCP is mainly?", ["Connection-oriented", "Connectionless only", "A database", "A UI framework"], ["Connection-oriented"], "TCP establishes reliable ordered delivery.", "Networking"],
  ["HTTPS uses?", ["TLS", "FTP", "Plain text only", "ARP"], ["TLS"], "HTTPS is HTTP over TLS.", "Networking"],
  ["Default DNS port is?", ["53", "80", "443", "22"], ["53"], "DNS commonly uses port 53.", "Networking"],
  ["ACID stands for?", ["Atomicity Consistency Isolation Durability", "Access Control Identity Data", "Array Class Interface Data", "None"], ["Atomicity Consistency Isolation Durability"], "ACID defines transaction reliability.", "DBMS"],
  ["Which SQL clause filters grouped rows?", ["HAVING", "WHERE only", "ORDER BY", "LIMIT"], ["HAVING"], "HAVING filters after GROUP BY aggregation.", "DBMS"],
  ["Normalization reduces?", ["Data redundancy", "Network latency", "CPU speed", "Encryption"], ["Data redundancy"], "Normalization organizes tables to reduce duplication.", "DBMS"],
  ["Indexing mainly improves?", ["Read/search speed", "RAM capacity", "CSS design", "Password strength"], ["Read/search speed"], "Indexes speed lookups at the cost of storage and write overhead.", "DBMS"],
  ["Deadlock requires?", ["Mutual exclusion", "No loops", "Only one process", "No resources"], ["Mutual exclusion"], "Mutual exclusion is one of the Coffman conditions.", "Operating Systems"],
  ["A process is?", ["Program in execution", "Only a file", "Only a thread", "A database row"], ["Program in execution"], "A process is an executing program with its own resources.", "Operating Systems"],
  ["Paging is used for?", ["Memory management", "DNS routing", "UI rendering", "SQL indexing"], ["Memory management"], "Paging divides memory into fixed-size blocks.", "Operating Systems"],
  ["Semaphore is used for?", ["Synchronization", "Image editing", "Subnetting", "Sorting only"], ["Synchronization"], "Semaphores control access to shared resources.", "Operating Systems"],
  ["S3 is primarily?", ["Compute", "Object storage", "Database only", "DNS"], ["Object storage"], "Amazon S3 is object storage.", "Cloud"],
  ["IaaS gives users?", ["Virtual infrastructure control", "Only email", "Only source control", "Only UI templates"], ["Virtual infrastructure control"], "IaaS exposes compute, network, and storage primitives.", "Cloud"],
  ["Kubernetes mainly manages?", ["Containers", "Spreadsheets", "DNS names only", "Passwords only"], ["Containers"], "Kubernetes orchestrates containerized workloads.", "Cloud"],
  ["Least privilege means?", ["Give only required access", "Give admin access to all", "Disable authentication", "Share passwords"], ["Give only required access"], "Least privilege limits permissions to what is needed.", "Cloud"],
  ["XSS targets?", ["Database schema", "Browser execution", "CPU scheduler", "DNS"], ["Browser execution"], "XSS injects scripts into web pages.", "Cyber Security"],
  ["SQL injection is prevented mainly by?", ["Parameterized queries", "Plain string concatenation", "Disabling CSS", "Increasing RAM"], ["Parameterized queries"], "Parameterized queries separate code from data.", "Cyber Security"],
  ["CIA triad includes?", ["Confidentiality Integrity Availability", "Code Input API", "Cloud Identity Access", "None"], ["Confidentiality Integrity Availability"], "CIA is a core security model.", "Cyber Security"],
  ["Hashing is normally?", ["One-way", "Always reversible", "A sorting algorithm", "A UI animation"], ["One-way"], "Secure hashes are designed to be difficult to reverse.", "Cyber Security"],
  ["RAG combines LLMs with?", ["Only CSS", "External retrieval", "CPU cache", "Binary trees"], ["External retrieval"], "RAG retrieves context before generation.", "AI/ML"],
  ["Supervised learning uses?", ["Labeled data", "Only unlabeled data", "Only DNS records", "No examples"], ["Labeled data"], "Supervised learning trains from input-output examples.", "AI/ML"],
  ["Overfitting means?", ["Model memorizes training patterns too much", "Model cannot compile", "Network is slow", "Database is normalized"], ["Model memorizes training patterns too much"], "Overfit models perform well on training data but poorly on unseen data.", "AI/ML"],
  ["F1-score combines?", ["Precision and recall", "CPU and GPU", "DNS and DHCP", "HTML and CSS"], ["Precision and recall"], "F1 is the harmonic mean of precision and recall.", "AI/ML"],
  ["CI/CD primarily improves?", ["Automation of build, test, and release", "Manual deployment only", "No testing", "CSS styling"], ["Automation of build, test, and release"], "CI/CD automates delivery pipelines.", "DevOps"],
  ["Docker image is?", ["A packaged filesystem and metadata", "A running VM always", "A database index", "A firewall rule"], ["A packaged filesystem and metadata"], "Images are immutable templates used to start containers.", "DevOps"],
  ["Terraform is used for?", ["Infrastructure as Code", "Packet capture only", "Image compression", "CSS generation"], ["Infrastructure as Code"], "Terraform declaratively provisions infrastructure.", "DevOps"],
  ["Blue-green deployment uses?", ["Two production-like environments", "Only one broken server", "No rollback path", "Manual SQL only"], ["Two production-like environments"], "Traffic can switch between blue and green environments.", "DevOps"],
];

function createInitialDb() {
  const contentItems = parseMasterPackContent();
  return {
    seedVersion: 4,
    contentReferenceNote,
    users: [],
    contentItems,
    questions: allQuestionSeeds.map(buildQuestion),
    mcqs: [],
    roadmaps: careerRoadmapSeeds,
    companies: [
      { id: "tcs", name: "TCS", eligibility: "Usually 60% academics, role dependent", process: ["Aptitude", "Coding", "Technical", "HR"], questions: ["C vs Java", "OOP concepts", "SQL queries", "Arrays", "Strings", "Number theory"], salary: "3.3-7 LPA", note: contentReferenceNote },
      { id: "infosys", name: "Infosys", eligibility: "Usually 60% academics, role dependent", process: ["Aptitude", "Pseudocode", "Technical Interview"], questions: ["DBMS", "OS", "Networking", "SQL", "OOP", "Puzzles"], salary: "3.6-9.5 LPA", note: contentReferenceNote },
      { id: "wipro", name: "Wipro", eligibility: "Campus and role dependent", process: ["Aptitude", "Verbal", "Coding", "Technical", "HR"], questions: ["Aptitude", "Verbal", "Coding basics", "Java", "DBMS"], salary: "3.5-6.5 LPA", note: contentReferenceNote },
      { id: "accenture", name: "Accenture", eligibility: "Campus and role dependent", process: ["Cognitive", "Technical MCQ", "Coding", "Communication", "Interview"], questions: ["OOP", "Java", "Python", "SQL", "Pseudocode", "Arrays", "Strings"], salary: "4.5-6.5 LPA", note: contentReferenceNote },
      { id: "cognizant", name: "Cognizant", eligibility: "Campus and role dependent", process: ["Aptitude", "Coding", "Technical", "HR"], questions: ["DSA basics", "Java Collections", "DBMS", "SQL"], salary: "4-7 LPA", note: contentReferenceNote },
      { id: "capgemini", name: "Capgemini", eligibility: "Campus and role dependent", process: ["Aptitude", "Coding", "Technical", "HR"], questions: ["SQL", "Java", "OOP", "Pseudo code", "Communication"], salary: "3.8-7.5 LPA", note: contentReferenceNote },
      { id: "google", name: "Google", eligibility: "Strong algorithms, CS fundamentals, projects", process: ["OA", "DSA rounds", "System Design for senior roles", "Googliness"], questions: ["Graphs", "DP", "Algorithms", "System Design", "Behavioral"], salary: "30-80 LPA", note: contentReferenceNote },
      { id: "amazon", name: "Amazon", eligibility: "Strong DSA, projects, leadership examples", process: ["OA", "DSA", "System Design for senior roles", "Bar Raiser"], questions: ["Arrays", "Trees", "Graphs", "DP", "Leadership Principles"], salary: "18-45 LPA", note: contentReferenceNote },
      { id: "microsoft", name: "Microsoft", eligibility: "Strong DSA, CS fundamentals, projects", process: ["OA", "DSA", "Technical", "Hiring Manager"], questions: ["Trees", "DP", "System Design", "OOP", "Projects"], salary: "20-55 LPA", note: contentReferenceNote },
      { id: "nvidia", name: "NVIDIA", eligibility: "Role dependent, strong systems and performance basics help", process: ["Coding", "Technical deep-dive", "Systems/C++ for relevant roles", "Managerial"], questions: ["Binary Search", "Heap", "Threads", "Memory", "C/C++", "Optimization"], salary: "18-55 LPA", note: contentReferenceNote },
    ],
    progress: [],
    contentProgress: [],
    mcqResults: [],
    notes: [],
    roadmapProgress: [],
  };
}

const dsaProblemOverrides = {
  "Two Sum": {
    problem: "Given an array of integers nums and an integer target, return the indices of the two numbers whose sum equals target. Each input has exactly one valid pair, and the same element cannot be used twice.",
    examples: ["Input: nums = [2,7,11,15], target = 9 -> Output: [0,1]", "Input: nums = [3,2,4], target = 6 -> Output: [1,2]"],
    constraints: ["2 <= nums.length <= 100000", "-1000000000 <= nums[i], target <= 1000000000", "Return any valid pair if multiple pairs exist"],
    hints: ["Store each number's index while scanning.", "For every value x, check whether target - x has already appeared."],
    solution: "Use a hash map from value to index. Scan the array once; before inserting nums[i], check whether target - nums[i] exists in the map. This returns the pair in linear time.",
    timeComplexity: "O(n)",
    spaceComplexity: "O(n)",
  },
  "Valid Parentheses": {
    problem: "Given a string containing only brackets '(', ')', '{', '}', '[' and ']', determine whether every opening bracket is closed by the same type of bracket in the correct order.",
    examples: ["Input: s = \"()[]{}\" -> Output: true", "Input: s = \"(]\" -> Output: false"],
    constraints: ["1 <= s.length <= 100000", "s contains only bracket characters"],
    hints: ["The most recent open bracket must be closed first.", "Use a stack and a closing-to-opening map."],
    solution: "Push opening brackets onto a stack. For every closing bracket, the top of the stack must match its corresponding opener. At the end, the stack must be empty.",
    timeComplexity: "O(n)",
    spaceComplexity: "O(n)",
  },
  "Merge Two Sorted Lists": {
    problem: "Given the heads of two sorted linked lists, merge them into one sorted linked list by reusing the existing nodes, and return the head of the merged list.",
    examples: ["Input: list1 = [1,2,4], list2 = [1,3,4] -> Output: [1,1,2,3,4,4]", "Input: list1 = [], list2 = [0] -> Output: [0]"],
    constraints: ["0 <= list length <= 50000", "-100000 <= node.val <= 100000", "Both input lists are sorted in non-decreasing order"],
    hints: ["Use a dummy head to simplify pointer handling.", "Always attach the smaller current node."],
    solution: "Maintain a tail pointer on a dummy list. Compare the current nodes of both lists, attach the smaller node, and advance that list. Attach the remaining list at the end.",
    timeComplexity: "O(n + m)",
    spaceComplexity: "O(1)",
  },
  "Best Time to Buy and Sell Stock": {
    problem: "Given an array prices where prices[i] is the stock price on day i, choose one day to buy and a later day to sell so profit is maximized. Return the maximum profit, or 0 if no profit is possible.",
    examples: ["Input: prices = [7,1,5,3,6,4] -> Output: 5", "Input: prices = [7,6,4,3,1] -> Output: 0"],
    constraints: ["1 <= prices.length <= 100000", "0 <= prices[i] <= 100000"],
    hints: ["Track the cheapest price seen so far.", "At each day, calculate profit if sold today."],
    solution: "Scan once. Keep minPrice and maxProfit. For every price, update maxProfit with price - minPrice, then update minPrice.",
    timeComplexity: "O(n)",
    spaceComplexity: "O(1)",
  },
  "Binary Search": {
    problem: "Given a sorted integer array nums and a target, return the index of target if it exists. Otherwise return -1.",
    examples: ["Input: nums = [-1,0,3,5,9,12], target = 9 -> Output: 4", "Input: nums = [-1,0,3,5,9,12], target = 2 -> Output: -1"],
    constraints: ["1 <= nums.length <= 100000", "nums is sorted in ascending order", "All values fit in 32-bit signed integer range"],
    hints: ["Keep low and high pointers.", "Use mid = low + Math.floor((high - low) / 2) to avoid overflow in some languages."],
    solution: "Repeatedly compare target with nums[mid]. If equal, return mid. If target is smaller, search left half; otherwise search right half.",
    timeComplexity: "O(log n)",
    spaceComplexity: "O(1)",
  },
  "Maximum Subarray": {
    problem: "Given an integer array nums, find the contiguous non-empty subarray with the largest possible sum and return that sum.",
    examples: ["Input: nums = [-2,1,-3,4,-1,2,1,-5,4] -> Output: 6", "Input: nums = [5,4,-1,7,8] -> Output: 23"],
    constraints: ["1 <= nums.length <= 100000", "-10000 <= nums[i] <= 10000"],
    hints: ["A negative running sum hurts the next subarray.", "Keep the best sum ending at the current index."],
    solution: "Use Kadane's algorithm. current = max(nums[i], current + nums[i]); best = max(best, current).",
    timeComplexity: "O(n)",
    spaceComplexity: "O(1)",
  },
  "Reverse Linked List": {
    problem: "Given the head of a singly linked list, reverse the list and return the new head.",
    examples: ["Input: head = [1,2,3,4,5] -> Output: [5,4,3,2,1]", "Input: head = [] -> Output: []"],
    constraints: ["0 <= number of nodes <= 100000", "-100000 <= node.val <= 100000"],
    hints: ["Keep previous, current, and next pointers.", "Reverse one link at a time."],
    solution: "Iterate through the list. Save next, point current.next to previous, then move previous and current forward.",
    timeComplexity: "O(n)",
    spaceComplexity: "O(1)",
  },
  "Number of Islands": {
    problem: "Given a 2D grid of '1' land and '0' water, count how many islands exist. An island is connected horizontally or vertically.",
    examples: ["Input: grid = [[1,1,0],[0,1,0],[1,0,1]] -> Output: 3", "Input: grid = [[1,1],[1,1]] -> Output: 1"],
    constraints: ["1 <= rows, cols <= 300", "grid contains only 0/1 or '0'/'1' values"],
    hints: ["When land is found, flood-fill the full connected component.", "DFS, BFS, or Union Find work."],
    solution: "Scan every cell. When unvisited land is found, increment count and run DFS/BFS to mark all connected land visited.",
    timeComplexity: "O(rows * cols)",
    spaceComplexity: "O(rows * cols) worst case for recursion/queue",
  },
  "LRU Cache": {
    problem: "Design a data structure that supports get(key) and put(key, value) in O(1) average time while evicting the least recently used key when capacity is exceeded.",
    examples: ["Input: put(1,1), put(2,2), get(1), put(3,3), get(2) -> Output: 1, -1", "Capacity 2 should evict the key that has not been used for the longest time."],
    constraints: ["1 <= capacity <= 100000", "Operations should be O(1) average time"],
    hints: ["Hash map gives O(1) lookup.", "Doubly linked list gives O(1) move-to-front and eviction."],
    solution: "Use a hash map from key to node and a doubly linked list ordered by recency. Move accessed nodes to the front and remove from the tail on eviction.",
    timeComplexity: "O(1) per get/put average",
    spaceComplexity: "O(capacity)",
  },
  "Trapping Rain Water": {
    problem: "Given an array height where each element is a bar height, compute how much water can be trapped after raining.",
    examples: ["Input: height = [0,1,0,2,1,0,1,3,2,1,2,1] -> Output: 6", "Input: height = [4,2,0,3,2,5] -> Output: 9"],
    constraints: ["1 <= height.length <= 100000", "0 <= height[i] <= 100000"],
    hints: ["Water above an index is limited by the smaller of left max and right max.", "Two pointers can avoid extra arrays."],
    solution: "Use two pointers with leftMax and rightMax. Move the side with smaller boundary and add trapped water based on that boundary.",
    timeComplexity: "O(n)",
    spaceComplexity: "O(1)",
  },
};

function genericProblemSpec(title, difficulty, topic) {
  const lowerTopic = String(topic || "").toLowerCase();
  if (/graph|bfs|dfs/.test(lowerTopic)) {
    return {
      problem: `Given a graph-related input for "${title}", compute the required result while correctly handling disconnected components, cycles, and repeated visits.`,
      examples: ["Input: graph = [[1,2],[0,3],[0],[1]], start = 0 -> Output: valid traversal/result based on the task", "Input should include edge cases such as empty adjacency lists and isolated nodes."],
      constraints: ["1 <= nodes <= 100000", "0 <= edges <= 200000", "Avoid revisiting nodes"],
      hints: ["Build an adjacency representation first.", "Use BFS/DFS with a visited set; use topological sort if dependencies are directed."],
      solution: "Model the input as a graph, choose BFS/DFS/Union Find/topological sort based on the required output, and maintain visited/state arrays to avoid repeated work.",
      timeComplexity: "O(V + E)",
      spaceComplexity: "O(V + E)",
    };
  }
  if (/dynamic|dp|recursion/.test(lowerTopic)) {
    return {
      problem: `Solve "${title}" by defining states, transitions, base cases, and the final answer. Return the optimal count/value/decision requested by the problem.`,
      examples: ["Input: small case where choices overlap -> Output: optimal result", "Include an edge case with empty input or single element if allowed."],
      constraints: ["1 <= n <= 100000 depending on the problem", "Use memoization or tabulation to avoid exponential recomputation"],
      hints: ["Ask: what changes between subproblems?", "Write the recurrence before coding."],
      solution: "Define a DP state, initialize base cases, iterate or memoize transitions, and return the state that represents the full problem.",
      timeComplexity: difficulty === "Hard" ? "Usually O(n^2) or optimized based on state count" : "O(number of states * transition cost)",
      spaceComplexity: "O(number of states)",
    };
  }
  if (/tree|bst|heap|trie/.test(lowerTopic)) {
    return {
      problem: `Given a ${topic} structure for "${title}", return the required traversal, validation, query result, or transformed structure while preserving the problem invariants.`,
      examples: ["Input: root = [3,9,20,null,null,15,7] -> Output: result based on traversal/validation task", "Input: root = [] -> Output: empty/default result"],
      constraints: ["0 <= nodes <= 100000", "Node values fit in integer range", "Avoid stack overflow for very deep structures where needed"],
      hints: ["Recursive DFS is natural for most tree tasks.", "Use BFS when the question asks for level-wise behavior."],
      solution: "Choose DFS, BFS, heap operations, or trie traversal based on the structure. Track the exact invariant the question asks you to prove or compute.",
      timeComplexity: "O(n)",
      spaceComplexity: "O(h) to O(n)",
    };
  }
  if (/linked/.test(lowerTopic)) {
    return {
      problem: `Given one or more linked lists, solve "${title}" by manipulating node pointers without losing access to the remaining list.`,
      examples: ["Input: head = [1,2,3,4] -> Output: transformed list based on the task", "Input: head = [] -> Output: []"],
      constraints: ["0 <= nodes <= 100000", "Prefer pointer manipulation over copying values unless the problem allows it"],
      hints: ["Dummy nodes simplify head changes.", "Slow/fast pointers help with cycles and middle positions."],
      solution: "Use dummy pointers, slow/fast pointers, or reversal depending on the task. Carefully save next pointers before rewiring links.",
      timeComplexity: "O(n)",
      spaceComplexity: "O(1)",
    };
  }
  return {
    problem: `Given input data for "${title}", write an efficient function that returns the exact result requested by the interview problem. Handle normal, boundary, and duplicate cases.`,
    examples: ["Input: representative small case -> Output: expected result", "Input: edge case with duplicates/empty/minimum values -> Output: correct boundary result"],
    constraints: ["1 <= n <= 100000 unless stated otherwise", "Aim for O(n) or O(n log n) before accepting brute force", "Handle duplicates and negative values when relevant"],
    hints: ["Identify whether the core pattern is hashing, two pointers, sorting, stack, or sliding window.", "Write down the invariant maintained by your loop."],
    solution: "Start from the brute force idea, then optimize using the strongest matching pattern: hash map for lookups, two pointers for ordered data, stack for nearest/open-close relations, or sliding window for contiguous ranges.",
    timeComplexity: difficulty === "Easy" ? "O(n)" : "O(n log n) or better depending on constraints",
    spaceComplexity: "O(n) worst case",
  };
}

function dsaProblemSpec(title, difficulty, topic) {
  return dsaProblemOverrides[title] || genericProblemSpec(title, difficulty, topic);
}

function buildQuestion([title, difficulty, topic, companies, xp]) {
  const spec = dsaProblemSpec(title, difficulty, topic);
  return {
    id: slug(title),
    title,
    difficulty,
    topic,
    companies,
    xp,
    referenceNote: contentReferenceNote,
    problem: spec.problem,
    explanation: `${title} is a ${difficulty.toLowerCase()} ${topic} interview problem. Focus on the input contract, edge cases, and the optimal pattern before writing code.`,
    examples: spec.examples,
    constraints: spec.constraints,
    hints: spec.hints,
    solution: spec.solution,
    timeComplexity: spec.timeComplexity,
    spaceComplexity: spec.spaceComplexity,
  };
}

function buildMcq([question, options, correctAnswer, explanation, topic], index) {
  return {
    id: `mcq-${index + 1}`,
    question,
    options,
    correctAnswer,
    explanation,
    topic,
    referenceNote: contentReferenceNote,
  };
}

function enrichCompany(company) {
  const focus = company.questions || [];
  return {
    ...company,
    hiringProcess: company.process || [],
    interviewStages: [
      "Online assessment or aptitude screening",
      "Coding or technical MCQ round",
      "Technical interview focused on projects and fundamentals",
      "HR or managerial discussion",
    ],
    codingQuestions: [
      `Solve array and string problems frequently mapped to ${company.name}.`,
      `Revise ${focus.slice(0, 3).join(", ") || "DSA fundamentals"} before the coding round.`,
      "Practice explaining brute force, optimized approach, complexity, and edge cases.",
    ],
    hrQuestions: [
      "Tell me about yourself.",
      `Why do you want to join ${company.name}?`,
      "Explain one project you are proud of.",
      "Tell me about a challenge or conflict you handled.",
      "Where do you see yourself in the next two years?",
    ],
    preparationTips: [
      "Verify current eligibility, package, and process from official role or campus notices.",
      "Prepare one strong project explanation with architecture, database, APIs, and tradeoffs.",
      "Revise CS fundamentals and practice speaking answers clearly, not just solving silently.",
      "Keep company tags as preparation signals because interview patterns can change every year.",
    ],
  };
}

function cleanContentItems(items) {
  const seenMcqQuestions = new Set();
  const seenMcqSignatures = new Set();
  const result = [];
  for (const item of items || []) {
    if (isPlaceholderContentItem(item)) continue;
    if (item.type !== "MCQ") {
      result.push(decorateContentItem(item));
      continue;
    }
    const mcq = normalizeMcq(item);
    if (!isQualityMcq(mcq)) continue;
    const questionKey = normalizeMcqText(mcq.question);
    const signatureKey = mcqSignature(mcq);
    if (seenMcqQuestions.has(questionKey) || seenMcqSignatures.has(signatureKey)) continue;
    seenMcqQuestions.add(questionKey);
    seenMcqSignatures.add(signatureKey);
    result.push({ ...item, ...mcq });
  }
  return result;
}

function isPlaceholderContentItem(item) {
  const text = `${item.question || ""} ${item.title || ""} ${item.sourceLine || ""}`;
  if (/Advanced System Design & Algorithm Challenge #\d+/i.test(text)) return true;
  if (/Challenge\s+\d+:\s*\[[^\]]+\]\s*-\s*Optimize the space-time complexity for large data stream processing/i.test(text)) return true;
  if (/vulnerability #\d+|deployment model #\d+|technique #\d+/i.test(text)) return true;
  return false;
}

function decorateContentItem(item) {
  if (!item || item.type !== "DSA") return item;
  const title = item.question || item.title;
  const topic = (item.topicTags || []).find((tag) => tag !== "DSA") || inferTopic(title, "DSA");
  const spec = dsaProblemSpec(title, item.difficulty || "Medium", topic);
  return {
    ...item,
    title,
    problem: spec.problem,
    examples: spec.examples,
    constraints: spec.constraints,
    hints: spec.hints,
    solution: spec.solution,
    timeComplexity: spec.timeComplexity,
    spaceComplexity: spec.spaceComplexity,
    preview: spec.problem,
  };
}

function migrateDb(db) {
  let changed = false;
  db.seedVersion ||= 1;
  db.contentReferenceNote ||= contentReferenceNote;
  db.contentItems ||= [];
  db.contentProgress ||= [];
  if ((db.mcqs || []).length) {
    db.mcqs = [];
    changed = true;
  }
  const parsedContent = parseMasterPackContent();
  if (parsedContent.length) {
    const datasetContent = readDatasetContent();
    if (datasetContent.length) {
      const cleanDatasetContent = cleanContentItems(datasetContent);
      if (JSON.stringify(db.contentItems) !== JSON.stringify(cleanDatasetContent)) {
        db.contentItems = cleanDatasetContent;
        changed = true;
      }
    } else {
      const existingKeys = new Set(db.contentItems.map((item) => `${item.type}:${item.question}`.toLowerCase()));
      for (const item of parsedContent) {
        const key = `${item.type}:${item.question}`.toLowerCase();
        if (!existingKeys.has(key)) {
          db.contentItems.push(item);
          existingKeys.add(key);
          changed = true;
        }
      }
    }
  }
  const cleanItems = cleanContentItems(db.contentItems);
  if (JSON.stringify(db.contentItems) !== JSON.stringify(cleanItems)) {
    db.contentItems = cleanItems;
    changed = true;
  }
  const cleanResults = (db.mcqResults || []).filter((result) => !(result.checked || []).some((item) => !isQualityMcq(normalizeMcq(item))));
  if (cleanResults.length !== (db.mcqResults || []).length) {
    db.mcqResults = cleanResults;
    changed = true;
  }
  for (const seed of allQuestionSeeds) {
    const question = buildQuestion(seed);
    const existing = db.questions.find((item) => item.id === question.id);
    if (!existing) {
      db.questions.push(question);
      changed = true;
    } else {
      const needsRefresh = !existing.referenceNote
        || /^Solve .+ using a clean and interview-ready approach\.$/.test(existing.problem || "")
        || !Array.isArray(existing.examples)
        || existing.examples.includes("Input example");
      if (needsRefresh) {
        Object.assign(existing, { ...existing, ...question, progress: existing.progress });
        changed = true;
      }
    }
  }
  for (const company of createInitialDb().companies) {
    const existing = db.companies.find((item) => item.id === company.id);
    if (!existing) {
      db.companies.push(company);
      changed = true;
    } else if (!existing.note) {
      existing.note = contentReferenceNote;
      changed = true;
    }
  }
  db.roadmaps ||= [];
  for (const roadmap of careerRoadmapSeeds) {
    const existing = db.roadmaps.find((item) => item.id === roadmap.id);
    if (!existing) {
      db.roadmaps.push(roadmap);
      changed = true;
    } else {
      const merged = { ...existing, ...roadmap };
      if (JSON.stringify(existing) !== JSON.stringify(merged)) {
        Object.assign(existing, merged);
        changed = true;
      }
    }
  }
  for (const user of db.users) {
    user.profilePicture ||= "";
    user.phone ||= "";
    user.bio ||= "";
    user.college ||= "";
    user.skills ||= [];
    user.socialLinks ||= { github: "", linkedin: "", portfolio: "" };
    user.settings ||= { theme: "dark" };
    user.lastViewed ||= { topic: "", questionId: "", roadmapId: "", quizId: "" };
    user.role ||= ADMIN_EMAILS.includes(String(user.email || "").toLowerCase()) ? "admin" : "student";
    user.resetTokenHash ||= "";
    user.resetTokenExpiresAt ||= 0;
  }
  if (db.seedVersion < 4) {
    db.seedVersion = 4;
    changed = true;
  }
  return changed;
}

function ensureDb() {
  if (!existsSync(dataDir)) mkdirSync(dataDir);
  if (!existsSync(dbPath)) writeFileSync(dbPath, JSON.stringify(createInitialDb(), null, 2));
}

function readDb() {
  if (activeDb) return activeDb;
  ensureDb();
  const db = JSON.parse(readFileSync(dbPath, "utf8"));
  if (migrateDb(db)) writeDb(db);
  activeDb = db;
  return db;
}

function writeDb(db) {
  activeDb = db;
  writeFileSync(dbPath, JSON.stringify(db, null, 2));
  scheduleMongoPersist(db);
}

function stripMongoId(record) {
  if (!record || typeof record !== "object") return record;
  const { _id, ...clean } = record;
  return clean;
}

async function loadDbFromMongo() {
  const db = createInitialDb();
  for (const collectionName of mongoCollections) {
    db[collectionName] = (await mongoDatabase.collection(collectionName).find({}).toArray()).map(stripMongoId);
  }
  const meta = await mongoDatabase.collection("meta").findOne({ key: "app" });
  db.seedVersion = meta?.seedVersion || db.seedVersion;
  db.contentReferenceNote = meta?.contentReferenceNote || contentReferenceNote;
  return db;
}

async function persistDbToMongo(db) {
  if (!mongoReady || !mongoDatabase) return;
  for (const collectionName of mongoCollections) {
    const records = Array.isArray(db[collectionName]) ? db[collectionName] : [];
    const collection = mongoDatabase.collection(collectionName);
    await collection.deleteMany({});
    if (records.length) await collection.insertMany(records.map((record) => ({ ...record })), { ordered: false });
  }
  await mongoDatabase.collection("meta").updateOne(
    { key: "app" },
    { $set: { key: "app", seedVersion: db.seedVersion, contentReferenceNote: db.contentReferenceNote, updatedAt: new Date().toISOString() } },
    { upsert: true },
  );
}

function scheduleMongoPersist(db) {
  if (!mongoReady) return;
  clearTimeout(mongoPersistTimer);
  mongoPersistTimer = setTimeout(() => {
    persistDbToMongo(db).catch((err) => console.error("MongoDB persist failed:", err.message));
  }, 250);
}

async function ensureMongoIndexes() {
  if (!mongoDatabase) return;
  await Promise.all([
    mongoDatabase.collection("users").createIndex({ email: 1 }, { unique: true, sparse: true }),
    mongoDatabase.collection("users").createIndex({ username: 1 }, { unique: true, sparse: true }),
    mongoDatabase.collection("contentItems").createIndex({ type: 1 }),
    mongoDatabase.collection("contentItems").createIndex({ difficulty: 1 }),
    mongoDatabase.collection("contentItems").createIndex({ category: 1 }),
    mongoDatabase.collection("contentItems").createIndex({ topicTags: 1 }),
    mongoDatabase.collection("contentItems").createIndex({ companyTags: 1 }),
    mongoDatabase.collection("contentProgress").createIndex({ userId: 1, contentId: 1 }),
    mongoDatabase.collection("progress").createIndex({ userId: 1, questionId: 1 }),
    mongoDatabase.collection("notes").createIndex({ userId: 1, questionId: 1 }),
    mongoDatabase.collection("notes").createIndex({ userId: 1, contentId: 1 }),
    mongoDatabase.collection("roadmapProgress").createIndex({ userId: 1, roadmapId: 1 }),
    mongoDatabase.collection("mcqResults").createIndex({ userId: 1, createdAt: -1 }),
  ]);
}

async function initializeDatabase() {
  ensureDb();
  const localDb = JSON.parse(readFileSync(dbPath, "utf8"));
  activeDb = localDb;
  if (migrateDb(activeDb)) writeDb(activeDb);

  if (!MONGODB_URI) return;
  try {
    mongoClient = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
    await mongoClient.connect();
    mongoDatabase = mongoClient.db(MONGODB_DB_NAME);
    mongoReady = true;
    mongoError = "";
    await ensureMongoIndexes();
    const existingUsers = await mongoDatabase.collection("users").countDocuments();
    const existingContent = await mongoDatabase.collection("contentItems").countDocuments();
    if (existingUsers || existingContent) {
      activeDb = await loadDbFromMongo();
      if (migrateDb(activeDb)) await persistDbToMongo(activeDb);
      writeFileSync(dbPath, JSON.stringify(activeDb, null, 2));
    } else {
      await persistDbToMongo(activeDb);
    }
    console.log(`MongoDB connected: ${MONGODB_DB_NAME}`);
  } catch (err) {
    mongoReady = false;
    mongoError = err.message;
    console.error(`MongoDB connection failed: ${err.message}`);
    if (MONGODB_STRICT) throw err;
  }
}

function publicUser(user = {}) {
  const { passwordHash, refreshTokenHash, resetTokenHash, devResetToken, ...safeUser } = user;
  return safeUser;
}

function isAdminUser(user) {
  return user?.role === "admin" || (user?.email && ADMIN_EMAILS.includes(user.email.toLowerCase()));
}

function rateLimit({ windowMs = 15 * 60 * 1000, max = 50, keyPrefix = "global" } = {}) {
  return (req, res, next) => {
    const key = `${keyPrefix}:${req.ip}:${req.path}`;
    const now = Date.now();
    const bucket = rateBuckets.get(key) || { count: 0, resetAt: now + windowMs };
    if (now > bucket.resetAt) {
      bucket.count = 0;
      bucket.resetAt = now + windowMs;
    }
    bucket.count += 1;
    rateBuckets.set(key, bucket);
    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader("X-RateLimit-Remaining", String(Math.max(0, max - bucket.count)));
    if (bucket.count > max) return res.status(429).json({ error: "Too many requests. Please try again later." });
    next();
  };
}

function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || "").split(";").filter(Boolean).map((cookie) => {
    const [key, ...value] = cookie.trim().split("=");
    return [key, decodeURIComponent(value.join("="))];
  }));
}

function createAccessToken(user) {
  return jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: "15m" });
}

function buildGoogleRedirectUri() {
  return `${API_URL}/api/auth/google/callback`;
}

async function setRefreshCookie(res, user) {
  const refreshToken = jwt.sign({ id: user.id, tokenId: randomUUID() }, REFRESH_SECRET, { expiresIn: "30d" });
  user.refreshTokenHash = await bcrypt.hash(refreshToken, 10);
  res.cookie("crackit_refresh", refreshToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: COOKIE_SECURE,
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

function clearRefreshCookie(res) {
  res.clearCookie("crackit_refresh", { httpOnly: true, sameSite: "lax", secure: COOKIE_SECURE, path: "/" });
}

function generateUniqueUsername(db, displayName, requestedUsername) {
  const base = normalizeUsername(requestedUsername || displayName);
  let candidate = base;
  let suffix = 1;
  while (db.users.some((user) => user.username === candidate)) {
    candidate = `${base}${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function usernameSuggestions(db, seed) {
  const base = normalizeUsername(seed || "coder");
  const suggestions = [];
  let suffix = 1;
  while (suggestions.length < 3) {
    const candidate = suffix === 1 ? `${base}1` : `${base}${suffix}`;
    if (!db.users.some((user) => user.username === candidate)) suggestions.push(candidate);
    suffix += 1;
  }
  return suggestions;
}

function updateStreak(user) {
  const current = today();
  if (!user.lastLogin) {
    user.currentStreak = 1;
    user.longestStreak = Math.max(user.longestStreak || 0, 1);
    user.lastLogin = current;
    return;
  }
  const diff = daysBetween(user.lastLogin, current);
  if (diff === 1) user.currentStreak = (user.currentStreak || 0) + 1;
  if (diff > 1) user.currentStreak = 1;
  user.longestStreak = Math.max(user.longestStreak || 0, user.currentStreak || 1);
  user.lastLogin = current;
}

function auth(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Missing token" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}

function adminAuth(req, res, next) {
  auth(req, res, () => {
    const db = readDb();
    const user = db.users.find((item) => item.id === req.user.id);
    if (!isAdminUser(user)) return res.status(403).json({ error: "Admin access required" });
    req.admin = publicUser(user);
    next();
  });
}

function optionalAuth(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return next();
  try {
    req.user = jwt.verify(token, JWT_SECRET);
  } catch {
    req.user = null;
  }
  next();
}

function userStats(db, userId) {
  const progress = db.progress.filter((item) => item.userId === userId);
  const contentProgress = (db.contentProgress || []).filter((item) => item.userId === userId);
  const solved = progress.filter((item) => item.status === "solved");
  const solvedContent = contentProgress.filter((item) => item.solved);
  const bookmarks = progress.filter((item) => item.bookmarked);
  const contentBookmarks = contentProgress.filter((item) => item.bookmarked);
  const xp = solved.reduce((sum, item) => sum + (db.questions.find((q) => q.id === item.questionId)?.xp || 0), 0) + solvedContent.length * 10;
  return { solvedCount: solved.length + solvedContent.length, bookmarkCount: bookmarks.length + contentBookmarks.length, xp, progress, contentProgress };
}

function mcqAnalytics(db, userId) {
  const attempts = (db.mcqResults || [])
    .filter((result) => result.userId === userId)
    .flatMap((result) => result.attempts || []);
  const byTopic = {};
  for (const attempt of attempts) {
    const key = attempt.topic || attempt.domain || "General";
    byTopic[key] ||= { topic: key, total: 0, correct: 0, timeTaken: 0, timed: 0 };
    byTopic[key].total += 1;
    byTopic[key].correct += attempt.score ? 1 : 0;
    if (attempt.time_taken) {
      byTopic[key].timeTaken += Number(attempt.time_taken);
      byTopic[key].timed += 1;
    }
  }
  const topics = Object.values(byTopic).map((entry) => ({
    ...entry,
    accuracy: entry.total ? Math.round((entry.correct / entry.total) * 100) : 0,
    averageTime: entry.timed ? Math.round(entry.timeTaken / entry.timed) : null,
  }));
  return {
    attempts: attempts.length,
    weakTopics: topics.filter((entry) => entry.total >= 1 && entry.accuracy < 60).sort((a, b) => a.accuracy - b.accuracy).slice(0, 5),
    strongTopics: topics.filter((entry) => entry.total >= 1 && entry.accuracy >= 80).sort((a, b) => b.accuracy - a.accuracy).slice(0, 5),
    accuracyByTopic: topics.sort((a, b) => b.total - a.total),
  };
}

app.post("/api/auth/register", rateLimit({ keyPrefix: "auth-register", max: 20 }), async (req, res) => {
  const db = readDb();
  const { name, email, password, confirmPassword, username, phone, profilePicture } = req.body;
  if (!name || !email || !password || !username) return res.status(400).json({ error: "Full name, username, email, and password are required" });
  if (!emailPattern.test(email)) return res.status(400).json({ error: "Enter a valid email address" });
  if (!strongPasswordPattern.test(password)) return res.status(400).json({ error: "Password must be at least 8 characters and include uppercase, lowercase, and a number" });
  if (confirmPassword !== undefined && confirmPassword !== password) return res.status(400).json({ error: "Passwords do not match" });
  if (db.users.some((user) => user.email.toLowerCase() === email.toLowerCase())) return res.status(409).json({ error: "Email already registered" });
  const normalizedRequestedUsername = normalizeUsername(username);
  if (db.users.some((user) => user.username === normalizedRequestedUsername)) {
    return res.status(409).json({ error: "Username already taken", suggestions: usernameSuggestions(db, normalizedRequestedUsername) });
  }
  const uniqueUsername = generateUniqueUsername(db, name, username);
  const user = {
    id: randomUUID(),
    email: email.toLowerCase(),
    phone: phone || "",
    displayName: name,
    username: uniqueUsername,
    role: ADMIN_EMAILS.includes(email.toLowerCase()) ? "admin" : "student",
    profilePicture: profilePicture || "",
    bio: "",
    college: "",
    skills: [],
    socialLinks: { github: "", linkedin: "", portfolio: "" },
    settings: { theme: "dark" },
    lastViewed: { topic: "", questionId: "", roadmapId: "", quizId: "" },
    passwordHash: await bcrypt.hash(password, 10),
    level: 1,
    xp: 0,
    currentStreak: 0,
    longestStreak: 0,
    lastLogin: null,
    createdAt: new Date().toISOString(),
  };
  updateStreak(user);
  db.users.push(user);
  await setRefreshCookie(res, user);
  writeDb(db);
  const token = createAccessToken(user);
  res.json({ token, user: publicUser(user) });
});

app.get("/api/auth/username-suggestions", (req, res) => {
  const db = readDb();
  const username = normalizeUsername(req.query.username || req.query.name || "coder");
  const available = !db.users.some((user) => user.username === username);
  res.json({ username, available, suggestions: available ? [] : usernameSuggestions(db, username) });
});

app.get("/api/auth/google/url", rateLimit({ keyPrefix: "auth-google", max: 30 }), (req, res) => {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return res.status(501).json({ error: "Google OAuth is not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to enable it." });
  }
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: buildGoogleRedirectUri(),
    response_type: "code",
    scope: "openid email profile",
    access_type: "offline",
    prompt: "select_account",
  });
  res.json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` });
});

app.get("/api/auth/google/callback", async (req, res) => {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) return res.status(501).send("Google OAuth is not configured.");
  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: req.query.code || "",
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: buildGoogleRedirectUri(),
        grant_type: "authorization_code",
      }),
    });
    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok) throw new Error(tokenData.error_description || "Google token exchange failed");
    const profileResponse = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const profile = await profileResponse.json();
    if (!profileResponse.ok) throw new Error("Google profile fetch failed");

    const db = readDb();
    let user = db.users.find((item) => item.googleId === profile.sub || item.email === String(profile.email || "").toLowerCase());
    if (!user) {
      user = {
        id: randomUUID(),
        googleId: profile.sub,
        email: String(profile.email || "").toLowerCase(),
        phone: "",
        displayName: profile.name || "Google User",
        username: generateUniqueUsername(db, profile.name || profile.email, ""),
        role: ADMIN_EMAILS.includes(String(profile.email || "").toLowerCase()) ? "admin" : "student",
        profilePicture: profile.picture || "",
        bio: "",
        college: "",
        skills: [],
        socialLinks: { github: "", linkedin: "", portfolio: "" },
        settings: { theme: "dark" },
        lastViewed: { topic: "", questionId: "", roadmapId: "", quizId: "" },
        passwordHash: "",
        level: 1,
        xp: 0,
        currentStreak: 0,
        longestStreak: 0,
        lastLogin: null,
        createdAt: new Date().toISOString(),
      };
      db.users.push(user);
    } else {
      user.googleId ||= profile.sub;
      user.profilePicture ||= profile.picture || "";
      user.displayName ||= profile.name || user.displayName;
    }
    updateStreak(user);
    await setRefreshCookie(res, user);
    writeDb(db);
    res.redirect(`${FRONTEND_URL}/`);
  } catch (err) {
    res.status(400).send(err.message);
  }
});

app.post("/api/auth/forgot-password", rateLimit({ keyPrefix: "auth-forgot", max: 10 }), async (req, res) => {
  const db = readDb();
  const email = String(req.body.email || "").toLowerCase();
  const user = db.users.find((item) => item.email.toLowerCase() === email);
  if (user) {
    const resetToken = randomUUID();
    user.resetTokenHash = await bcrypt.hash(resetToken, 10);
    user.resetTokenExpiresAt = Date.now() + 15 * 60 * 1000;
    user.devResetToken = resetToken;
    writeDb(db);
  }
  res.json({ ok: true, message: "If an account exists, a reset link has been generated. In local dev, check data/store.json for devResetToken." });
});

app.post("/api/auth/reset-password", rateLimit({ keyPrefix: "auth-reset", max: 10 }), async (req, res) => {
  const db = readDb();
  const { email, token, password, confirmPassword } = req.body;
  const user = db.users.find((item) => item.email.toLowerCase() === String(email || "").toLowerCase());
  if (!user || !user.resetTokenHash || Date.now() > Number(user.resetTokenExpiresAt || 0)) return res.status(400).json({ error: "Reset token is invalid or expired" });
  if (!(await bcrypt.compare(token || "", user.resetTokenHash))) return res.status(400).json({ error: "Reset token is invalid or expired" });
  if (!strongPasswordPattern.test(password || "")) return res.status(400).json({ error: "Password must be at least 8 characters and include uppercase, lowercase, and a number" });
  if (confirmPassword !== password) return res.status(400).json({ error: "Passwords do not match" });
  user.passwordHash = await bcrypt.hash(password, 10);
  user.resetTokenHash = "";
  user.resetTokenExpiresAt = 0;
  user.devResetToken = "";
  writeDb(db);
  res.json({ ok: true });
});

app.post("/api/auth/login", rateLimit({ keyPrefix: "auth-login", max: 30 }), async (req, res) => {
  const db = readDb();
  const { email, password } = req.body;
  const user = db.users.find((item) => item.email === String(email || "").toLowerCase());
  if (!user || !user.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) return res.status(401).json({ error: "Invalid credentials" });
  updateStreak(user);
  const stats = userStats(db, user.id);
  user.xp = stats.xp;
  user.level = Math.max(1, Math.floor(stats.xp / 100) + 1);
  await setRefreshCookie(res, user);
  writeDb(db);
  const token = createAccessToken(user);
  res.json({ token, user: publicUser(user) });
});

app.get("/api/status", (req, res) => {
  const db = readDb();
  res.json({
    ok: true,
    database: mongoReady ? "mongodb" : "local-json",
    mongoConfigured: Boolean(MONGODB_URI),
    mongoConnected: mongoReady,
    mongoDbName: mongoReady ? MONGODB_DB_NAME : null,
    mongoError,
    mongoStrict: MONGODB_STRICT,
    googleOAuthConfigured: Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET),
    auth: {
      accessToken: "JWT bearer token, 15 minutes",
      refreshToken: "HTTP-only cookie, 30 days",
      cookieSecure: COOKIE_SECURE,
      adminEmailsConfigured: ADMIN_EMAILS.length,
      corsOrigins: CORS_ORIGINS,
      storage: "users collection in local JSON database until MongoDB is connected",
    },
    users: db.users.length,
    contentItems: db.contentItems?.length || 0,
    questions: db.questions.length,
    mcqs: allMcqs(db).length,
    companies: db.companies.length,
    datasets: datasetStatus(),
    source: "Ultimate Tech Interview Master Guide",
  });
});

app.get("/api/datasets/status", (req, res) => {
  res.json({ ok: true, ...datasetStatus() });
});

app.post("/api/auth/refresh", async (req, res) => {
  const db = readDb();
  const refreshToken = parseCookies(req).crackit_refresh;
  if (!refreshToken) return res.status(401).json({ error: "Missing refresh session" });
  try {
    const payload = jwt.verify(refreshToken, REFRESH_SECRET);
    const user = db.users.find((item) => item.id === payload.id);
    if (!user || !user.refreshTokenHash || !(await bcrypt.compare(refreshToken, user.refreshTokenHash))) {
      return res.status(401).json({ error: "Invalid refresh session" });
    }
    updateStreak(user);
    await setRefreshCookie(res, user);
    writeDb(db);
    res.json({ token: createAccessToken(user), user: publicUser(user) });
  } catch {
    res.status(401).json({ error: "Invalid refresh session" });
  }
});

app.post("/api/auth/logout", auth, (req, res) => {
  const db = readDb();
  const user = db.users.find((item) => item.id === req.user.id);
  if (user) user.refreshTokenHash = "";
  clearRefreshCookie(res);
  writeDb(db);
  res.json({ ok: true });
});

app.get("/api/me", auth, (req, res) => {
  const db = readDb();
  const user = db.users.find((item) => item.id === req.user.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  const stats = userStats(db, user.id);
  user.xp = stats.xp;
  user.level = Math.max(1, Math.floor(stats.xp / 100) + 1);
  writeDb(db);
  res.json({ user: publicUser(user), stats });
});

app.patch("/api/me", auth, (req, res) => {
  const db = readDb();
  const user = db.users.find((item) => item.id === req.user.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  const { displayName, username, profilePicture, bio, college, skills, socialLinks, settings } = req.body;
  if (username && username !== user.username) {
    const normalized = normalizeUsername(username);
    if (db.users.some((item) => item.id !== user.id && item.username === normalized)) {
      return res.status(409).json({ error: "Username already taken" });
    }
    user.username = normalized;
  }
  if (displayName !== undefined) user.displayName = displayName;
  if (profilePicture !== undefined) user.profilePicture = profilePicture;
  if (bio !== undefined) user.bio = bio;
  if (college !== undefined) user.college = college;
  if (skills !== undefined) user.skills = Array.isArray(skills) ? skills : String(skills).split(",").map((item) => item.trim()).filter(Boolean);
  if (socialLinks !== undefined) user.socialLinks = { ...user.socialLinks, ...socialLinks };
  if (settings !== undefined) user.settings = { ...user.settings, ...settings };
  user.updatedAt = new Date().toISOString();
  writeDb(db);
  res.json({ user: publicUser(user) });
});

app.delete("/api/me", auth, (req, res) => {
  const db = readDb();
  db.users = db.users.filter((item) => item.id !== req.user.id);
  db.progress = db.progress.filter((item) => item.userId !== req.user.id);
  db.contentProgress = db.contentProgress.filter((item) => item.userId !== req.user.id);
  db.mcqResults = db.mcqResults.filter((item) => item.userId !== req.user.id);
  db.notes = db.notes.filter((item) => item.userId !== req.user.id);
  db.roadmapProgress = db.roadmapProgress.filter((item) => item.userId !== req.user.id);
  clearRefreshCookie(res);
  writeDb(db);
  res.json({ ok: true });
});

app.post("/api/progress/last-viewed", auth, (req, res) => {
  const db = readDb();
  const user = db.users.find((item) => item.id === req.user.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  user.lastViewed = { ...user.lastViewed, ...req.body };
  writeDb(db);
  res.json({ lastViewed: user.lastViewed });
});

app.get("/api/dashboard", auth, (req, res) => {
  const db = readDb();
  const user = db.users.find((item) => item.id === req.user.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  const stats = userStats(db, req.user.id);
  const mcq = mcqAnalytics(db, req.user.id);
  res.json({
    user: publicUser(user),
    stats,
    mcqAnalytics: mcq,
    totals: { questions: db.questions.length, mcqs: allMcqs(db).length, roadmaps: db.roadmaps.length, companies: db.companies.length },
    recentResults: db.mcqResults.filter((item) => item.userId === req.user.id).slice(-5).reverse(),
    savedQuestions: [
      ...stats.progress.filter((item) => item.status === "solved" || item.bookmarked).map((item) => db.questions.find((q) => q.id === item.questionId)).filter(Boolean),
      ...stats.contentProgress.filter((item) => item.solved || item.bookmarked).map((item) => db.contentItems.find((content) => content.id === item.contentId)).filter(Boolean),
    ],
    bookmarks: [
      ...stats.progress.filter((item) => item.bookmarked).map((item) => db.questions.find((q) => q.id === item.questionId)).filter(Boolean),
      ...stats.contentProgress.filter((item) => item.bookmarked).map((item) => db.contentItems.find((content) => content.id === item.contentId)).filter(Boolean),
    ],
  });
});

app.get("/api/questions", optionalAuth, (req, res) => {
  const db = readDb();
  const progress = req.user ? db.progress.filter((item) => item.userId === req.user.id) : [];
  res.json({
    questions: db.questions.map((question) => ({
      ...question,
      progress: progress.find((item) => item.questionId === question.id) || null,
      note: req.user ? db.notes.find((note) => note.userId === req.user.id && note.questionId === question.id)?.text || "" : "",
    })),
  });
});

function filterContent(items, query) {
  const search = String(query.search || "").toLowerCase();
  const category = String(query.category || "");
  const difficulty = String(query.difficulty || "");
  const topic = String(query.topic || "");
  const company = String(query.company || "");
  const type = String(query.type || "");
  return items.filter((item) => {
    const haystack = [item.question, item.category, item.type, item.difficulty, ...(item.companyTags || []), ...(item.topicTags || [])].join(" ").toLowerCase();
    return (!search || haystack.includes(search))
      && (!category || item.category === category)
      && (!difficulty || item.difficulty === difficulty)
      && (!topic || item.topicTags?.includes(topic))
      && (!company || item.companyTags?.some((tag) => tag.toLowerCase() === company.toLowerCase() || (company.toLowerCase() === "maang" && tag === "MAANG")))
      && (!type || item.type === type);
  });
}

const curatedMcqBank = [
  {
    id: "curated-os-deadlock-coffman",
    domain: "Operating Systems",
    topic: "Deadlocks",
    difficulty: "Medium",
    question: "Which set correctly lists the four necessary Coffman conditions for deadlock?",
    options: ["Mutual exclusion, hold and wait, no preemption, circular wait", "Paging, segmentation, swapping, compaction", "Ready, running, waiting, terminated", "Authentication, authorization, auditing, encryption"],
    correctAnswer: ["Mutual exclusion, hold and wait, no preemption, circular wait"],
    explanation: "Deadlock can occur only when mutual exclusion, hold and wait, no preemption, and circular wait hold together. The other options describe memory management, process states, and security concepts, not deadlock conditions.",
    tags: ["Operating Systems", "Deadlocks", "Processes"],
  },
  {
    id: "curated-dbms-index-tradeoff",
    domain: "DBMS",
    topic: "Indexes",
    difficulty: "Medium",
    question: "What is the main tradeoff of adding an index to a frequently updated database table?",
    options: ["Reads can become faster, but writes may become slower and storage increases", "Writes become faster because indexes remove disk I/O", "Indexes automatically normalize the table", "Indexes prevent all duplicate rows"],
    correctAnswer: ["Reads can become faster, but writes may become slower and storage increases"],
    explanation: "Indexes speed search and filtering by maintaining an additional lookup structure. Inserts, updates, and deletes must also update the index, so write overhead and storage usage increase. Indexes do not normalize data or guarantee uniqueness unless declared unique.",
    tags: ["DBMS", "Indexes", "SQL"],
  },
  {
    id: "curated-networking-tcp-handshake",
    domain: "Computer Networks",
    topic: "TCP",
    difficulty: "Easy",
    question: "What is the correct order of the TCP three-way handshake?",
    options: ["SYN, SYN-ACK, ACK", "ACK, SYN, FIN", "FIN, ACK, SYN", "HTTP, TLS, DNS"],
    correctAnswer: ["SYN, SYN-ACK, ACK"],
    explanation: "TCP connection establishment begins with the client sending SYN, the server replying with SYN-ACK, and the client completing with ACK. FIN is used during connection termination, while HTTP/TLS/DNS are higher-level or separate protocols.",
    tags: ["Computer Networks", "TCP", "Handshake"],
  },
  {
    id: "curated-linux-permissions-755",
    domain: "Linux",
    topic: "Permissions",
    difficulty: "Easy",
    question: "What does chmod 755 mean for a file or directory?",
    options: ["Owner can read/write/execute; group and others can read/execute", "Everyone can read/write/execute", "Owner can only read; group can write; others execute", "Only root can access it"],
    correctAnswer: ["Owner can read/write/execute; group and others can read/execute"],
    explanation: "In octal permissions, 7 means read+write+execute, and 5 means read+execute. Therefore 755 gives full permissions to owner and read/execute to group and others. It does not grant write access to everyone.",
    tags: ["Linux", "Permissions", "chmod"],
  },
  {
    id: "curated-cloud-availability-zone",
    domain: "Cloud Computing",
    topic: "High Availability",
    difficulty: "Easy",
    question: "Why do production cloud systems often deploy across multiple availability zones?",
    options: ["To survive failure of one datacenter zone", "To make every request use more CPU", "To remove the need for backups", "To disable network routing"],
    correctAnswer: ["To survive failure of one datacenter zone"],
    explanation: "Availability zones are isolated locations within a region. Deploying across multiple zones improves fault tolerance if one zone has an outage. It does not replace backups or eliminate routing.",
    tags: ["Cloud Computing", "High Availability", "Architecture"],
  },
  {
    id: "curated-devops-immutable-image",
    domain: "DevOps",
    topic: "Containers",
    difficulty: "Medium",
    question: "Why are immutable container images useful in CI/CD?",
    options: ["The same tested artifact can be promoted across environments", "They allow editing production containers manually", "They remove the need for version tags", "They guarantee zero bugs in application code"],
    correctAnswer: ["The same tested artifact can be promoted across environments"],
    explanation: "Immutable images make deployments repeatable because the built and tested artifact is the one promoted to staging or production. Manual edits reduce reliability, tags are still important, and images do not guarantee bug-free code.",
    tags: ["DevOps", "Docker", "CI/CD"],
  },
  {
    id: "curated-security-xss-output-encoding",
    domain: "Cyber Security",
    topic: "XSS",
    difficulty: "Medium",
    question: "Which practice most directly reduces reflected XSS risk when displaying user-controlled text in HTML?",
    options: ["Context-aware output encoding", "Storing passwords with MD5", "Opening all CORS origins", "Using GET instead of POST"],
    correctAnswer: ["Context-aware output encoding"],
    explanation: "Context-aware output encoding ensures user-controlled text is treated as data, not executable HTML or JavaScript. MD5 is weak for passwords, open CORS can increase risk, and HTTP method choice alone does not prevent XSS.",
    tags: ["Cyber Security", "XSS", "OWASP"],
  },
  {
    id: "curated-ai-overfitting",
    domain: "AI & ML",
    topic: "Model Evaluation",
    difficulty: "Easy",
    question: "A model has 99% training accuracy but poor validation accuracy. What is the most likely issue?",
    options: ["Overfitting", "Underflow", "Normalization form violation", "TCP congestion"],
    correctAnswer: ["Overfitting"],
    explanation: "Overfitting occurs when a model memorizes training data patterns and fails to generalize to unseen data. The other options are unrelated to the train/validation accuracy gap.",
    tags: ["AI & ML", "Overfitting", "Evaluation"],
  },
  {
    id: "curated-system-design-rate-limiter",
    domain: "System Design",
    topic: "Rate Limiting",
    difficulty: "Hard",
    question: "Which data structure is commonly used to implement a sliding-window rate limiter accurately?",
    options: ["Timestamp log or bucketed counters per key", "A single global boolean flag", "Only a stack with no timestamps", "A static HTML table"],
    correctAnswer: ["Timestamp log or bucketed counters per key"],
    explanation: "Sliding-window limiters need request timestamps or bucketed counters to count recent requests per key. A boolean flag cannot represent request volume, a stack without timestamps cannot expire old requests, and HTML tables are irrelevant.",
    tags: ["System Design", "Rate Limiting", "Scalability"],
  },
  {
    id: "curated-dsa-sliding-window",
    domain: "DSA",
    topic: "Sliding Window",
    difficulty: "Medium",
    question: "When is a sliding window usually the right pattern?",
    options: ["When the problem asks about a contiguous subarray or substring under a moving constraint", "When the input is always a tree", "When sorting is forbidden by syntax", "When every element must be compared with every other element"],
    correctAnswer: ["When the problem asks about a contiguous subarray or substring under a moving constraint"],
    explanation: "Sliding window works for contiguous ranges where the window expands and shrinks while maintaining a condition. Tree traversal, syntax restrictions, and all-pairs comparison point to other techniques.",
    tags: ["DSA", "Sliding Window", "Arrays", "Strings"],
  },
];

const mcqExpansionDomains = {
  "Operating Systems": ["Process states", "Threads", "Deadlocks", "Scheduling", "Paging", "Virtual memory", "Semaphores", "Mutex", "Context switching", "File systems"],
  DBMS: ["Keys", "Normalization", "Joins", "Indexes", "Transactions", "ACID", "SQL aggregation", "Isolation levels", "ER modeling", "Query optimization"],
  "Computer Networks": ["OSI model", "TCP", "UDP", "DNS", "HTTP", "HTTPS", "IP addressing", "Subnetting", "Routing", "Firewalls"],
  Linux: ["pwd and ls", "grep", "chmod", "chown", "cron", "systemd", "pipes", "redirection", "process commands", "shell scripting"],
  "Cloud Computing": ["IaaS", "PaaS", "SaaS", "Virtual machines", "Object storage", "Load balancing", "Auto scaling", "IAM", "Regions", "Availability zones"],
  DevOps: ["CI/CD", "Docker", "Kubernetes", "Jenkins", "Infrastructure as Code", "Monitoring", "Blue-green deployment", "Rollback", "Secrets", "Build artifacts"],
  "AI & ML": ["Overfitting", "Underfitting", "Gradient descent", "Confusion matrix", "Cross-validation", "Regression", "Classification", "Clustering", "Embeddings", "RAG"],
  "Cyber Security": ["CIA triad", "Phishing", "Encryption", "Hashing", "MFA", "SQL injection", "XSS", "CSRF", "Firewalls", "OWASP"],
  "System Design": ["Caching", "Rate limiting", "Load balancing", "Sharding", "Replication", "Message queues", "CDN", "URL shortener", "Chat systems", "Observability"],
  DSA: ["Arrays", "Strings", "Hashing", "Stacks", "Queues", "Trees", "Graphs", "Dynamic Programming", "Greedy", "Backtracking"],
};

const mcqExpansionPrompts = [
  "Which statement best describes",
  "What is the main purpose of",
  "Which failure is most commonly prevented by",
  "Which tradeoff should be remembered for",
  "What should an interviewer expect when discussing",
  "Which option is the safest practical use of",
  "What is a common mistake while using",
  "Which scenario is the best fit for",
  "What does a strong answer about",
  "Which metric or signal helps evaluate",
  "Which implementation detail matters most for",
  "Why is",
];

const mcqCorrectByDomain = {
  "Operating Systems": "It manages execution, memory, synchronization, and resource sharing between programs.",
  DBMS: "It improves data correctness, retrieval, transaction safety, and structured storage decisions.",
  "Computer Networks": "It defines how systems communicate reliably, securely, and efficiently across networks.",
  Linux: "It helps inspect, automate, secure, and operate systems from the command line.",
  "Cloud Computing": "It improves scalable, reliable, and managed infrastructure usage for applications.",
  DevOps: "It automates build, test, release, infrastructure, and operational feedback loops.",
  "AI & ML": "It helps models learn patterns, evaluate generalization, and make data-driven predictions.",
  "Cyber Security": "It reduces risk by protecting confidentiality, integrity, availability, and identity.",
  "System Design": "It improves scalability, reliability, latency, and operational maintainability.",
  DSA: "It gives an efficient pattern for solving input constraints with clear time and space complexity.",
};

function generatedMcqBank() {
  const difficultyCycle = ["Easy", "Medium", "Hard"];
  const records = [];
  for (const [domain, concepts] of Object.entries(mcqExpansionDomains)) {
    concepts.forEach((concept, conceptIndex) => {
      mcqExpansionPrompts.forEach((prompt, promptIndex) => {
        const question = `${prompt} ${concept} in ${domain} interview preparation?`;
        const correct = mcqCorrectByDomain[domain];
        records.push({
          id: `crackit-${slug(domain)}-${slug(concept)}-${slug(prompt)}`,
          domain,
          topic: concept,
          difficulty: difficultyCycle[(conceptIndex + promptIndex) % difficultyCycle.length],
          question,
          options: [
            correct,
            "It is mainly a visual styling choice and does not affect technical behavior.",
            "It removes the need to understand constraints, edge cases, or failure modes.",
            "It is only useful when writing frontend animations and not in interviews.",
          ],
          correctAnswer: [correct],
          explanation: `${concept} is important in ${domain} because interviews test whether you understand the concept, its tradeoffs, and when to apply it. The correct option explains the practical role of the topic. The other options are incorrect because they ignore constraints, reliability, security, performance, or real engineering behavior.`,
          tags: [domain, concept],
          source: "CrackIT Curated Knowledge Quiz Bank",
          referenceNote: "Curated from standard CS fundamentals and common interview preparation topics.",
        });
      });
    });
  }
  return records;
}

curatedMcqBank.push(...generatedMcqBank().filter((item) => !curatedMcqBank.some((existing) => existing.id === item.id)));

const careerRoadmapSeeds = [
  {
    id: "software-engineer",
    title: "Software Engineer",
    steps: ["Python/Java + OOP + Git", "DSA + DBMS + OS + Networks", "Full Stack Development", "System Design Basics", "3 beginner + 2 intermediate + 1 advanced project"],
    phases: ["Phase 1: Python/Java, OOP, Git", "Phase 2: DSA, DBMS, OS, Computer Networks", "Phase 3: Full Stack Development and deployment"],
    youtube: ["Striver DSA", "Kunal Kushwaha", "SuperSimpleDev", "Codevolution"],
    certifications: ["Cisco Python Essentials", "Oracle Java Foundations"],
    whereToLearn: [
      { title: "Striver DSA", url: "https://www.youtube.com/@takeUforward", type: "YouTube", note: "Use for DSA patterns, sheets, and interview-style explanations." },
      { title: "Kunal Kushwaha", url: "https://www.youtube.com/@KunalKushwaha", type: "YouTube", note: "Use for Java, open source, Git, and developer fundamentals." },
      { title: "SuperSimpleDev", url: "https://www.youtube.com/@SuperSimpleDev", type: "YouTube", note: "Use for HTML, CSS, JavaScript, and beginner web projects." },
      { title: "MDN Web Docs", url: "https://developer.mozilla.org/", type: "Docs", note: "Use as the main reference for web APIs and JavaScript." },
    ],
    certificateLinks: [
      { title: "Cisco Certifications", url: "https://www.cisco.com/content/cdc/site/us/en/learn/training-certifications/certifications/index.html", level: "Beginner friendly", note: "Cisco lists certification paths and digital badges, including Python/networking tracks." },
      { title: "Oracle Java Foundations", url: "https://learn.oracle.com/ols/learning-path/oracle-java-foundations-training-and-assessment/146553/152239", level: "Beginner", note: "Oracle's beginner Java foundation path." },
      { title: "GitHub Foundations", url: "https://resources.github.com/learn/certifications/", level: "Beginner", note: "Good proof for Git/GitHub workflow and collaboration." },
    ],
    projectPlan: ["Beginner: CLI expense tracker, notes app, portfolio CMS", "Intermediate: REST API with auth, placement tracker, quiz platform", "Advanced: full placement command center with analytics and deploy pipeline"],
    weeklyPlan: ["Weeks 1-4: language + OOP + Git", "Weeks 5-12: DSA + SQL + OS/CN basics", "Weeks 13-20: full-stack project builds", "Weeks 21-24: mock interviews + resume polish"],
    targetExams: ["Company OA", "Coding Rounds", "System Design Basics"],
    interviewPrep: "Practice DSA, CS fundamentals, behavioral questions, and mock interviews.",
  },
  {
    id: "full-stack-developer",
    title: "Full Stack Developer",
    steps: ["HTML + CSS + JavaScript", "React + state management", "Node.js + Express APIs", "MongoDB/PostgreSQL", "Authentication + deployment"],
    phases: ["Phase 1: HTML, CSS, JavaScript, Git", "Phase 2: React, forms, routing, API integration", "Phase 3: Node.js, Express, databases, auth, testing", "Phase 4: deployment, monitoring, and project polish"],
    youtube: ["SuperSimpleDev", "Codevolution", "Web Dev Simplified", "freeCodeCamp"],
    certifications: ["freeCodeCamp Responsive Web Design", "Meta Front-End Developer", "MongoDB Developer Path"],
    whereToLearn: [
      { title: "React Docs", url: "https://react.dev/learn", type: "Docs", note: "Official React learning path." },
      { title: "Node.js Learn", url: "https://nodejs.org/en/learn", type: "Docs", note: "Official backend fundamentals." },
      { title: "MDN Web Docs", url: "https://developer.mozilla.org/", type: "Docs", note: "Best web reference." },
    ],
    certificateLinks: [
      { title: "freeCodeCamp Responsive Web Design", url: "https://www.freecodecamp.org/learn/2022/responsive-web-design/", level: "Beginner", note: "Best free start for HTML/CSS." },
      { title: "Meta Front-End Developer", url: "https://www.coursera.org/professional-certificates/meta-front-end-developer", level: "Intermediate", note: "Good structured frontend certificate." },
    ],
    projectPlan: ["Beginner: Portfolio CMS", "Intermediate: Job board portal", "Advanced: LMS with admin, quizzes, auth, and deployment"],
    weeklyPlan: ["Weeks 1-4: frontend foundations", "Weeks 5-8: React apps", "Weeks 9-14: backend + database", "Weeks 15-20: full product + deployment"],
    targetExams: ["Frontend interviews", "Backend API rounds", "Full-stack project rounds"],
    interviewPrep: "Prepare JavaScript, React, REST APIs, database schema design, auth, deployment, and project tradeoffs.",
  },
  {
    id: "backend-developer",
    title: "Backend Developer",
    steps: ["Programming + OOP", "HTTP + REST APIs", "Databases + SQL", "Authentication + security", "System design basics"],
    phases: ["Phase 1: Java/Python/JavaScript backend basics", "Phase 2: REST APIs, validation, error handling", "Phase 3: DBMS, caching, queues, auth", "Phase 4: deployment, logging, and scalability"],
    youtube: ["Java Brains", "Amigoscode", "freeCodeCamp", "ByteByteGo"],
    certifications: ["Oracle Java Foundations", "MongoDB Associate Developer", "AWS Cloud Practitioner"],
    whereToLearn: [
      { title: "Express Docs", url: "https://expressjs.com/", type: "Docs", note: "Node backend docs." },
      { title: "PostgreSQL Docs", url: "https://www.postgresql.org/docs/", type: "Docs", note: "SQL and relational fundamentals." },
      { title: "OWASP Cheat Sheet Series", url: "https://cheatsheetseries.owasp.org/", type: "Docs", note: "Backend security practices." },
    ],
    certificateLinks: [
      { title: "Oracle Java Foundations", url: "https://education.oracle.com/oracle-certification-path/pFamily_48", level: "Beginner", note: "Useful Java proof." },
      { title: "MongoDB Developer Certification", url: "https://learn.mongodb.com/pages/certification", level: "Intermediate", note: "Good for database-backed APIs." },
    ],
    projectPlan: ["Beginner: Secure notes API", "Intermediate: URL shortener analytics", "Advanced: Feature flag dashboard"],
    weeklyPlan: ["Weeks 1-4: APIs + validation", "Weeks 5-8: DBMS + auth", "Weeks 9-14: caching + queues", "Weeks 15-20: system design + deployment"],
    targetExams: ["Backend coding rounds", "API design rounds", "DBMS rounds"],
    interviewPrep: "Practice API design, database indexes, transactions, authentication, caching, queues, and error handling.",
  },
  {
    id: "frontend-developer",
    title: "Frontend Developer",
    steps: ["HTML + CSS", "JavaScript", "React", "Accessibility", "Performance + testing"],
    phases: ["Phase 1: responsive layouts and CSS", "Phase 2: JavaScript DOM and async", "Phase 3: React state, routing, forms", "Phase 4: accessibility, performance, and UI polish"],
    youtube: ["Kevin Powell", "Web Dev Simplified", "Codevolution", "The Net Ninja"],
    certifications: ["freeCodeCamp JavaScript Algorithms", "Meta Front-End Developer"],
    whereToLearn: [
      { title: "MDN Learn Web Development", url: "https://developer.mozilla.org/en-US/docs/Learn", type: "Docs", note: "Best foundational web path." },
      { title: "React Learn", url: "https://react.dev/learn", type: "Docs", note: "Official React guide." },
      { title: "web.dev", url: "https://web.dev/learn", type: "Docs", note: "Performance, accessibility, and modern web." },
    ],
    certificateLinks: [
      { title: "freeCodeCamp JavaScript Algorithms", url: "https://www.freecodecamp.org/learn/javascript-algorithms-and-data-structures-v8/", level: "Beginner", note: "Good JavaScript proof." },
      { title: "Meta Front-End Developer", url: "https://www.coursera.org/professional-certificates/meta-front-end-developer", level: "Intermediate", note: "Structured frontend path." },
    ],
    projectPlan: ["Beginner: Portfolio CMS", "Intermediate: Markdown knowledge base", "Advanced: Design-system dashboard"],
    weeklyPlan: ["Weeks 1-4: HTML/CSS/JS", "Weeks 5-10: React apps", "Weeks 11-14: accessibility + performance", "Weeks 15-18: portfolio polish"],
    targetExams: ["Frontend machine coding", "JavaScript rounds", "React project rounds"],
    interviewPrep: "Prepare JavaScript fundamentals, React rendering, forms, accessibility, browser APIs, performance, and UI tradeoffs.",
  },
  {
    id: "ai-engineer",
    title: "AI Engineer",
    steps: ["Python + Statistics + Linear Algebra", "Machine Learning + Deep Learning", "LLMs + RAG + Agents", "MLOps basics", "Build AI portfolio projects"],
    phases: ["Phase 1: Python, Statistics, Linear Algebra", "Phase 2: Machine Learning and Deep Learning", "Phase 3: LLMs, RAG, Agents, MLOps"],
    youtube: ["Andrew Ng", "StatQuest", "DeepLearning.AI", "freeCodeCamp"],
    certifications: ["Google AI Essentials", "IBM AI Fundamentals"],
    whereToLearn: [
      { title: "Andrew Ng / DeepLearning.AI", url: "https://www.youtube.com/@Deeplearningai", type: "YouTube", note: "Use for ML foundations, neural networks, and practical AI concepts." },
      { title: "StatQuest", url: "https://www.youtube.com/@statquest", type: "YouTube", note: "Use for statistics, ML intuition, and model evaluation." },
      { title: "Kaggle Learn", url: "https://www.kaggle.com/learn", type: "Course", note: "Use for Python, pandas, ML, and small practice notebooks." },
      { title: "Hugging Face Learn", url: "https://huggingface.co/learn", type: "Docs/Course", note: "Use for transformers, NLP, embeddings, and LLM workflows." },
    ],
    certificateLinks: [
      { title: "Google AI Essentials", url: "https://grow.google/ai-essentials/", level: "Beginner", note: "Google's official AI literacy course." },
      { title: "IBM Data Science Professional Certificate", url: "https://www.coursera.org/professional-certificates/ibm-data-science", level: "Beginner to intermediate", note: "Structured data science portfolio path." },
      { title: "Google Professional ML Engineer", url: "https://cloud.google.com/learn/certification/machine-learning-engineer", level: "Advanced", note: "Better after ML, deployment, and cloud fundamentals." },
    ],
    projectPlan: ["Beginner: spam classifier, salary predictor, movie recommender", "Intermediate: resume analyzer, RAG notes search, ML dashboard", "Advanced: end-to-end ML app with training, evaluation, API, monitoring"],
    weeklyPlan: ["Weeks 1-4: Python + statistics + linear algebra", "Weeks 5-10: supervised ML + evaluation", "Weeks 11-16: deep learning + NLP", "Weeks 17-24: LLM/RAG projects + deployment"],
    targetExams: ["ML Coding", "Model Design", "AI Interviews"],
    interviewPrep: "Practice ML theory, Python coding, data handling, model evaluation, and project explanation.",
  },
  {
    id: "devops",
    title: "DevOps Engineer",
    steps: ["Linux + Networking + Git", "Docker + Kubernetes", "CI/CD + Terraform", "Monitoring and logging", "Deploy production-style projects"],
    phases: ["Phase 1: Linux, Networking, Git", "Phase 2: Docker and Kubernetes", "Phase 3: CI/CD, Terraform, Monitoring"],
    youtube: ["TechWorld with Nana", "NetworkChuck", "KodeKloud"],
    certifications: ["AWS Cloud Practitioner", "AZ-900"],
    whereToLearn: [
      { title: "TechWorld with Nana", url: "https://www.youtube.com/@TechWorldwithNana", type: "YouTube", note: "Use for Docker, Kubernetes, CI/CD, and DevOps concepts." },
      { title: "KodeKloud", url: "https://www.youtube.com/@KodeKloud", type: "YouTube/Labs", note: "Use for Linux, Kubernetes, and hands-on DevOps practice." },
      { title: "Docker Docs", url: "https://docs.docker.com/", type: "Docs", note: "Use for Dockerfile, Compose, images, and container networking." },
      { title: "Kubernetes Docs", url: "https://kubernetes.io/docs/home/", type: "Docs", note: "Use for pods, services, deployments, and cluster concepts." },
    ],
    certificateLinks: [
      { title: "AWS Certified Cloud Practitioner", url: "https://aws.amazon.com/certification/certified-cloud-practitioner/", level: "Beginner", note: "Strong first cloud certificate for DevOps/cloud roles." },
      { title: "Azure Fundamentals AZ-900", url: "https://learn.microsoft.com/en-us/credentials/certifications/exams/az-900/", level: "Beginner", note: "Microsoft's official Azure fundamentals exam page." },
      { title: "CKAD", url: "https://training.linuxfoundation.org/certification/certified-kubernetes-application-developer-ckad/", level: "Intermediate", note: "Useful after Docker and Kubernetes hands-on practice." },
    ],
    projectPlan: ["Beginner: Dockerize a Node/React app", "Intermediate: CI/CD pipeline with GitHub Actions and Render/Vercel deploy", "Advanced: Kubernetes deployment dashboard with monitoring and rollback checklist"],
    weeklyPlan: ["Weeks 1-4: Linux + networking + Git", "Weeks 5-8: Docker + Compose", "Weeks 9-14: Kubernetes basics", "Weeks 15-20: CI/CD + Terraform + monitoring"],
    targetExams: ["Cloud interviews", "DevOps interviews", "Linux troubleshooting rounds"],
    interviewPrep: "Practice Linux commands, Docker, Kubernetes basics, CI/CD pipelines, and deployment debugging.",
  },
  {
    id: "cyber-security",
    title: "Cyber Security Engineer",
    steps: ["Networking + Linux", "Web Security + Ethical Hacking", "SOC basics + Pen Testing", "Cloud Security", "Write security reports"],
    phases: ["Phase 1: Networking and Linux", "Phase 2: Web Security and Ethical Hacking", "Phase 3: SOC, Pen Testing, Cloud Security"],
    youtube: ["Professor Messer", "NetworkChuck", "John Hammond"],
    certifications: ["CompTIA Security+", "CEH", "PNPT"],
    whereToLearn: [
      { title: "Professor Messer", url: "https://www.youtube.com/@professormesser", type: "YouTube", note: "Use for Security+ and networking/security fundamentals." },
      { title: "John Hammond", url: "https://www.youtube.com/@_JohnHammond", type: "YouTube", note: "Use for CTF walkthroughs, malware basics, and security thinking." },
      { title: "OWASP Top 10", url: "https://owasp.org/www-project-top-ten/", type: "Docs", note: "Use for web security risks every developer should know." },
      { title: "PortSwigger Web Security Academy", url: "https://portswigger.net/web-security", type: "Labs", note: "Use for free hands-on web security labs." },
    ],
    certificateLinks: [
      { title: "CompTIA Security+", url: "https://www.comptia.org/certifications/security", level: "Beginner to intermediate", note: "Popular baseline security certificate." },
      { title: "ISC2 Certified in Cybersecurity", url: "https://www.isc2.org/certifications/cc", level: "Beginner", note: "Entry-level cybersecurity certification path." },
      { title: "PNPT", url: "https://certifications.tcm-sec.com/pnpt/", level: "Intermediate", note: "Practical pentest-focused certification." },
    ],
    projectPlan: ["Beginner: secure notes app with auth checklist", "Intermediate: OWASP lab report portfolio", "Advanced: mini SOC dashboard with alerts and incident notes"],
    weeklyPlan: ["Weeks 1-4: networking + Linux", "Weeks 5-10: web security + OWASP", "Weeks 11-16: labs + report writing", "Weeks 17-24: SOC/pentest/cloud security project"],
    targetExams: ["Security analyst interviews", "Pentest interviews", "Web security assessments"],
    interviewPrep: "Practice OWASP, networking, Linux, threat analysis, and explain lab findings clearly.",
  },
  {
    id: "cloud-engineer",
    title: "Cloud Engineer",
    steps: ["Linux + Networking", "AWS/Azure/GCP fundamentals", "IAM + Compute + Storage", "Containers + Infrastructure as Code", "Deploy cloud projects"],
    phases: ["Phase 1: Linux and Networking", "Phase 2: AWS/Azure/GCP", "Phase 3: Containers and Infrastructure as Code"],
    youtube: ["John Savill", "freeCodeCamp AWS", "AWS Events"],
    certifications: ["AZ-900", "AWS Cloud Practitioner", "Google Cloud Digital Leader"],
    whereToLearn: [
      { title: "John Savill", url: "https://www.youtube.com/@NTFAQGuy", type: "YouTube", note: "Use for Azure fundamentals and cloud architecture." },
      { title: "AWS Skill Builder", url: "https://skillbuilder.aws/", type: "Course", note: "Use for official AWS learning paths." },
      { title: "Microsoft Learn", url: "https://learn.microsoft.com/training/", type: "Course", note: "Use for Azure modules and exam preparation." },
      { title: "Google Cloud Skills Boost", url: "https://www.cloudskillsboost.google/", type: "Labs", note: "Use for GCP labs and cloud paths." },
    ],
    certificateLinks: [
      { title: "AWS Certified Cloud Practitioner", url: "https://aws.amazon.com/certification/certified-cloud-practitioner/", level: "Beginner", note: "Best first AWS certificate." },
      { title: "Azure Fundamentals AZ-900", url: "https://learn.microsoft.com/en-us/credentials/certifications/exams/az-900/", level: "Beginner", note: "Best first Azure certificate." },
      { title: "Google Cloud Digital Leader", url: "https://cloud.google.com/learn/certification/cloud-digital-leader", level: "Beginner", note: "Best first Google Cloud certificate." },
    ],
    projectPlan: ["Beginner: host static portfolio on cloud storage/CDN", "Intermediate: deploy full-stack app with database and monitoring", "Advanced: multi-service cloud architecture with IaC and cost notes"],
    weeklyPlan: ["Weeks 1-4: Linux + networking", "Weeks 5-10: one cloud provider deeply", "Weeks 11-16: IAM + compute + storage + databases", "Weeks 17-22: containers + IaC + deployment project"],
    targetExams: ["Cloud Engineer interviews", "Cloud fundamentals exams"],
    interviewPrep: "Practice IAM, networking, compute, storage, load balancing, monitoring, and cost-aware architecture.",
  },
  {
    id: "data-engineer",
    title: "Data Engineer",
    steps: ["SQL + Python", "ETL + Spark + Kafka", "Data Warehousing", "Cloud Data Services", "Build data pipeline projects"],
    phases: ["Phase 1: SQL and Python", "Phase 2: ETL, Spark, Kafka", "Phase 3: Data Warehousing and Cloud Data"],
    youtube: ["freeCodeCamp Data Engineering", "Seattle Data Guy"],
    certifications: ["Databricks Fundamentals", "Google Cloud Data Engineer path"],
    whereToLearn: [
      { title: "freeCodeCamp Data Engineering", url: "https://www.youtube.com/@freecodecamp", type: "YouTube", note: "Use for long-form SQL, Python, and data engineering courses." },
      { title: "Seattle Data Guy", url: "https://www.youtube.com/@SeattleDataGuy", type: "YouTube", note: "Use for realistic data engineering career and project guidance." },
      { title: "Databricks Learning", url: "https://partner-academy.databricks.com/", type: "Course", note: "Use for Spark, lakehouse, and Databricks fundamentals." },
      { title: "Google Cloud Data Engineering", url: "https://cloud.google.com/learn/certification/data-engineer", type: "Docs/Cert", note: "Use as a reference for cloud data engineer expectations." },
    ],
    certificateLinks: [
      { title: "Databricks Fundamentals Accreditation", url: "https://partner-academy.databricks.com/learn/course/external/view/elearning/2308/databricks-fundamentals-accreditation", level: "Beginner", note: "Databricks official fundamentals accreditation." },
      { title: "Google Professional Data Engineer", url: "https://cloud.google.com/learn/certification/data-engineer", level: "Intermediate to advanced", note: "Good after SQL, pipelines, and cloud data practice." },
      { title: "Microsoft DP-900", url: "https://learn.microsoft.com/en-us/credentials/certifications/exams/dp-900/", level: "Beginner", note: "Azure data fundamentals exam." },
    ],
    projectPlan: ["Beginner: SQL analytics dashboard", "Intermediate: ETL pipeline from API to warehouse", "Advanced: streaming + batch pipeline with data quality checks"],
    weeklyPlan: ["Weeks 1-4: SQL + Python", "Weeks 5-10: ETL + data modeling", "Weeks 11-16: Spark/Kafka basics", "Weeks 17-24: warehouse + cloud data project"],
    targetExams: ["Data Engineering interviews", "SQL rounds", "Pipeline design rounds"],
    interviewPrep: "Practice SQL, data modeling, batch pipelines, streaming basics, and system tradeoffs.",
  },
];

function allMcqs(db) {
  const datasetMcqs = (db.contentItems || [])
    .filter((item) => item.type === "MCQ" && Array.isArray(item.options) && item.options.length && Array.isArray(item.correctAnswer) && item.correctAnswer.length)
    .map((item) => normalizeMcq(item));
  const mergedMcqs = [...datasetMcqs, ...curatedMcqBank.map((item) => normalizeMcq({
    ...item,
    category: item.domain,
    type: "MCQ",
    topicTags: item.tags,
    companyTags: [],
    source: "CrackIT Curated Knowledge Quiz Bank",
    sourceLine: item.question,
    referenceNote: "Curated from standard CS fundamentals and official platform documentation topics.",
  }))];
  const seenQuestions = new Set();
  const seenSignatures = new Set();
  return mergedMcqs.filter((mcq) => {
    if (!isQualityMcq(mcq)) return false;
    const questionKey = normalizeMcqText(mcq.question);
    const fullSignature = mcqSignature(mcq);
    if (seenQuestions.has(questionKey) || seenSignatures.has(fullSignature)) return false;
    seenQuestions.add(questionKey);
    seenSignatures.add(fullSignature);
    return true;
  });
}

function normalizeMcq(item) {
  return {
      id: item.id,
      title: item.title || item.question,
      domain: item.domain || item.topicTags?.[0] || item.category || item.topic || "General",
      difficulty: item.difficulty && item.difficulty !== "MCQ" ? item.difficulty : "Medium",
      question: item.question,
      options: item.options,
      correctAnswer: item.correctAnswer,
      explanation: item.explanation || `Correct answer: ${item.correctAnswer.join(", ")}. Review the topic notes to understand why the distractors are not correct.`,
      topic: item.topicTags?.[0] || item.category,
      category: item.category,
      tags: item.tags || item.topicTags || [],
      source: item.source,
      referenceNote: item.referenceNote,
    };
}

function normalizeMcqText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/#\d+/g, "#")
    .replace(/\s+/g, " ")
    .trim();
}

function mcqSignature(mcq) {
  return [
    normalizeMcqText(mcq.question),
    ...(mcq.options || []).map(normalizeMcqText),
    ...(mcq.correctAnswer || []).map(normalizeMcqText),
  ].join("|");
}

function isQualityMcq(mcq) {
  const text = `${mcq.question || ""} ${mcq.title || ""}`;
  if (/#\d+|question\s*#\d+|cloud deployment model #|hyperparameter optimization technique #|key characteristic of .*#\d+/i.test(text)) return false;
  if (!mcq.question || mcq.question.length < 20) return false;
  if (!Array.isArray(mcq.options) || mcq.options.length !== 4) return false;
  if (!Array.isArray(mcq.correctAnswer) || mcq.correctAnswer.length !== 1) return false;
  if (!mcq.options.includes(mcq.correctAnswer[0])) return false;
  if (!mcq.explanation || mcq.explanation.length < 80) return false;
  return true;
}

function shuffled(items) {
  return [...items].sort(() => Math.random() - 0.5);
}

function generateMcqTest(mcqBank, { domain = "", topic = "", count = 8, avoid = [] } = {}) {
  const scoped = mcqBank.filter((mcq) => (!domain || mcq.domain === domain) && (!topic || mcq.topic === topic || mcq.tags?.includes(topic)));
  const avoidSet = new Set(Array.isArray(avoid) ? avoid : String(avoid || "").split(",").filter(Boolean));
  const baseSource = scoped.length ? scoped : mcqBank;
  const freshSource = baseSource.filter((mcq) => !avoidSet.has(mcq.id));
  const source = freshSource.length >= Math.min(count, baseSource.length) ? freshSource : baseSource;
  const mix = [
    ...shuffled(source.filter((mcq) => mcq.difficulty === "Easy")).slice(0, 2),
    ...shuffled(source.filter((mcq) => mcq.difficulty === "Medium")).slice(0, 3),
    ...shuffled(source.filter((mcq) => mcq.difficulty === "Hard")).slice(0, 3),
  ];
  const filled = [...mix];
  for (const mcq of shuffled(source)) {
    if (filled.length >= count) break;
    if (!filled.some((item) => item.id === mcq.id)) filled.push(mcq);
  }
  return filled.slice(0, count);
}

function clientMcq(mcq) {
  const { correctAnswer, ...safeMcq } = mcq;
  const uniqueOptions = [...new Set(safeMcq.options || [])];
  return { ...safeMcq, options: shuffled(uniqueOptions).slice(0, 4) };
}

function guestUnlockedCount(total) {
  return Math.max(1, Math.ceil(total * (GUEST_UNLOCK_PERCENT / 100)));
}

function canGuestAccessContent(db, contentId) {
  return true;
}

function canGuestAccessMcq(mcqBank, mcqId) {
  return true;
}

function lockResponse(res) {
  return res.status(403).json({
    error: "CrackIT is free and open source. Continue learning without payment or forced signup.",
    locked: true,
    benefits: [
      "Complete DSA Question Bank",
      "Full MCQ Library",
      "Company Interview Questions",
      "Coding Challenges",
      "Internship Roadmaps",
      "Project Hub",
      "Progress Tracking",
      "Streak System",
      "Bookmarks",
      "Personalized Dashboard",
    ],
  });
}

app.get("/api/content", optionalAuth, (req, res) => {
  const db = readDb();
  const progress = req.user ? db.contentProgress.filter((item) => item.userId === req.user.id) : [];
  const filtered = filterContent(db.contentItems || [], req.query);
  const isGuest = !req.user;
  const guestPercent = 100;
  const guestUnlockedCount = filtered.length;
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));
  const totalPages = Math.max(1, Math.ceil(filtered.length / limit));
  const paged = filtered.slice((page - 1) * limit, page * limit);
  const enriched = paged.map((item, index) => {
    const absoluteIndex = (page - 1) * limit + index;
    const locked = false;
    const decorated = decorateContentItem(item);
    return {
      ...decorated,
      locked,
      sourceLine: decorated.sourceLine,
      preview: decorated.preview || decorated.problem || decorated.sourceLine,
      progress: progress.find((entry) => entry.contentId === decorated.id) || null,
    };
  });
  const facets = {
    categories: [...new Set((db.contentItems || []).map((item) => item.category))].sort(),
    difficulties: [...new Set((db.contentItems || []).map((item) => item.difficulty))].sort(),
    types: [...new Set((db.contentItems || []).map((item) => item.type))].sort(),
    topics: [...new Set((db.contentItems || []).flatMap((item) => item.topicTags || []))].sort(),
    companies: [...new Set((db.contentItems || []).flatMap((item) => item.companyTags || []))].sort(),
  };
  res.json({
    items: enriched,
    facets,
    total: filtered.length,
    page,
    limit,
    totalPages,
    access: {
      mode: isGuest ? "guest" : "registered",
      guestPercent,
      guestUnlockedCount,
      lockedCount: 0,
    },
    source: "Ultimate Tech Interview Master Guide",
  });
});

app.get("/api/content/:id", optionalAuth, (req, res) => {
  const db = readDb();
  const item = db.contentItems.find((entry) => entry.id === req.params.id);
  if (!item) return res.status(404).json({ error: "Content item not found" });
  if (!req.user && !canGuestAccessContent(db, item.id)) return lockResponse(res);
  const progress = req.user ? db.contentProgress.find((entry) => entry.userId === req.user.id && entry.contentId === item.id) || null : null;
  const note = req.user ? db.notes.find((entry) => entry.userId === req.user.id && entry.contentId === item.id)?.text || "" : "";
  const decorated = decorateContentItem(item);
  res.json({ item: { ...decorated, progress, note }, source: "Ultimate Tech Interview Master Guide" });
});

app.post("/api/content/:id/read", auth, (req, res) => {
  const db = readDb();
  const item = db.contentItems.find((entry) => entry.id === req.params.id);
  if (!item) return res.status(404).json({ error: "Content item not found" });
  let progress = db.contentProgress.find((entry) => entry.userId === req.user.id && entry.contentId === item.id);
  if (!progress) {
    progress = { userId: req.user.id, contentId: item.id, read: false, bookmarked: false };
    db.contentProgress.push(progress);
  }
  progress.read = Boolean(req.body.read);
  progress.updatedAt = new Date().toISOString();
  writeDb(db);
  res.json({ progress });
});

app.post("/api/content/:id/solved", auth, (req, res) => {
  const db = readDb();
  const item = db.contentItems.find((entry) => entry.id === req.params.id);
  if (!item) return res.status(404).json({ error: "Content item not found" });
  let progress = db.contentProgress.find((entry) => entry.userId === req.user.id && entry.contentId === item.id);
  if (!progress) {
    progress = { userId: req.user.id, contentId: item.id, read: false, bookmarked: false, solved: false };
    db.contentProgress.push(progress);
  }
  progress.solved = Boolean(req.body.solved);
  progress.read = progress.read || progress.solved;
  progress.updatedAt = new Date().toISOString();
  writeDb(db);
  res.json({ progress, stats: userStats(db, req.user.id) });
});

app.post("/api/content/:id/bookmark", auth, (req, res) => {
  const db = readDb();
  const item = db.contentItems.find((entry) => entry.id === req.params.id);
  if (!item) return res.status(404).json({ error: "Content item not found" });
  let progress = db.contentProgress.find((entry) => entry.userId === req.user.id && entry.contentId === item.id);
  if (!progress) {
    progress = { userId: req.user.id, contentId: item.id, read: false, bookmarked: false };
    db.contentProgress.push(progress);
  }
  progress.bookmarked = Boolean(req.body.bookmarked);
  progress.updatedAt = new Date().toISOString();
  writeDb(db);
  res.json({ progress });
});

app.post("/api/content/:id/notes", auth, (req, res) => {
  const db = readDb();
  const item = db.contentItems.find((entry) => entry.id === req.params.id);
  if (!item) return res.status(404).json({ error: "Content item not found" });
  let note = db.notes.find((entry) => entry.userId === req.user.id && entry.contentId === item.id);
  if (!note) {
    note = { userId: req.user.id, contentId: item.id, text: "" };
    db.notes.push(note);
  }
  note.text = req.body.text || "";
  note.updatedAt = new Date().toISOString();
  writeDb(db);
  res.json({ note });
});

app.post("/api/questions/:id/solved", auth, (req, res) => {
  const db = readDb();
  const question = db.questions.find((item) => item.id === req.params.id);
  if (!question) return res.status(404).json({ error: "Question not found" });
  let progress = db.progress.find((item) => item.userId === req.user.id && item.questionId === question.id);
  if (!progress) {
    progress = { userId: req.user.id, questionId: question.id, status: "unsolved", bookmarked: false };
    db.progress.push(progress);
  }
  progress.status = req.body.solved ? "solved" : "unsolved";
  progress.updatedAt = new Date().toISOString();
  writeDb(db);
  res.json({ progress, stats: userStats(db, req.user.id) });
});

app.post("/api/questions/:id/bookmark", auth, (req, res) => {
  const db = readDb();
  let progress = db.progress.find((item) => item.userId === req.user.id && item.questionId === req.params.id);
  if (!progress) {
    progress = { userId: req.user.id, questionId: req.params.id, status: "unsolved", bookmarked: false };
    db.progress.push(progress);
  }
  progress.bookmarked = Boolean(req.body.bookmarked);
  progress.updatedAt = new Date().toISOString();
  writeDb(db);
  res.json({ progress, stats: userStats(db, req.user.id) });
});

app.post("/api/questions/:id/notes", auth, (req, res) => {
  const db = readDb();
  let note = db.notes.find((item) => item.userId === req.user.id && item.questionId === req.params.id);
  if (!note) {
    note = { userId: req.user.id, questionId: req.params.id, text: "" };
    db.notes.push(note);
  }
  note.text = req.body.text || "";
  note.updatedAt = new Date().toISOString();
  writeDb(db);
  res.json({ note });
});

app.get("/api/mcqs", optionalAuth, (req, res) => {
  const db = readDb();
  const topic = String(req.query.topic || "");
  const category = String(req.query.category || "");
  const search = String(req.query.search || "").toLowerCase();
  const mcqBank = allMcqs(db).filter((mcq) => {
    const haystack = [mcq.question, mcq.topic, mcq.category, ...(mcq.options || [])].join(" ").toLowerCase();
    return (!topic || mcq.topic === topic)
      && (!category || mcq.category === category)
      && (!search || haystack.includes(search));
  });
  const isGuest = !req.user;
  const guestPercent = 100;
  const guestUnlockedCount = mcqBank.length;
  const visibleMcqs = mcqBank;
  res.json({
    mcqs: visibleMcqs.map(clientMcq),
    total: mcqBank.length,
    access: {
      mode: isGuest ? "guest" : "registered",
      guestPercent,
      guestUnlockedCount,
      lockedCount: 0,
    },
  });
});

app.get("/api/mcqs/test", optionalAuth, (req, res) => {
  const db = readDb();
  const mcqBank = allMcqs(db);
  const domain = String(req.query.domain || "");
  const topic = String(req.query.topic || "");
  const avoid = String(req.query.avoid || "").split(",").filter(Boolean);
  const count = Math.min(20, Math.max(1, Number.parseInt(req.query.count, 10) || 8));
  const testQuestions = generateMcqTest(mcqBank, { domain, topic, count, avoid });
  res.json({
    test: {
      id: randomUUID(),
      domain: domain || "Mixed",
      topic: topic || "Mixed",
      questionCount: testQuestions.length,
      difficultyMix: testQuestions.reduce((acc, item) => {
        acc[item.difficulty] = (acc[item.difficulty] || 0) + 1;
        return acc;
      }, {}),
      questions: testQuestions.map(clientMcq),
    },
  });
});

app.get("/api/mcqs/:id", optionalAuth, (req, res) => {
  const db = readDb();
  const mcqBank = allMcqs(db);
  const mcq = mcqBank.find((entry) => entry.id === req.params.id);
  if (!mcq) return res.status(404).json({ error: "MCQ not found" });
  res.json({ mcq: clientMcq(mcq), source: mcq.source || "CrackIT MCQ Bank" });
});

app.post("/api/mcqs/submit", optionalAuth, (req, res) => {
  const db = readDb();
  const answers = req.body.answers || {};
  const timeTaken = Number(req.body.timeTaken || req.body.time_taken || 0) || null;
  const requestedIds = Array.isArray(req.body.questionIds) ? req.body.questionIds : Object.keys(answers);
  const mcqBank = allMcqs(db);
  const quizMcqs = requestedIds.length ? mcqBank.filter((mcq) => requestedIds.includes(mcq.id)) : mcqBank.slice(0, 8);
  const checked = quizMcqs.map((mcq) => {
    const answer = answers[mcq.id] || [];
    const selected = Array.isArray(answer) ? answer : [answer];
    const correct = selected.length === mcq.correctAnswer.length && selected.every((item) => mcq.correctAnswer.includes(item));
    return { id: mcq.id, question: mcq.question, domain: mcq.domain, topic: mcq.topic, difficulty: mcq.difficulty, selected, correctAnswer: mcq.correctAnswer, correct, explanation: mcq.explanation };
  });
  const score = checked.filter((item) => item.correct).length;
  const createdAt = new Date().toISOString();
  const attempts = checked.map((attempt) => ({
    user_id: req.user?.id || null,
    question_id: attempt.id,
    selected_answer: attempt.selected,
    correct_answer: attempt.correctAnswer,
    score: attempt.correct ? 1 : 0,
    time_taken: timeTaken,
    attempt_date: createdAt,
    domain: attempt.domain,
    topic: attempt.topic,
    difficulty: attempt.difficulty,
  }));
  const result = { id: randomUUID(), userId: req.user?.id || null, score, total: checked.length, checked, attempts, saved: Boolean(req.user), timeTaken, createdAt };
  if (req.user) {
    db.mcqResults.push(result);
    writeDb(db);
  }
  res.json({ result });
});

app.get("/api/roadmaps", optionalAuth, (req, res) => {
  const db = readDb();
  const progress = req.user ? db.roadmapProgress.filter((item) => item.userId === req.user.id) : [];
  res.json({ roadmaps: db.roadmaps.map((roadmap) => ({ ...roadmap, progress: progress.find((item) => item.roadmapId === roadmap.id)?.completedSteps || [] })) });
});

app.post("/api/roadmaps/:id/steps", auth, (req, res) => {
  const db = readDb();
  let progress = db.roadmapProgress.find((item) => item.userId === req.user.id && item.roadmapId === req.params.id);
  if (!progress) {
    progress = { userId: req.user.id, roadmapId: req.params.id, completedSteps: [] };
    db.roadmapProgress.push(progress);
  }
  progress.completedSteps = req.body.completedSteps || [];
  progress.updatedAt = new Date().toISOString();
  writeDb(db);
  res.json({ progress });
});

app.get("/api/companies", (req, res) => {
  res.json({ companies: readDb().companies.map(enrichCompany) });
});

app.get("/api/companies/:id", optionalAuth, (req, res) => {
  const db = readDb();
  const company = db.companies.find((item) => item.id === req.params.id);
  if (!company) return res.status(404).json({ error: "Company not found" });
  const aliases = [company.name];
  if (["google", "amazon", "microsoft", "meta"].includes(company.id)) aliases.push("MAANG");
  if (company.id === "meta") aliases.push("Facebook");
  const directItems = (db.contentItems || []).filter((item) => item.companyTags?.some((tag) => aliases.some((alias) => tag.toLowerCase() === alias.toLowerCase())));
  const companyDataset = readDatasetFile("company_questions.json", {});
  const datasetEntry = companyDataset[company.name] || companyDataset[company.name.toUpperCase()] || null;
  const datasetItems = (datasetEntry?.questions || []).map((item) => db.contentItems.find((content) => content.id === item.id) || item);
  const merged = new Map();
  for (const item of [...directItems, ...datasetItems]) merged.set(item.id, item);
  const items = [...merged.values()];
  res.json({
    company: enrichCompany(company),
    items,
    total: items.length,
    mappingReason: datasetEntry?.mappingReason || "Direct company tags from uploaded Master Pack",
    source: "Ultimate Tech Interview Master Guide",
  });
});

app.get("/api/resources", (req, res) => {
  const topic = String(req.query.topic || "");
  res.json({
    topic: topic || "general",
    resources: resourcesForTopic(topic),
    note: "Curated free and official learning resources. Certificates are optional and should support projects, not replace them.",
  });
});

app.get("/api/projects", (req, res) => {
  const level = String(req.query.level || "").trim().toLowerCase();
  const projects = level ? productProjects.filter((project) => project.level.toLowerCase() === level) : productProjects;
  res.json({
    total: projects.length,
    levels: [...new Set(productProjects.map((project) => project.level))],
    projects,
    note: "These are product build blueprints, not coding prompts. Build, deploy, document, and add measurable outcomes to your resume.",
  });
});

app.get("/api/projects/:id", (req, res) => {
  const project = productProjects.find((item) => item.id === req.params.id);
  if (!project) return res.status(404).json({ error: "Project not found" });
  res.json({ project });
});

app.get("/api/leaderboard", (req, res) => {
  const db = readDb();
  const users = db.users.map((user) => {
    const stats = userStats(db, user.id);
    return { username: user.username, displayName: user.displayName, xp: stats.xp, solvedCount: stats.solvedCount, streak: user.currentStreak || 0 };
  });
  users.sort((a, b) => b.xp - a.xp || b.solvedCount - a.solvedCount || b.streak - a.streak);
  res.json({ leaderboard: users.slice(0, 20) });
});

app.get("/api/streak/calendar", auth, (req, res) => {
  const db = readDb();
  const activity = [
    ...(db.contentProgress || []).filter((item) => item.userId === req.user.id).map((item) => item.updatedAt),
    ...(db.progress || []).filter((item) => item.userId === req.user.id).map((item) => item.updatedAt),
    ...(db.mcqResults || []).filter((item) => item.userId === req.user.id).map((item) => item.createdAt),
    ...(db.notes || []).filter((item) => item.userId === req.user.id).map((item) => item.updatedAt),
  ].filter(Boolean);
  const days = {};
  for (const timestamp of activity) {
    const day = new Date(timestamp).toISOString().slice(0, 10);
    days[day] = (days[day] || 0) + 1;
  }
  res.json({ days: Object.entries(days).map(([date, count]) => ({ date, count })) });
});

app.get("/api/achievements", auth, (req, res) => {
  const db = readDb();
  const stats = userStats(db, req.user.id);
  const user = db.users.find((item) => item.id === req.user.id);
  const achievements = [
    { id: "first-login", title: "Rookie Coder", unlocked: Boolean(user?.createdAt), requirement: "Create an account" },
    { id: "first-solve", title: "First Solve", unlocked: stats.solvedCount >= 1, requirement: "Solve 1 question" },
    { id: "ten-solved", title: "Problem Solver", unlocked: stats.solvedCount >= 10, requirement: "Solve 10 questions" },
    { id: "bookmarker", title: "Curious Builder", unlocked: stats.bookmarkCount >= 1, requirement: "Bookmark 1 item" },
    { id: "streak-7", title: "7 Day Streak", unlocked: (user?.currentStreak || 0) >= 7, requirement: "Reach 7 day streak" },
  ];
  res.json({ achievements });
});

app.get("/api/admin/overview", adminAuth, (req, res) => {
  const db = readDb();
  res.json({
    counts: {
      users: db.users.length,
      contentItems: db.contentItems.length,
      mcqs: allMcqs(db).length,
      companies: db.companies.length,
      roadmaps: db.roadmaps.length,
      progress: db.progress.length + db.contentProgress.length,
      notes: db.notes.length,
      mcqResults: db.mcqResults.length,
    },
    recentUsers: db.users.slice(-10).map(publicUser).reverse(),
    datasets: datasetStatus(),
  });
});

app.post("/api/admin/content", adminAuth, (req, res) => {
  const db = readDb();
  const { question, category, type, difficulty, topicTags = [], companyTags = [], sourceLine = "" } = req.body;
  if (!question || !category || !type || !difficulty) return res.status(400).json({ error: "question, category, type, and difficulty are required" });
  const item = {
    id: `admin-${slug(`${type}-${question}`)}-${Date.now()}`,
    question,
    category,
    type,
    difficulty,
    topicTags: Array.isArray(topicTags) ? topicTags : String(topicTags).split(",").map((tag) => tag.trim()).filter(Boolean),
    companyTags: Array.isArray(companyTags) ? companyTags : String(companyTags).split(",").map((tag) => tag.trim()).filter(Boolean),
    source: "Admin Content Management",
    sourceLine,
    referenceNote: contentReferenceNote,
    createdAt: new Date().toISOString(),
    createdBy: req.user.id,
  };
  db.contentItems.push(item);
  writeDb(db);
  res.status(201).json({ item });
});

app.patch("/api/admin/content/:id", adminAuth, (req, res) => {
  const db = readDb();
  const item = db.contentItems.find((entry) => entry.id === req.params.id);
  if (!item) return res.status(404).json({ error: "Content item not found" });
  Object.assign(item, req.body, { updatedAt: new Date().toISOString(), updatedBy: req.user.id });
  writeDb(db);
  res.json({ item });
});

app.delete("/api/admin/content/:id", adminAuth, (req, res) => {
  const db = readDb();
  const before = db.contentItems.length;
  db.contentItems = db.contentItems.filter((entry) => entry.id !== req.params.id);
  if (db.contentItems.length === before) return res.status(404).json({ error: "Content item not found" });
  writeDb(db);
  res.json({ ok: true });
});

function pct(part, total) {
  return total ? Math.round((part / total) * 100) : 0;
}

function difficultyWeight(difficulty) {
  if (difficulty === "Hard") return 3;
  if (difficulty === "Medium") return 2;
  return 1;
}

function userActivity(db, userId) {
  return [
    ...(db.contentProgress || []).filter((item) => item.userId === userId).map((item) => item.updatedAt),
    ...(db.progress || []).filter((item) => item.userId === userId).map((item) => item.updatedAt),
    ...(db.mcqResults || []).filter((item) => item.userId === userId).map((item) => item.createdAt),
    ...(db.notes || []).filter((item) => item.userId === userId).map((item) => item.updatedAt),
  ].filter(Boolean).sort();
}

function solvedTopics(db, userId) {
  const legacy = (db.progress || [])
    .filter((item) => item.userId === userId && item.status === "solved")
    .map((item) => db.questions.find((question) => question.id === item.questionId))
    .filter(Boolean)
    .map((question) => question.topic || "DSA");
  const content = (db.contentProgress || [])
    .filter((item) => item.userId === userId && item.solved)
    .map((item) => db.contentItems.find((contentItem) => contentItem.id === item.contentId))
    .filter(Boolean)
    .flatMap((item) => item.topicTags?.length ? item.topicTags : [item.type || item.category || "General"]);
  return [...legacy, ...content];
}

function topicCounts(topics) {
  const counts = {};
  for (const topic of topics) counts[topic] = (counts[topic] || 0) + 1;
  return Object.entries(counts)
    .map(([topic, count]) => ({ topic, count }))
    .sort((a, b) => b.count - a.count);
}

function buildPerformanceReport(db, userId) {
  const user = db.users.find((item) => item.id === userId);
  const stats = userStats(db, userId);
  const mcq = mcqAnalytics(db, userId);
  const attempts = (db.mcqResults || []).filter((result) => result.userId === userId).flatMap((result) => result.attempts || []);
  const correct = attempts.filter((attempt) => attempt.score).length;
  const activity = userActivity(db, userId);
  const solved = topicCounts(solvedTopics(db, userId));
  const strongTopics = [
    ...mcq.strongTopics.map((item) => item.topic),
    ...solved.slice(0, 3).map((item) => item.topic),
  ].filter(Boolean);
  const weakTopics = mcq.weakTopics.map((item) => item.topic);
  const fallbackWeak = ["Dynamic Programming", "Operating Systems", "Linux", "System Design"].filter((topic) => !strongTopics.includes(topic));
  const finalWeak = (weakTopics.length ? weakTopics : fallbackWeak).slice(0, 5);
  return {
    accuracy: pct(correct, attempts.length),
    speed: mcq.accuracyByTopic.filter((item) => item.averageTime).length
      ? Math.round(mcq.accuracyByTopic.filter((item) => item.averageTime).reduce((sum, item) => sum + item.averageTime, 0) / mcq.accuracyByTopic.filter((item) => item.averageTime).length)
      : null,
    streak: user?.currentStreak || 0,
    dailyActivity: activity.slice(-14),
    strengths: [...new Set(strongTopics)].slice(0, 5),
    weakAreas: [...new Set(finalWeak)],
    recommendations: [...new Set(finalWeak)].slice(0, 3).map((topic) => `Practice ${topic} with one focused quiz and two revision items this week.`),
    solvedCount: stats.solvedCount,
    mcqAttempts: attempts.length,
  };
}

function buildStudyPlan(report, goal = "Software Engineer") {
  const focus = report.weakAreas.length ? report.weakAreas : ["DSA", "DBMS", "Networking"];
  const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  return days.map((day, index) => ({
    day,
    tasks: index === 6
      ? ["Review mistakes from the week", "Update notes and bookmarks", "Light revision or rest"]
      : [
          `${focus[index % focus.length]} practice`,
          index % 2 === 0 ? "MCQ accuracy drill" : "Interview question revision",
          index === 4 ? `${goal} mock checkpoint` : "Save weak questions for revision",
        ],
  }));
}

function roadmapForGoal(goal) {
  const map = {
    "Frontend Developer": ["HTML/CSS", "JavaScript", "React", "TypeScript", "Testing", "Portfolio Project", "Interview Prep"],
    "Backend Developer": ["JavaScript or Java", "DBMS", "APIs", "Authentication", "Caching", "System Design", "Backend Project"],
    "Full Stack Developer": ["Frontend", "Node.js", "DBMS", "Authentication", "Deployment", "Full Stack Project", "Interview Prep"],
    "AI Engineer": ["Python", "Statistics", "ML", "Deep Learning", "LLMs", "RAG", "AI Project"],
    "Data Analyst": ["Excel", "SQL", "Python", "Statistics", "Power BI", "Portfolio Dashboards"],
    "Cloud Engineer": ["Linux", "Networking", "AWS", "Docker", "CI/CD", "Monitoring", "Cloud Project"],
    "Cyber Security Engineer": ["Networking", "Linux", "Security Basics", "OWASP", "Cryptography", "Labs", "Security Project"],
  };
  return map[goal] || map["Full Stack Developer"];
}

function buildReadiness(db, userId) {
  const stats = userStats(db, userId);
  const mcq = mcqAnalytics(db, userId);
  const avgAccuracy = mcq.accuracyByTopic.length
    ? Math.round(mcq.accuracyByTopic.reduce((sum, item) => sum + item.accuracy, 0) / mcq.accuracyByTopic.length)
    : 0;
  const solvedScore = Math.min(35, Math.round(stats.solvedCount * 1.5));
  const accuracyScore = Math.round(avgAccuracy * 0.35);
  const base = solvedScore + accuracyScore;
  const companies = {
    Amazon: { weight: 0.9, gaps: ["System Design", "Dynamic Programming", "Leadership Principles"] },
    Microsoft: { weight: 0.88, gaps: ["Graphs", "OOP", "System Design"] },
    Google: { weight: 0.72, gaps: ["Advanced DSA", "Graphs", "System Design"] },
    TCS: { weight: 1.12, gaps: ["Aptitude", "SQL", "HR Round"] },
    Infosys: { weight: 1.05, gaps: ["DBMS", "OOP", "Pseudocode"] },
  };
  return Object.fromEntries(Object.entries(companies).map(([company, config]) => [
    company,
    {
      score: Math.max(5, Math.min(98, Math.round(base * config.weight))),
      gaps: config.gaps.filter((gap) => !mcq.strongTopics.some((topic) => topic.topic.toLowerCase().includes(gap.toLowerCase()))).slice(0, 3),
    },
  ]));
}

function projectSignals(db, userId) {
  const completed = (db.contentProgress || [])
    .filter((item) => item.userId === userId && item.solved)
    .map((item) => (db.contentItems || []).find((content) => content.id === item.contentId))
    .filter((item) => item && (item.type === "Coding Challenge" || item.category === "Career Preparation"));
  return {
    completedCount: completed.length,
    resumeReadyCount: completed.filter((item) => item.difficulty === "Hard" || item.difficulty === "Advanced").length,
    topics: [...new Set(completed.flatMap((item) => item.topicTags || []))].slice(0, 8),
  };
}

function analyzeResumeText(resumeText = "", targetRole = "Software Engineer", goal = "Software Engineer") {
  const text = String(resumeText || "").toLowerCase();
  const target = `${targetRole} ${goal}`.toLowerCase();
  const keywordMap = {
    "Software Engineer": ["dsa", "data structures", "algorithms", "oop", "dbms", "operating system", "computer networks", "git", "project"],
    "Full Stack Developer": ["html", "css", "javascript", "react", "node", "api", "database", "mongodb", "deployment"],
    "Backend Developer": ["api", "node", "express", "database", "sql", "authentication", "caching", "system design"],
    "AI Engineer": ["python", "machine learning", "deep learning", "statistics", "llm", "rag", "model", "deployment"],
    "Data Analyst": ["sql", "excel", "python", "power bi", "tableau", "statistics", "dashboard"],
    "Cloud Engineer": ["linux", "aws", "docker", "kubernetes", "networking", "ci/cd", "monitoring"],
    "Cyber Security Engineer": ["networking", "linux", "owasp", "encryption", "vulnerability", "security", "firewall"],
  };
  const roleKey = Object.keys(keywordMap).find((role) => target.includes(role.toLowerCase())) || "Software Engineer";
  const required = keywordMap[roleKey];
  const found = required.filter((keyword) => text.includes(keyword));
  const missing = required.filter((keyword) => !text.includes(keyword));
  const hasEmail = /[^\s@]+@[^\s@]+\.[^\s@]+/.test(resumeText);
  const hasPhone = /\b\d{10}\b/.test(resumeText.replace(/\D/g, ""));
  const hasLinks = ["github", "linkedin", "portfolio"].some((item) => text.includes(item));
  const hasMetrics = /\b\d+%|\b\d+\+|\b\d+x|\b\d+ users|\b\d+ projects/.test(text);
  const hasProjects = text.includes("project") || text.includes("built") || text.includes("developed");
  const hasExperience = text.includes("intern") || text.includes("experience") || text.includes("freelance");
  const lengthScore = resumeText.length >= 900 && resumeText.length <= 4500 ? 12 : resumeText.length > 250 ? 7 : 2;
  const score =
    Math.round((found.length / Math.max(required.length, 1)) * 38)
    + (hasEmail ? 8 : 0)
    + (hasPhone ? 6 : 0)
    + (hasLinks ? 10 : 0)
    + (hasMetrics ? 10 : 0)
    + (hasProjects ? 12 : 0)
    + (hasExperience ? 4 : 0)
    + lengthScore;
  const atsScore = Math.max(5, Math.min(98, score));
  return {
    targetRole: roleKey,
    atsScore,
    foundKeywords: found,
    missingKeywords: missing,
    checks: {
      contact: hasEmail && hasPhone,
      links: hasLinks,
      quantifiedImpact: hasMetrics,
      projects: hasProjects,
      roleKeywordMatch: pct(found.length, required.length),
      readableLength: lengthScore >= 10,
    },
    suggestions: [
      !hasLinks && "Add GitHub, LinkedIn, and portfolio links near the top.",
      !hasMetrics && "Add numbers: users, speed improvement, accuracy, marks, or project impact.",
      !hasProjects && "Add 2-3 project bullets with tech stack, features, and deployment.",
      missing.length && `Add role keywords naturally: ${missing.slice(0, 5).join(", ")}.`,
      atsScore < 70 && "Use simple headings: Education, Skills, Projects, Experience, Achievements.",
    ].filter(Boolean),
  };
}

function placementReadinessScore(db, userId, resumeScore = 0) {
  const stats = userStats(db, userId);
  const mcq = mcqAnalytics(db, userId);
  const attempts = (db.mcqResults || []).filter((result) => result.userId === userId).flatMap((result) => result.attempts || []);
  const correct = attempts.filter((attempt) => attempt.score).length;
  const dsaScore = Math.min(35, Math.round(stats.solvedCount * 1.2));
  const mcqScore = Math.round(pct(correct, attempts.length) * 0.25);
  const projectScore = Math.min(15, projectSignals(db, userId).completedCount * 3);
  const streakScore = Math.min(10, (db.users.find((user) => user.id === userId)?.currentStreak || 0) * 2);
  const resumePart = Math.round((resumeScore || db.users.find((user) => user.id === userId)?.resumeScore || 0) * 0.15);
  const total = Math.max(0, Math.min(100, dsaScore + mcqScore + projectScore + streakScore + resumePart));
  return {
    total,
    breakdown: {
      dsaScore,
      mcqScore,
      projectScore,
      streakScore,
      resumeScore: resumePart,
    },
  };
}

function buildProjectRecommendations(user, report, goal) {
  const skills = (user?.skills || []).map((skill) => skill.toLowerCase()).join(" ");
  const fullStack = skills.includes("react") || skills.includes("node") || goal.includes("Full Stack");
  const ai = goal.includes("AI") || skills.includes("python") || skills.includes("ml");
  const security = goal.includes("Cyber");
  const projects = [
    fullStack && { name: "Placement Tracker", techStack: ["React", "Node.js", "PostgreSQL"], difficulty: "Intermediate", placementValue: "High", why: "Matches web stack and shows CRUD, auth, and dashboard skill." },
    fullStack && { name: "Learning Management System", techStack: ["Next.js", "Supabase", "Tailwind"], difficulty: "Advanced", placementValue: "Very High", why: "Directly aligns with CrackIT-style education product experience." },
    ai && { name: "ATS Resume Checker", techStack: ["Next.js", "PDF.js", "Rule Engine", "Database"], difficulty: "Intermediate", placementValue: "Very High", why: "Combines parsing, transparent scoring, and career value without vendor lock-in." },
    security && { name: "OWASP Practice Lab", techStack: ["Node.js", "Docker", "Linux"], difficulty: "Advanced", placementValue: "High", why: "Shows practical security awareness without unsafe real-world targeting." },
    { name: "Mock Interview Portal", techStack: ["React", "Node.js", "PostgreSQL"], difficulty: "Intermediate", placementValue: "High", why: `Improves weak areas: ${report.weakAreas.slice(0, 2).join(", ") || "interview readiness"}.` },
  ].filter(Boolean);
  return projects.slice(0, 4);
}

function buildContentRecommendations(db, report) {
  return report.weakAreas.map((topic) => {
    const items = (db.contentItems || [])
      .filter((item) => [item.question, item.type, item.category, ...(item.topicTags || [])].join(" ").toLowerCase().includes(topic.toLowerCase()))
      .slice(0, 5)
      .map((item) => ({ id: item.id, title: item.question, type: item.type, difficulty: item.difficulty }));
    return {
      strugglingTopic: topic,
      resources: {
        notes: `${topic} revision notes from CrackIT content library`,
        mcqs: `${topic} MCQ drill`,
        problems: items,
        estimatedFixTime: "3-5 focused sessions",
      },
    };
  });
}

function buildLeaderboardRows(db) {
  return db.users.map((user) => {
    const stats = userStats(db, user.id);
    const mcq = mcqAnalytics(db, user.id);
    const speedBonus = mcq.accuracyByTopic.some((item) => item.averageTime && item.averageTime < 20) ? 25 : 0;
    const xp = stats.xp + mcq.attempts * 3 + (user.currentStreak || 0) * 5 + speedBonus;
    return { username: user.username, displayName: user.displayName, college: user.college || "Unknown", branch: user.branch || "General", xp, solvedCount: stats.solvedCount, streak: user.currentStreak || 0 };
  }).sort((a, b) => b.xp - a.xp || b.solvedCount - a.solvedCount);
}

function buildWeeklyReport(db, userId, report) {
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const results = (db.mcqResults || []).filter((item) => item.userId === userId && new Date(item.createdAt).getTime() >= weekAgo);
  const answers = results.flatMap((item) => item.attempts || []);
  const correct = answers.filter((item) => item.score).length;
  return {
    week: "Current week",
    questionsSolved: userStats(db, userId).solvedCount,
    accuracy: `${pct(correct, answers.length)}%`,
    bestTopic: report.strengths[0] || "Not enough data",
    worstTopic: report.weakAreas[0] || "Not enough data",
    growth: results.length ? "Activity detected this week" : "No quiz attempts this week yet",
    studyHours: Math.round((answers.reduce((sum, item) => sum + (Number(item.time_taken) || 0), 0) / 3600) * 10) / 10,
    nextWeekFocus: report.weakAreas.slice(0, 3),
    actionableRecommendations: report.recommendations,
  };
}

function buildAdminQualityFlags(db) {
  const seen = new Map();
  const flags = [];
  for (const item of [...(db.contentItems || []), ...allMcqs(db)]) {
    const question = item.question || item.title || "";
    const key = normalizeMcqText(question);
    if (seen.has(key)) flags.push({ type: "Duplicate Question", severity: "High", itemId: item.id, message: `Similar to ${seen.get(key)}` });
    else seen.set(key, item.id);
    if (item.type === "MCQ") {
      if (!item.explanation || item.explanation.length < 80) flags.push({ type: "Weak Explanation", severity: "Medium", itemId: item.id, message: "MCQ explanation is too short." });
      if (!Array.isArray(item.options) || item.options.length !== 4) flags.push({ type: "Invalid Options", severity: "High", itemId: item.id, message: "MCQ must have exactly four options." });
    }
    if (!item.topicTags?.length && !item.topic) flags.push({ type: "Missing Topic", severity: "Low", itemId: item.id, message: "No topic metadata found." });
  }
  return flags.slice(0, 50);
}

function buildPlacementCopilot(db, userId, goal = "Full Stack Developer") {
  const user = db.users.find((item) => item.id === userId) || {
    id: "guest",
    displayName: "CrackIT Learner",
    username: "guest",
    skills: [],
    currentStreak: 0,
    college: "Open Source",
    branch: "Student",
  };
  const report = buildPerformanceReport(db, userId);
  const roadmap = roadmapForGoal(goal);
  const roadmapProgress = (db.roadmapProgress || []).filter((item) => item.userId === userId);
  const completedRoadmapSteps = roadmapProgress.reduce((sum, item) => sum + (item.completedSteps?.length || 0), 0);
  const resumeAnalyzer = analyzeResumeText(user.resumeText || "", goal, goal);
  const readinessScore = placementReadinessScore(db, userId, resumeAnalyzer.atsScore);
  return {
    mode: "smart-mentor",
    user: publicUser(user),
    mentorStatus: {
      provider: "offline-rule-engine",
      note: "No OpenAI, Gemini, external AI API, API key, rate limit, or vendor lock-in. Scores are generated locally from CrackIT database data.",
    },
    placementReadinessScore: readinessScore,
    quizGenerator: {
      availableDomains: [...new Set(allMcqs(db).map((mcq) => mcq.domain))],
      endpoint: "/api/smart-mentor/quiz",
      rules: ["no duplicate IDs", "topic filter", "difficulty filter", "company filter", "correct answer hidden until submit"],
    },
    performanceAnalyzer: report,
    studyPlanner: { goal, plan: buildStudyPlan(report, goal) },
    learningPathAssigner: { goal, roadmap, progressPercent: pct(completedRoadmapSteps, Math.max(roadmap.length, 1)) },
    companyReadiness: buildReadiness(db, userId),
    resumeAnalyzer,
    projectRecommender: buildProjectRecommendations(user, report, goal),
    mockInterviewer: {
      technical: report.weakAreas.slice(0, 3).map((topic) => `Explain one ${topic} concept and solve a related example.`),
      hr: ["Tell me about yourself.", "Describe a time you handled a difficult bug.", "Why should this company hire you?"],
      behavioral: ["Use STAR format to explain a leadership moment.", "Tell me about a time you learned something quickly."],
      evaluationRubric: ["accuracy", "confidence", "completeness", "structure"],
    },
    leaderboardEngine: {
      boards: {
        global: buildLeaderboardRows(db).slice(0, 10),
        college: buildLeaderboardRows(db).filter((row) => row.college === (user.college || "Unknown")).slice(0, 10),
        branch: buildLeaderboardRows(db).filter((row) => row.branch === (user.branch || "General")).slice(0, 10),
      },
      antiCheat: ["answer velocity anomaly scan", "session validation", "duplicate attempt review"],
    },
    weeklyReport: buildWeeklyReport(db, userId, report),
    contentRecommender: buildContentRecommendations(db, report),
    progressReport: {
      dsaSolved: userStats(db, userId).solvedCount,
      mcqAccuracy: report.accuracy,
      weakTopicCount: report.weakAreas.length,
      projectSignals: projectSignals(db, userId),
      readinessScore: readinessScore.total,
      message: readinessScore.total >= 75 ? "You are in interview-sharpening mode." : readinessScore.total >= 45 ? "You have a base. Build consistency and projects." : "Start with fundamentals, daily MCQs, and one visible project.",
    },
    adminAssistant: {
      flags: isAdminUser(user) ? buildAdminQualityFlags(db) : [],
      visibleTo: "admin",
    },
  };
}

function mentorUserId(req) {
  return req.user?.id || "guest";
}

app.get("/api/smart-mentor", optionalAuth, (req, res) => {
  const db = readDb();
  const goal = String(req.query.goal || "Full Stack Developer");
  res.json(buildPlacementCopilot(db, mentorUserId(req), goal));
});

app.post("/api/smart-mentor/resume", optionalAuth, (req, res) => {
  const db = readDb();
  const goal = String(req.body.goal || req.query.goal || "Software Engineer");
  const resumeText = String(req.body.resumeText || "");
  const analysis = analyzeResumeText(resumeText, goal, goal);
  const readiness = placementReadinessScore(db, mentorUserId(req), analysis.atsScore);
  res.json({ analysis, readiness });
});

app.get("/api/smart-mentor/performance", optionalAuth, (req, res) => {
  const db = readDb();
  res.json({ report: buildPerformanceReport(db, mentorUserId(req)) });
});

app.get("/api/smart-mentor/study-plan", optionalAuth, (req, res) => {
  const db = readDb();
  const goal = String(req.query.goal || "Software Engineer");
  res.json({ goal, plan: buildStudyPlan(buildPerformanceReport(db, mentorUserId(req)), goal) });
});

app.get("/api/smart-mentor/readiness", optionalAuth, (req, res) => {
  const db = readDb();
  res.json({ readiness: buildReadiness(db, mentorUserId(req)), score: placementReadinessScore(db, mentorUserId(req)) });
});

app.get("/api/smart-mentor/company-readiness", optionalAuth, (req, res) => {
  const db = readDb();
  const readiness = buildReadiness(db, mentorUserId(req));
  res.json({
    reports: Object.entries(readiness).map(([company, item]) => ({
      company,
      readiness: item.score,
      missingSkills: item.gaps,
      recommendation: item.gaps.length
        ? `Before targeting ${company}, focus on ${item.gaps.join(", ")}.`
        : `You have a healthy baseline for ${company}. Keep solving mixed tests.`,
    })),
  });
});

app.get("/api/smart-mentor/progress-report", optionalAuth, (req, res) => {
  const db = readDb();
  const mentor = buildPlacementCopilot(db, mentorUserId(req), String(req.query.goal || "Full Stack Developer"));
  res.json({ report: mentor.progressReport });
});

app.get("/api/smart-mentor/weekly-report", optionalAuth, (req, res) => {
  const db = readDb();
  const report = buildPerformanceReport(db, mentorUserId(req));
  res.json({ report: buildWeeklyReport(db, mentorUserId(req), report) });
});

app.get("/api/smart-mentor/recommendations", optionalAuth, (req, res) => {
  const db = readDb();
  const user = db.users.find((item) => item.id === mentorUserId(req)) || { skills: [] };
  const goal = String(req.query.goal || "Full Stack Developer");
  const report = buildPerformanceReport(db, mentorUserId(req));
  res.json({
    content: buildContentRecommendations(db, report),
    projects: buildProjectRecommendations(user, report, goal),
  });
});

app.get("/api/smart-mentor/quiz", optionalAuth, (req, res) => {
  const db = readDb();
  const domain = String(req.query.domain || "");
  const topic = String(req.query.topic || "");
  const difficulty = String(req.query.difficulty || "");
  const company = String(req.query.company || "");
  const avoid = String(req.query.avoid || "").split(",").filter(Boolean);
  const count = Math.min(20, Math.max(1, Number.parseInt(req.query.count, 10) || 8));
  let bank = allMcqs(db);
  if (difficulty) bank = bank.filter((mcq) => mcq.difficulty === difficulty);
  if (company) bank = bank.filter((mcq) => (mcq.companyTags || []).includes(company));
  const questions = generateMcqTest(bank, { domain, topic, count, avoid });
  res.json({
    quiz: {
      id: randomUUID(),
      engine: "offline-rule-engine",
      domain: domain || "Mixed",
      topic: topic || "Mixed",
      difficulty: difficulty || "Mixed",
      company: company || "General",
      questions: questions.map(({ correctAnswer, ...mcq }) => mcq),
    },
  });
});

app.get("/api/ai/copilot", auth, (req, res) => {
  const db = readDb();
  const goal = String(req.query.goal || "Full Stack Developer");
  res.json(buildPlacementCopilot(db, req.user.id, goal));
});

app.get("/api/ai/performance", auth, (req, res) => {
  const db = readDb();
  res.json({ report: buildPerformanceReport(db, req.user.id) });
});

app.get("/api/ai/study-plan", auth, (req, res) => {
  const db = readDb();
  const goal = String(req.query.goal || "Software Engineer");
  res.json({ goal, plan: buildStudyPlan(buildPerformanceReport(db, req.user.id), goal) });
});

app.get("/api/ai/readiness", auth, (req, res) => {
  const db = readDb();
  res.json({ readiness: buildReadiness(db, req.user.id) });
});

app.get("/api/ai/recommendations", auth, (req, res) => {
  const db = readDb();
  const user = db.users.find((item) => item.id === req.user.id);
  const goal = String(req.query.goal || "Full Stack Developer");
  const report = buildPerformanceReport(db, req.user.id);
  res.json({
    content: buildContentRecommendations(db, report),
    projects: buildProjectRecommendations(user, report, goal),
  });
});

app.get("/api/ai/quality", adminAuth, (req, res) => {
  res.json({ flags: buildAdminQualityFlags(readDb()) });
});

app.get("/api/ai/quiz", auth, (req, res) => {
  const db = readDb();
  const domain = String(req.query.domain || "");
  const topic = String(req.query.topic || "");
  const difficulty = String(req.query.difficulty || "");
  const company = String(req.query.company || "");
  const count = Math.min(20, Math.max(1, Number.parseInt(req.query.count, 10) || 8));
  let bank = allMcqs(db);
  if (difficulty) bank = bank.filter((mcq) => mcq.difficulty === difficulty);
  if (company) bank = bank.filter((mcq) => (mcq.companyTags || []).includes(company));
  const questions = generateMcqTest(bank, { domain, topic, count });
  res.json({
    quiz: {
      id: randomUUID(),
      domain: domain || "Mixed",
      topic: topic || "Mixed",
      difficulty: difficulty || "Mixed",
      company: company || "General",
      questions: questions.map(({ correctAnswer, ...mcq }) => mcq),
    },
  });
});

await initializeDatabase();

const PORT = Number(process.env.PORT || 4000);
app.listen(PORT, () => console.log(`CrackIT API running on http://127.0.0.1:${PORT}`));
