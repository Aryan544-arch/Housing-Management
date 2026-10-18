# Housing Management System — Backend & API Documentation

## 1. Project Architecture & Prerequisites

### Architecture Overview
The Housing Management Portal is an enterprise-grade, multi-tenant society issue management system built on a secure Model-View-Controller (MVC) architecture with dedicated service-layer adapters:

- **Runtime & Framework**: Node.js (`>= 18.0.0`, tested on `v24.20.0`), Express 5.3 (`express`).
- **Database & ODM**: MongoDB Server (`>= 6.0`, tested on `v9.0.2`), Mongoose 9.1 (`mongoose`) with schema validation and optimistic concurrency control (`__v`).
- **Templating & UI**: Server-rendered EJS 7.0 (`ejs`) with vanilla JavaScript DOM controllers and responsive CSS custom properties.
- **Authentication**: Stateless JSON Web Tokens (`jsonwebtoken`) transmitted inside `HttpOnly` secure cookies with token versioning for instant revocation.
- **Security Middleware**: `helmet` (strict Content Security Policy), `cookie-parser`, `express-rate-limit`, and a custom cryptographic CSRF double-submit token module (`crypto`).
- **Service Layer**:
  - `services/evidence/evidenceStorageService.js`: Private filesystem evidence vault with magic-number MIME validation.
  - `services/notifications/notificationService.js`: In-app notification engine with compound idempotency deduplication.
  - `services/notifications/emailAdapter.js`: Replaceable email delivery adapter (Mock / SMTP stub).
  - `services/ai/aiAdvisoryService.js`: Hardened advisory service with prompt injection defense and strict schema validation.
  - `services/ai/gemmaAdapter.js`: Replaceable Gemma / LLM HTTP adapter with timeout guards.

### Prerequisites
1. **Node.js**: `v18.0.0` or higher (`v24.x` recommended).
2. **npm**: `v9.x` or higher (`v11.x` recommended).
3. **MongoDB**: Local or remote MongoDB server running on `mongodb://127.0.0.1:27017` (listening and accepting TCP connections).

---

## 2. Local Setup and Startup Instructions

### Installation
Clone the repository and install root dependencies:
```bash
npm install
```

### Environment Configuration
Copy `.env.example` to `.env` in the project root:
```bash
cp .env.example .env
```
Ensure `MONGODB_URI` points to your active database instance and set `JWT_SECRET` to a random string of at least 32 characters in production.

### Running the Application
- **Production / Standard Mode**:
  ```bash
  npm start
  ```
  Starts `server.js` using Node.js. Server connects to MongoDB prior to binding the HTTP listener.
- **Development Mode** (with automatic restart):
  ```bash
  npm run dev
  ```
  Starts `server.js` using `nodemon`.
- **Test Suite Execution**:
  ```bash
  npm test
  ```
  Runs the automated test suite using the Node.js native test runner (`node --test`).

Default local URL: `http://localhost:3000`

---

## 3. Environment Variables Reference

All environment variables are configured in `.env` (referencing `.env.example` placeholders):

