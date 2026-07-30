# VoiceyBill — Backend

[![CI](https://github.com/voiceyBill/voiceyBill-server/actions/workflows/ci.yml/badge.svg)](https://github.com/voiceyBill/voiceyBill-server/actions/workflows/ci.yml)
[![CodeQL](https://github.com/voiceyBill/voiceyBill-server/actions/workflows/codeql.yml/badge.svg)](https://github.com/voiceyBill/voiceyBill-server/actions/workflows/codeql.yml)
[![Release](https://github.com/voiceyBill/voiceyBill-server/actions/workflows/release.yml/badge.svg)](https://github.com/voiceyBill/voiceyBill-server/actions/workflows/release.yml)

REST API powering transaction management, voice-to-transaction AI processing, receipt scanning, report scheduling, and user auth for VoiceyBill.
It also supports multi-currency transactions by storing original amounts, converted base-currency amounts and exchange-rate metadata.

## Local development

This backend uses its own MongoDB database named `voiceybill` by default. Contributors can run the API with either a local MongoDB instance or a Docker container.

### Option 1: Docker MongoDB

Start a local database:

```bash
docker compose up -d
```

Then copy `.env.example` to `.env` and keep `MONGO_URI=mongodb://localhost:27017`.

### Option 2: MongoDB Atlas

Set `MONGO_URI` to your Atlas connection string and keep `MONGO_DB_NAME=voiceybill`.

### Start the server

```bash
npm run dev     # ts-node-dev with hot reload
```

You should see:

```
Connected to MongoDB
🚀 Server is running on http://localhost:8000
```

### Seed data

In a new terminal, seed demo data:

```bash
npm run seed
```

To wipe and recreate the demo data:

```bash
npm run seed:wipe
```

## Tech stack

- **NestJS 10** on the **Express 4** platform + **TypeScript**
- **MongoDB** via **Mongoose 8**
- **Passport.js** + **JWT** for authentication
- **Google Generative AI** (Gemini) for voice transcription classification
- **OpenAI** for receipt scanning
- **Cloudinary** for file/image storage
- **Resend** for transactional email (report delivery)
- **node-cron** for scheduled report jobs
- **Frankfurter API** with local cache fallback for exchange rates

## Prerequisites

- **Node.js 20.0.0 or later** (`node --version` to check)
- **npm 10.0.0 or later** (`npm --version` to check)
- **MongoDB instance** (local Docker container or MongoDB Atlas cloud)
- **Docker Desktop** (optional but recommended for local MongoDB)

> If you don't meet the Node/npm version requirement, download from https://nodejs.org/ (choose the LTS version 20+)

## Verify your setup

Before continuing, verify your machine meets the requirements:

```bash
node --version      # should be v20.0.0 or higher
npm --version       # should be 10.0.0 or higher
git --version       # should be 2.x or higher
docker --version    # should be 20.0+ (optional, only needed for Docker MongoDB)
```

**If versions are too old:**

- Download Node.js from https://nodejs.org/ (choose LTS v20+)
- Restart your terminal and verify again

## Setup

```bash
cp .env.example .env   # fill in required values
npm ci
```

### Environment variables

| Variable                | Description                                              |
| ----------------------- | -------------------------------------------------------- |
| `PORT`                  | Server port (default `8000`)                             |
| `MONGO_URI`             | MongoDB connection string                                |
| `MONGO_DB_NAME`         | Database name used by the backend (default `voiceybill`) |
| `JWT_SECRET`            | Secret for signing JWT tokens                            |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary cloud name                                    |
| `CLOUDINARY_API_KEY`    | Cloudinary API key                                       |
| `CLOUDINARY_API_SECRET` | Cloudinary API secret                                    |
| `GEMINI_API_KEY`        | Google Generative AI key (voice processing)              |
| `OPENAI_API_KEY`        | OpenAI key (receipt scanning)                            |
| `RESEND_API_KEY`        | Resend API key (report emails)                           |
| `FRONTEND_ORIGIN`       | Allowed CORS origin for the web client                   |

## Development

```bash
npm run dev       # ts-node-dev with hot reload
npm run build     # compile TypeScript → dist/
npm start         # run compiled build
npm test          # run the e2e suite
npm run typecheck # type-check src + tests without emitting
npm run lint      # eslint
```

## Tests

```bash
npm test                 # the whole suite
TEST_VERBOSE=1 npm test  # keep the app's own console output
```

The suite boots the **real** application through `createNestApp` from
`src/main.ts`, so what it exercises is the production bootstrap: the pre-router
middleware order, `AppModule`'s route-scoped middleware, Nest's router and
not-found handler, the real `JwtStrategy`, the real Zod validators, the real
Multer instances and the real `errorHandler`.

Only the I/O leaves are replaced — Mongo, the Cloudinary storage engine, the AI
clients and cron — by seeding `require.cache` in `test/support/app.ts` before
`src/main.ts` is first imported. **No database or network access is needed**, and
no test touches real data.

```
test/
  run.ts                    entry point; requires every spec
  support/app.ts            env, stubs, boots the app, request helpers
  support/fakes.ts          recording test doubles for the service layer
  support/stub.ts           require.cache seeding helper
  stub-fidelity.spec.ts     fails if a fake drifts from the real module's exports
  routing.e2e-spec.ts       route-table parity, resolution order, catch-all 404
  auth.e2e-spec.ts          401-before-404 ordering, token branches
  error-contract.e2e-spec.ts  Zod / Multer / AppError / 500 response bodies
  middleware.e2e-spec.ts    CORS, rate limits, body limits, single-execution
  contracts.e2e-spec.ts     per-route status, body and argument pass-through
  serverless.e2e-spec.ts    the Vercel handler and its shared bootstrap
```

Two properties worth knowing about, because they make the suite trustworthy
rather than merely green:

- `routing.e2e-spec.ts` derives the live route table from the controller
  decorators and compares it to a hand-written list **in both directions**. A
  route that disappears fails, and so does a route that appears without being
  recorded — so the 46-route surface cannot drift silently.
- `stub-fidelity.spec.ts` loads each real service module from disk and asserts
  the corresponding fake exports exactly the same names. Renaming a service
  function without updating the fake fails the suite instead of leaving a test
  that passes against a stub production no longer resembles.

There is no test framework dependency: the suite runs on Node's built-in
`node:test` through `ts-node`, so it adds **zero packages** to the tree.

## Docker

The repo includes a local MongoDB Compose file for contributors who do not want to install MongoDB directly. The container stores data in a named volume so it persists between restarts.

If you use Docker, set `MONGO_URI=mongodb://localhost:27017` in `.env` and keep `MONGO_DB_NAME=voiceybill`.

## API areas

- **Auth** — register, login, JWT refresh
- **Transactions** — CRUD, bulk delete, CSV import, duplicate, recurring intervals
- **Currency** — supported currency list, exchange rates, cached fallback rates
- **Analytics** — dashboard stats, income/expense trends, category breakdown
- **Voice** — upload audio, AI transcription → structured transaction data
- **Receipt scan** — upload receipt image, AI extraction → transaction fields
- **Reports** — generate reports, schedule recurring email delivery
- **User** — profile update, avatar upload

## Project layout

NestJS runs on the Express platform, so the HTTP behaviour (routing, CORS, body
limits, Multer, Passport) is unchanged from the original Express app.

```
src/
  index.ts              entry point — dev listener + Vercel serverless handler
  main.ts               Nest bootstrap; registers the pre-router middleware stack
  app.module.ts         root module; binds all route-scoped middleware
  app.controller.ts     unauthenticated /, /health, /test
  modules/<feature>/    controller + module + injectable service seam
  common/               exception filter, JWT strategy, @CurrentUser decorator
  services/             business logic (framework-agnostic)
  models/ validators/ dto/ mailers/ utils/ config/ cron/
```

Routing lives in `@Controller` / `@Get` decorators instead of `src/routes`.
Business logic in `src/services` is plain functions and is unchanged; each
feature module exposes a thin `@Injectable()` seam over it so controllers
resolve dependencies through Nest's DI container.

Two deliberate deviations from default Nest idiom, both to preserve the previous
behaviour exactly:

- **Authentication is middleware, not a guard.** Express ran Passport across the
  whole `/<feature>` prefix, before route matching, so an unknown sub-path under
  a protected prefix answers `401`, not `404`. A guard runs after routing.
- **Multer is middleware, not `FileInterceptor`.** The interceptor remaps Multer
  failures to Nest exceptions (e.g. `LIMIT_FILE_SIZE` → 413), which would change
  the error bodies the shared error handler produces.

There is also no terminal `server.use(errorHandler)` in `main.ts`. Nest registers
its own error middleware last in the Express chain during `app.init()`, so
failures raised by pre-router and route-scoped middleware (Multer, CORS
rejection, the per-request database connect) reach `AllExceptionsFilter` — which
delegates to the same `errorHandler`. A handler appended after `init()` would be
unreachable. `test/error-contract.e2e-spec.ts` pins this for both
controller-thrown and middleware-raised failures.

## Dependency notes

`@nestjs/platform-express@10` pins **multer 2.0.2** exactly, and that version
carries four high-severity DoS advisories. `package.json` therefore has an
`overrides` entry so the tree resolves to a single patched multer:

```json
"overrides": { "multer": "^2.1.1" }
```

Two consequences to be aware of:

- **`npm ls multer` exits non-zero** and prints
  `invalid: "2.0.2" from node_modules/@nestjs/platform-express`. That is the
  expected result of overriding an exact pin — install, build and deploy are all
  unaffected. **Do not gate any script or CI step on `npm ls`.**
- The override is safe because `platform-express` only uses multer for
  `FileInterceptor`, which this codebase deliberately does not use (see above),
  and it stays within the same major version.

Revisit this when moving to NestJS 11, which may pin a patched multer itself.

## Multi-currency support

- Users can set a `baseCurrency` on their profile.
- Transactions may include a `currency` code when created or updated.
- Foreign-currency transactions store the original amount/currency plus the converted base-currency amount in `amount`.
- Exchange rate, rate source (`live` or `cached`) and fetch timestamp are stored with converted transactions.
- Changing a user's base currency rebases existing transactions so dashboard totals and reports remain numerically correct.
- Currency endpoints:
  - `GET /api/currency/supported`
  - `GET /api/currency/rate?from=EUR&to=INR`

## Contributing

Please follow `CONTRIBUTING.md` for setup, issue reporting, and pull request rules.

- Use the issue templates for bugs, feature requests, and questions.
- Attach screenshots, screen recordings, or request/response samples when they help reproduce a problem.
- Use the pull request template and keep PRs focused on one change.

See [CONTRIBUTING.md](CONTRIBUTING.md), [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md), and [SECURITY.md](SECURITY.md).

## Troubleshooting

### "Cannot find module" or "npm ERR!"

1. Clear and reinstall dependencies:

   ```bash
   rm -rf node_modules package-lock.json
   npm ci
   ```

2. Check Node version meets requirement (20+):

   ```bash
   node --version
   npm --version
   ```

3. If still failing, check if there are native modules (bcrypt, etc.) that need Python/build tools.

### MongoDB connection error ("connect ECONNREFUSED")

1. If using Docker, verify the container is running:

   ```bash
   docker ps | grep mongo
   ```

2. If not running, start it:

   ```bash
   docker compose up -d
   ```

3. If using MongoDB Atlas, verify `MONGO_URI` is correct in `.env`:
   ```bash
   curl "your_mongo_uri_from_env"
   ```

### Port 8000 already in use

1. Change the port in `.env`:

   ```bash
   PORT=3001
   ```

2. Or kill the process using port 8000 (be careful):

   ```bash
   # Windows
   netstat -ano | findstr :8000
   taskkill /PID <PID> /F

   # Mac/Linux
   lsof -i :8000
   kill -9 <PID>
   ```

### "ERR: Seeding failed" or seed data won't populate

1. Verify the database is connected:

   ```bash
   npm run dev
   # should show "Connected to MongoDB"
   ```

2. Check MongoDB is using the correct database name:

   ```bash
   # Should be 'voiceybill' by default
   echo $MONGO_DB_NAME
   ```

3. Clear the database and try again:
   ```bash
   npm run seed:wipe
   npm run seed
   ```

### TypeScript build errors

1. Check for type errors:

   ```bash
   npm run build
   ```

2. If there are errors, they are usually in specific files. Fix them or open an issue with the full error output.

### Env variables not being read

1. Verify `.env` file exists and has the required variables:

   ```bash
   cat .env | grep MONGO_URI
   ```

2. Restart the server:

   ```bash
   npm run dev
   ```

3. If variables still not showing, check that they are not commented out or missing in `.env`.
