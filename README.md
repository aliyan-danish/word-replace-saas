# Word Replace Tool

A SaaS-style web application that lets users upload text files (single files or bulk `.zip` archives), search for a target word across all files with occurrence counts, confirm and run a find-and-replace, then download the results — with subscription plans, a free trial, and role-based access built in.

Built as part of a software internship project to explore AI-assisted, full-stack development practices.

## Features

- **Authentication** — secure registration/login with JWT and bcrypt password hashing
- **File upload** — single `.txt` files or bulk `.zip` archives, with validation and size/count limits
- **Word search** — case-sensitive and whole-word matching options, per-file and total occurrence counts
- **Find & replace** — runs asynchronously via a background job queue so large batches never block the app; original file content is always preserved for safety
- **Download** — replaced files packaged back into a `.zip` for download
- **Job history** — track the status of every past upload (pending, processing, completed, failed)
- **Subscription & trial system** — new users get a 7-day full-access trial, then move to a free tier with usage limits, or a paid Pro tier for unlimited use

## Tech Stack

**Backend**
- Node.js + Express
- PostgreSQL (hosted on [Neon](https://neon.tech)) via [Prisma ORM](https://www.prisma.io/)
- JWT authentication + bcrypt
- [BullMQ](https://docs.bullmq.io/) + Redis for background job processing (async find-and-replace)
- Multer + AdmZip for file uploads and archive handling

**Frontend**
- React + Vite
- Tailwind CSS
- React Router

## Project Structure

This is a monorepo with two apps:

```
word-replace-saas/
├── apps/
│   ├── server/     # Express API, Prisma schema, background worker
│   └── client/     # React frontend
```

## Getting Started

### Prerequisites
- Node.js
- A PostgreSQL database (e.g. a free [Neon](https://neon.tech) project)
- Redis running locally (e.g. via [Memurai](https://www.memurai.com/) on Windows, or Docker/WSL on other setups)

### Backend setup

```bash
cd apps/server
npm install
# create a .env file with DATABASE_URL and PORT
npx prisma migrate dev
npm run seed        # seeds the FREE and PRO subscription plans
npm run dev          # starts the API server
npm run worker       # starts the background job worker (separate terminal)
```

### Frontend setup

```bash
cd apps/client
npm install
npm run dev
```

The frontend runs on `http://localhost:5173` and expects the backend on `http://localhost:5000`.

## Development Workflow

This project was built collaboratively using **Cursor** (AI pair-programming for implementation) alongside architectural review and testing guidance, with every feature verified end-to-end — via direct API testing and real browser testing — before being considered complete.

## Roadmap

- [x] Authentication & protected routes
- [x] File upload (single + bulk zip)
- [x] Word search with occurrence counts
- [x] Find & replace with async background processing
- [x] Download results
- [x] Job history
- [ ] Subscription plans & trial logic
- [ ] Admin panel
- [ ] Security hardening (rate limiting, input sanitization)
- [ ] Deployment & final polish

## License

Internal project — not currently licensed for external use.