| Variable | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `PORT` | Number | `3000` | HTTP listening port. |
| `NODE_ENV` | String | `development` | Environment mode (`development`, `production`, `test`). In production, stack traces are withheld and secure cookies are enforced. |
| `MONGODB_URI` | String | `mongodb://127.0.0.1:27017/housing_management` | MongoDB connection URI. |
| `JWT_SECRET` | String | *Placeholder* | Secret key for HMAC-SHA256 JWT signing. **Must be at least 32 characters in production**. |
| `CSRF_SECRET` | String | *Fallback to JWT_SECRET* | Secret key for signing CSRF double-submit cookies. |
| `AI_ADVISORY_ENABLED`| Boolean | `false` | Global toggle for AI advisory module. |
| `AI_PROVIDER` | String | `gemma` | Selected AI provider adapter (`gemma`, `mock`). |
| `GEMMA_API_URL` | String | `https://api.example.com/v1/chat/completions` | HTTP endpoint for Gemma-compatible inference service. |
| `GEMMA_API_KEY` | String | *Placeholder* | API authorization token for remote model endpoint. |
| `GEMMA_MODEL` | String | `gemma-2-9b-it` | Model identifier string. |
| `AI_TIMEOUT_MS` | Number | `10000` | Max milliseconds before AI advisory request times out (502). |
| `NOTIFICATION_ENABLED` | Boolean | `true` | Toggle for in-app lifecycle notifications. |
| `EMAIL_ENABLED` | Boolean | `false` | Toggle for outbound email notifications. |
| `EMAIL_PROVIDER` | String | `mock` | Outbound email provider (`mock`, `smtp`). |
| `EMAIL_FROM` | String | `noreply@housing.local` | From-header address for outbound notifications. |
| `SMTP_HOST` | String | `""` | Outbound SMTP server hostname. |
| `SMTP_PORT` | Number | `587` | Outbound SMTP port. |
| `SMTP_USER` | String | `""` | Outbound SMTP authentication username. |
| `SMTP_PASS` | String | `""` | Outbound SMTP authentication password. |
| `SMTP_SECURE` | Boolean | `false` | TLS wrapper toggle for SMTP port 465 vs 587. |
| `EVIDENCE_STORAGE_DIR` | String | `private/evidence` | Disk storage directory for private attachments. |
| `MAX_EVIDENCE_FILE_SIZE_BYTES` | Number | `5242880` | Maximum upload size (5 MB = 5,242,880 bytes). |
| `ALLOWED_EVIDENCE_MIME_TYPES` | String | `image/jpeg,image/png,image/webp,application/pdf` | Whitelisted MIME types for evidence attachments. |

---

## 4. Authentication, Cookies, CSRF & Tenancy

### Authentication Protocol
1. **Credential Verification**:
   - `POST /api/auth/login` verifies user email and compares plaintext candidate password against stored bcrypt hash (cost factor 10).
   - Deactivated accounts (`isActive: false`) are rejected immediately with `401 Unauthorized`.
2. **Token Issuance**:
   - Upon successful registration or login, an HMAC-SHA256 signed JWT is generated containing `{ userId, tokenVersion }`.
   - Token is attached to the HTTP response as an `HttpOnly` cookie named `token`:
     - `httpOnly: true` (prevents JavaScript DOM access / XSS theft).
     - `secure: true` in production (forces HTTPS transport).
     - `sameSite: 'strict'` in production (`'lax'` in development).
     - `path: '/'`, `maxAge: 86400000` (24 hours).
   - Fallback: `Authorization: Bearer <token>` header is supported for headless API clients.
3. **Session Revocation**:
   - `POST /api/auth/logout` clears the `token` cookie and atomically increments `tokenVersion` on the `User` document. Any previously signed tokens for that user immediately become invalid (`401 Session invalidated`).

### CSRF Protection Architecture
Custom cryptographic double-submit cookie implementation ([`middleware/csrf.js`](file:///C:/Users/Aryan/Housing-Management/middleware/csrf.js)):
- On safe methods (`GET`, `HEAD`, `OPTIONS`), a signed cookie `_csrf` is issued with value format `<rawToken>.<hmacSignature>`.
- Client scripts or EJS templates echo `<rawToken>` via the `X-CSRF-Token` request header or `_csrf` form field.
- On state-changing requests (`POST`, `PUT`, `PATCH`, `DELETE`):
  1. **Origin / Referer Verification**: Compares the `Origin` or `Referer` host against the `Host` header. Cross-origin mutations are rejected (`403 Forbidden`).
  2. **Signature Verification**: Verifies the HMAC-SHA256 signature of `_csrf` using `getCsrfSecret()`.
  3. **Timing-Safe Comparison**: Evaluates `crypto.timingSafeEqual()` between the client-submitted token and the validated raw token. Mismatches are rejected (`403 Forbidden`).
  4. Public authentication entrypoints (`/api/auth/login`, `/api/auth/register`) are exempt from token matching since unauthenticated visitors do not yet have an active authenticated session.

### Society Membership & Tenant Isolation
Multi-tenancy is enforced through the [`SocietyMembership`](file:///C:/Users/Aryan/Housing-Management/models/SocietyMembership.js) model:
- Every issue, provider, notification, and evidence item is permanently scoped to a `society` ObjectId.
- The `requireSocietyMember(allowedRoles)` middleware strictly verifies that `req.user` has an `active` membership record in the target `societyId` before granting access.
- Role permissions are validated directly against the database (`membership.role`), never trusting client-supplied role claims.
- **External service providers must never become application users**: Contractors are stored in the `Provider` directory and cannot hold `User` accounts or `SocietyMembership` records.

---

## 5. API Reference

All society-scoped endpoints are prefixed with `/api/societies/:societyId`.

### A. Health & System
| Method | Endpoint | Access | Description | Success Response |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/health` | Public | System status and database readiness. | `200 OK` `{ status: "ok", timestamp, uptime, environment, database: "connected" }` |

### B. Authentication (`/api/auth`)
| Method | Endpoint | Access | Body Parameters | Success Response |
| :--- | :--- | :--- | :--- | :--- |
| `POST` | `/api/auth/register` | Public | `name`, `email`, `password` (min 8 chars), `phone` (optional) | `201 Created` `{ success: true, message, user }` (sets `token` cookie) |
| `POST` | `/api/auth/login` | Public | `email`, `password` | `200 OK` `{ success: true, message, user }` (sets `token` cookie) |
| `POST` | `/api/auth/logout` | Authenticated | None | `200 OK` `{ success: true, message }` (clears cookie) |
| `GET` | `/api/auth/me` | Authenticated | None | `200 OK` `{ success: true, user, memberships }` |

### C. Society Management (`/api/societies`)
| Method | Endpoint | Access | Body / Query Parameters | Success Response |
| :--- | :--- | :--- | :--- | :--- |
| `POST` | `/api/societies` | Authenticated | `name` (>=2 chars), `code` (3-20 chars alphanumeric), `address` (optional) | `201 Created` `{ success: true, society, membership }` (Creator auto-assigned as admin) |
| `GET` | `/api/societies/:societyId` | Active Member | None | `200 OK` `{ success: true, society, currentRole, flatNumber }` |
| `GET` | `/api/societies/:societyId/members` | Active Member | None | `200 OK` `{ success: true, societyId, count, members: [...] }` |
| `POST` | `/api/societies/:societyId/members` | Society Admin | `email`, `role` (`"resident"` \| `"admin"`), `flatNumber` (optional) | `201 Created` `{ success: true, message, membership }` |
| `GET` | `/api/societies/:societyId/protected-data` | Active Member | None | `200 OK` `{ success: true, societyId, societyName, requesterRole }` |
| `POST` | `/api/societies/:societyId/admin-action` | Society Admin | None | `200 OK` `{ success: true, message, societyId, requesterRole }` |

### D. Issues Management (`/api/societies/:societyId/issues`)
| Method | Endpoint | Access | Parameters | Success Response |
| :--- | :--- | :--- | :--- | :--- |
| `POST` | `/` | Active Member | Body: `title` (5-120 chars), `description` (10-2000 chars), `category`, `location` (`type`: `"unit"` \| `"common_area"`), `priority` (optional) | `201 Created` `{ success: true, message, issue }` |
| `GET` | `/` | Active Member | Query: `status`, `priority`, `category`, `myIssuesOnly` (`"true"`), `page` (optional int >= 1), `limit` (optional int 1-100) | `200 OK` Default: `{ success: true, count, issues: [...] }`. Paginated: `{ success: true, count, issues: [...], pagination: { total, page, limit, totalPages } }` |
| `GET` | `/:issueId` | Active Member | Path: `issueId`. *Privacy Rule: Non-submitters receive 404 for private unit issues.* | `200 OK` `{ success: true, issue }` |
| `PATCH`| `/:issueId/status` | Submitter or Admin | Body: `toStatus`, `note`, `scheduledDate` (required if scheduled), `cancellationReason` (required if cancelled), `costs` (optional), `completionDetails` (optional) | `200 OK` `{ success: true, message, issue }` |
| `PATCH`| `/:issueId` | Submitter or Admin | Body: Submitter allowed: `title`, `description`, `category`. Admin allowed: all editable fields + `externalProviderDetails`. | `200 OK` `{ success: true, message, issue }` |
| `POST` | `/:issueId/notes` | Active Member | Body: `note` (1-2000 chars), `isInternal` (boolean, admin-only). | `201 Created` `{ success: true, message, issue }` |
| `POST` | `/:issueId/progress`| Society Admin | Body: `note` (2-1000 chars), `progressPercentage` (0-100), `isInternal` (boolean). | `201 Created` `{ success: true, message, issue }` |
| `POST` | `/:issueId/evidence`| Active Member | Multipart form: `file` (binary), `caption` (optional), `context` (`"issue"` \| `"repair_completion"`), `isInternal` (admin-only). | `201 Created` `{ success: true, message, evidence, issue }` |
| `GET` | `/:issueId/evidence/:evidenceId` | Active Member | Path: `issueId`, `evidenceId`. *Internal evidence returns 404 to residents.* | `200 OK` Binary stream with security headers (`nosniff`, CSP `'none'`). |
| `GET` | `/:issueId/provider-suggestions` | Society Admin | Path: `issueId`. | `200 OK` `{ success: true, issueId, count, suggestions: [...] }` |
| `POST` | `/:issueId/ai-advisory` | Active Member | Path: `issueId`. Rate limited: 30 req/15min. | `200 OK` `{ success: true, advisory, notice, disclaimer }` |
| `POST` | `/:issueId/analyze` | Active Member | Alias for `ai-advisory`. | `200 OK` `{ success: true, advisory, notice, disclaimer }` |

### E. Provider Directory (`/api/societies/:societyId/providers`)
All provider routes require **Society Admin** role.
| Method | Endpoint | Parameters | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/` | Body: `name`, `categories`, `contactPhone`, `contactEmail`, `contactPerson`, `serviceArea`, `pricing`, `status` | Register new contractor in directory. |
| `GET` | `/` | Query: `category`, `status`, `search` | List society providers. |
| `GET` | `/:providerId` | Path: `providerId` | Retrieve provider details. |
| `PATCH`| `/:providerId` | Body: Updated provider fields | Update provider details or rate structure. |
| `DELETE`| `/:providerId` | Query: `permanent=true` (optional) | Deactivates provider if referenced by issues; permanently removes only if unreferenced. |
| `GET` | `/suggestions/:issueId` | Path: `issueId` | Query criteria-matched active contractors for an issue. |

### F. Notifications (`/api/societies/:societyId/notifications`)
All notification routes require **Active Society Membership**.
| Method | Endpoint | Parameters | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/` | Query: `page` (default 1), `limit` (default 20, max 50), `read` (`"true"` \| `"false"`) | Paginated user notifications with `unreadCount`. |
| `PATCH`| `/:notificationId/read` | Path: `notificationId` | Mark specific notification as read (recipient ownership enforced). |
| `PATCH`| `/read-all` | None | Mark all notifications for user in society as read. |

---

## 6. Issue Lifecycle, Categories, Priorities & State Machine

### Allowed Categories
- `plumbing`
- `electrical`
- `carpentry`
- `security`
- `housekeeping`
- `elevator`
- `common_area`
- `structural`
- `other`

### Priorities
- `low`
- `normal` (default)
- `high`
- `urgent`

### Lifecycle Statuses (11 States)
1. `submitted`
2. `under_review`
3. `awaiting_information`
4. `provider_contact_pending`
5. `scheduled`
6. `in_progress`
7. `completion_submitted`
8. `verification_rejected`
9. `verified_closed`
10. `reopened`
11. `cancelled` (terminal state)

### State Machine Transition Matrix
| From Status | Permitted To Status | Authorized Roles |
| :--- | :--- | :--- |
| `submitted` | `under_review` | `admin` |
| `submitted` | `cancelled` | `admin`, `resident_submitter` |
| `under_review` | `awaiting_information` | `admin` |
| `under_review` | `provider_contact_pending` | `admin` |
| `under_review` | `scheduled` | `admin` (requires valid `scheduledDate`) |
| `under_review` | `in_progress` | `admin` |
| `under_review` | `cancelled` | `admin`, `resident_submitter` |
| `awaiting_information` | `under_review` | `admin`, `resident_submitter` |
| `awaiting_information` | `cancelled` | `admin`, `resident_submitter` |
| `provider_contact_pending` | `scheduled` | `admin` (requires valid `scheduledDate`) |
| `provider_contact_pending` | `in_progress` | `admin` |
| `provider_contact_pending` | `cancelled` | `admin` |
| `scheduled` | `in_progress` | `admin` |
| `scheduled` | `scheduled` (reschedule) | `admin` (requires valid `scheduledDate`) |
| `scheduled` | `cancelled` | `admin` |
| `in_progress` | `completion_submitted` | `admin` (accepts `completionDetails` & `costs`) |
| `in_progress` | `awaiting_information` | `admin` (requires note) |
| `completion_submitted` | `verified_closed` | `admin` (**STRICT**: Residents forbidden) |
| `completion_submitted` | `verification_rejected` | `admin` (**STRICT**: Requires non-empty note) |
| `verification_rejected` | `in_progress` | `admin` |
| `verification_rejected` | `provider_contact_pending` | `admin` |
| `verified_closed` | `reopened` | `admin`, `resident_submitter` (requires reason note) |
| `reopened` | `under_review` | `admin` |
| `reopened` | `in_progress` | `admin` |
| `reopened` | `scheduled` | `admin` (requires valid `scheduledDate`) |
| `cancelled` | *None* | Terminal state; no transitions permitted |

### Concurrency Conflict Behavior
Both `Issue` and `Provider` schemas have `optimisticConcurrency: true` enabled via Mongoose.
- When two requests attempt to mutate an issue or provider document concurrently, Mongoose verifies that the document's internal version counter (`__v`) matches the database version.
- If a version collision occurs, Mongoose raises a `VersionError`.
- Centralized error handling catches `VersionError` and maps it to **`409 Conflict`**:
  ```json
  {
    "success": false,
    "message": "Conflict: The record was modified by another request. Please reload and try again."
  }
  ```
- File uploads that fail due to an OCC collision on issue save immediately delete the newly written disk file to avoid orphaned storage artifacts.

---

## 7. Provider Management, Progress, Costs & Verification

### Provider Management
- Stored in the `Provider` collection, strictly isolated by `society`.
- Suggestion matching algorithm ([`controllers/providerController.js`](file:///C:/Users/Aryan/Housing-Management/controllers/providerController.js)) inspects:
  1. `category`: Provider categories array must contain the issue category.
  2. `serviceArea`: For unit issues, verifies if `serviceArea.allBlocks` is true or if `serviceArea.blocks` includes the unit's block/wing. For common areas, checks coverage.
- All suggestion responses return `recommendationLevel: 'criteria_match'` and an explicit disclaimer that suggestions are criteria-based, not endorsements.

### Repair Costs Structure & Bounds
Repair costs are recorded in the `costs` subdocument:
- `materialCost`: Number (min 0, max 30,000,000 INR).
- `laborCost`: Number (min 0, max 30,000,000 INR).
- `otherCost`: Number (min 0, max 30,000,000 INR).
- `totalCost`: Server-computed as `materialCost + laborCost + otherCost`. Client-submitted total cost is strictly overridden by the server.
- `currency`: Default `'INR'`.
- **Privacy Rule**: Costs are strictly redacted from residents in `toClientJSON`.

### Verification Workflow
- When work is done, admin transitions issue to `completion_submitted`.
- **Human Verification Requirement**: Only a society admin can verify or reject completion. Resident attempts return `403 Forbidden`.
- Verification decisions are recorded in `verificationDetails`: `{ verifiedBy, verifiedAt, decision, notes }`.
- Rejection requires an explanatory note and transitions the issue to `verification_rejected`, enabling rework.

---

## 8. Notifications, Pagination & Ownership

### Delivery Guarantees & Deduplication
- In-app notifications are persisted to the `Notification` collection.
- Deduplication is guaranteed by a compound unique index: `{ recipient: 1, idempotencyKey: 1 }`.
- Idempotency key format: `${issue._id}:${event._id}:${recipient._id}:${event.action}`.
- Duplicate events trigger Mongo error 11000 and are safely handled as no-ops.
- Notifications are non-blocking: notification dispatch failures do not abort the parent issue transaction.

### Notification Pagination
- Supported on `GET /api/societies/:societyId/notifications`:
  - `page`: 1-based index (default `1`).
  - `limit`: Number of records (default `20`, maximum `50`).
  - `read`: Optional filter (`"true"` \| `"false"`).
- Response shape:
  ```json
  {
    "success": true,
    "notifications": [...],
    "unreadCount": 3,
    "pagination": {
      "total": 42,
      "page": 1,
      "limit": 20,
      "totalPages": 3
    }
  }
  ```

### Issue Listing Pagination (Optional & Backwards-Compatible)
Supported on `GET /api/societies/:societyId/issues`:
- **Unpaginated Mode (Default)**:
  - When both `page` and `limit` query parameters are omitted, returns all matching filtered issues:
    ```json
    {
      "success": true,
      "count": 42,
      "issues": [...]
    }
    ```
  - Preserves exact response contract for existing frontend consumers (`public/js/issues.js`), EJS dashboard rendering, and legacy tests without any breaking changes.
- **Paginated Mode (Opt-in)**:
  - Enabled when `page` or `limit` query parameters are supplied.
  - `page`: Positive integer (default `1` if omitted, minimum `1`). Rejects 0, negatives, floats, non-integers with `400 Bad Request`.
  - `limit`: Integer from `1` through `100` (default `20` if omitted). Rejects 0, negatives, values > 100, floats, non-integers with `400 Bad Request`.
  - Database-level `.skip()` and `.limit()` are utilized; does not load entire collection into memory.
  - Deterministic sort order with tie-breaker: `.sort({ createdAt: -1, _id: -1 })`.
  - Response shape:
    ```json
    {
      "success": true,
      "count": 20,
      "issues": [...],
      "pagination": {
        "total": 42,
        "page": 1,
        "limit": 20,
        "totalPages": 3
      }
    }
    ```
  - `total` represents total records matching all active filters before pagination.
  - `count` represents records returned on the current page (`issues.length`).
  - All existing filters (`status`, `priority`, `category`, `myIssuesOnly`) and security/privacy redactions apply identically in paginated mode.

### Ownership Restrictions
- Users can only query notifications where `recipient == req.user._id` and `society == req.society._id`.
- Marking a notification as read validates recipient ownership; unauthorized attempts return `404 Not Found`.

---

## 9. AI Advisory Service & Limitations

### Service Overview
The AI Advisory module provides read-only classification recommendations and missing-information checklists during issue triage.

### Security Invariants & Hardening
1. **Input Length Bounding**:
   - `title`: max 120 characters.
   - `description`: max 2000 characters.
   - Total user prompt length: max 4000 characters.
2. **Prompt Injection Neutralization**:
   - Issue content is encapsulated inside `<reported_issue>` delimiters.
   - Any malicious `</reported_issue>` tags in user text are neutralized to `[delimiter_neutralized]`.
   - System instructions explicitly instruct the model to treat all text within tags as untrusted data, never as directives.
3. **Strict Output Schema Enforcement**:
   - Model response must match allowed fields (`suggestedCategory`, `suggestedPriority`, `explanation`, `missingInformation`, `recommendedAction`).
   - Responses containing unexpected fields (e.g. `status`, `role`) are rejected with `502 Bad Gateway`.
   - Category and priority values are strictly validated against enums with safe fallbacks (`other`, `normal`).
4. **Read-Only Invariant**:
   - Advisory requests never update or mutate issue fields in the database.

### Disabled & Unavailable Behavior
- If `AI_ADVISORY_ENABLED=false`, the endpoint returns `200 OK` with a graceful notice:
  ```json
  {
    "success": true,
    "notice": "AI advisory service is currently disabled by administrator configuration.",
    "disclaimer": "This advisory is an automated recommendation and does not replace committee review.",
    "advisory": null
  }
  ```
- If the adapter encounters a network failure or times out (`AI_TIMEOUT_MS`), it returns `502 Bad Gateway` with a structured error message without leaking credentials or internal stack traces.

### Current Integration Limitation
In the current development environment, live network calls to external Gemma LLM endpoints are mocked or disabled by default (`AI_ADVISORY_ENABLED=false`).

---

## 10. Private Evidence Storage & Security

### Storage Configuration
- Stored on disk under `private/evidence/` (outside the public document root).
- Upload size limit: 5 MB (5,242,880 bytes).
- Whitelisted MIME types: `image/jpeg`, `image/png`, `image/webp`, `application/pdf`.

### Deep Content Validation
- Inspects magic bytes (file signature headers) of incoming buffers:
  - JPEG: `FF D8 FF`
  - PNG: `89 50 4E 47`
  - WebP: `52 49 46 46 ... 57 45 42 50`
  - PDF: `25 50 44 46` (`%PDF`)
- Files with mismatched extensions or disguised executables are rejected with `400 Bad Request`.

### Delivery Security
Evidence files are streamed via `GET /api/societies/:societyId/issues/:issueId/evidence/:evidenceId`:
- Enforces society membership and submitter ownership for private unit issues.
- `isInternal` evidence returns `404 Not Found` to residents.
- Streams with HTTP headers:
  - `Content-Type`: validated MIME type.
  - `X-Content-Type-Options: nosniff`.
  - `Content-Security-Policy: default-src 'none'`.
  - `Cache-Control: private, no-cache, no-store, must-revalidate`.
  - `Content-Disposition: inline; filename="sanitized_name"`.

---

## 11. Standard Error Responses and Status Codes

### Error Response Contract
All error responses strictly return a consistent JSON payload:
```json
{
  "success": false,
  "message": "Human-readable explanation of the error."
}
```
*Note*: In development mode (`NODE_ENV=development`), an optional `stack` property is included. In production, `stack` is strictly omitted.

### HTTP Status Codes
| Code | Name | Scenario |
| :--- | :--- | :--- |
| `200` | OK | Successful query or state mutation. |
| `201` | Created | Successful entity creation (user, society, issue, provider, note). |
| `302` | Found | Web UI redirect (e.g. unauthenticated redirect to `/login`). |
| `400` | Bad Request | Validation error, malformed ID format, illegal status transition, bad costs. |
| `401` | Unauthorized | Missing token, invalid/expired JWT, or revoked `tokenVersion`. |
| `403` | Forbidden | Insufficient role (resident accessing admin route), CSRF mismatch, cross-society access. |
| `404` | Not Found | Route or entity not found; also returned for private unit issues to prevent ID enumeration. |
| `409` | Conflict | Mongoose `VersionError` (OCC collision), duplicate email, duplicate society code. |
| `429` | Too Many Requests | Rate limit exceeded (global 200/15min, AI advisory 30/15min). |
| `500` | Internal Server Error | Unhandled server exception. |
| `502` | Bad Gateway | AI inference timeout, upstream model network failure, invalid model format. |

---

## 12. Test Execution & Integration Limitations

### Test Suite Execution
Run the full test suite from the repository root:
```bash
npm test
```
The test suite consists of 59 test suites covering 298 tests (on `main`) executed via native Node.js test runner (`node --test`), verifying database failover, health checks, authentication, state machines, provider directory, repair workflows, evidence streaming, notifications, web UI rendering, and headless security invariants.

### Current Integration Limitations
1. **Outbound Email**:
   - `SmtpEmailAdapter` is currently an architectural stub. Real SMTP delivery requires adding an external transport package (such as `nodemailer`) and configuring SMTP credentials. `MockEmailAdapter` is active by default.
2. **Live AI Inference**:
   - Remote Gemma inference requires network connectivity and an active API key (`AI_ADVISORY_ENABLED=true`, `GEMMA_API_KEY`). The offline test suite utilizes `MockAiAdapter`.
3. **Email Verification**:
   - As documented in the web UI route tests, email address verification is not currently an active backend capability; user registration immediately activates the account.
