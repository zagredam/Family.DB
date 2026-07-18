# Family.API — Project Guide

## Migrations

SQL migration scripts live in `migrations/` at the repo root. Each file is named `NNN_description.sql` and must be run once against a database to bring it up to date. The app does **not** auto-apply migrations — run them manually via `sqlite3 <db-file> < migrations/NNN_....sql`.

| # | File | Change |
|---|------|--------|
| 001 | `001_add_relationship_type_to_family_couple.sql` | Adds `RelationshipType TEXT NOT NULL DEFAULT 'Partner'` to `FamilyCouple` |
| 002 | `002_add_family_member_attachment.sql` | Creates `FamilyMemberAttachment` table |
| 003 | `003_deprecate_familymember_coupleid.sql` | Backfills orphan couples into `FamilyCouple`, then drops `FamilyMember.CoupleId` (requires SQLite 3.35+) |
| 004 | `004_add_family_member_timeline.sql` | Creates `FamilyMemberTimeline` table |
| 005 | `005_add_family_access_tokens.sql` | Creates `FamilyAccessTokens` table (API auth). The API also auto-creates it at startup |

---

## Repository Layout

```
Family.API/
├── family.api/          # Express REST API (Node.js, sqlite3)
│   ├── index.js         # Server entry point + all routes — port from config (3001)
│   ├── config.json      # FamilyDBFile path, port, JWT settings, S3 settings
│   ├── scripts/
│   │   └── create-db.js # Interactive first-run setup (creates DB + admin token)
│   └── services/
│       ├── configService.js  # Loads/saves config.json; generates JwtSecret on first boot
│       ├── dbService.js      # Promisified sqlite3 (all/get/run) + write listeners
│       ├── authService.js    # Secret hashing, JWT login/refresh, auth middleware
│       ├── familyService.js  # All family CRUD (mirrors SqliteService.ts)
│       ├── tokenService.js   # FamilyAccessTokens CRUD (create/rotate/soft-delete)
│       └── s3Service.js      # Optional S3 mirror of the DB file
└── family.web/          # React SPA (Vite, TypeScript, ReactFlow)
    ├── src/
    │   ├── main.tsx
    │   ├── SplashPage.tsx       # Entry screen — load local .db or connect to API
    │   ├── TreeWrapper.tsx      # Data orchestration layer
    │   ├── FamilyTree.tsx       # ReactFlow tree renderer
    │   ├── EditMemberModal.tsx  # Edit member + couple management
    │   ├── AddMemberModal.tsx   # Add new member
    │   ├── Navbar.tsx
    │   ├── SqliteService.ts     # All sql.js DB operations
    │   ├── dataTypes.ts
    │   ├── tree/                # Tree layout engine
    │   │   ├── types.ts
    │   │   ├── buildDataStructure.ts
    │   │   ├── buildEdges.ts
    │   │   ├── positionNodes.ts
    │   │   ├── constants.ts
    │   │   └── utils.ts
    │   └── FamilyComponents/
    │       ├── FamilyMemberNode.tsx
    │       ├── CoupleEdge.tsx
    │       └── InnerFamilyEdge.tsx
    └── familytree - default.db  # Blank SQLite template — defines schema only
```

## Two Data Source Modes

| Mode | Description |
|------|-------------|
| `sqlite` | User loads a `.db` file locally; all reads/writes go through `SqliteService.ts` via sql.js (WASM). Changes are persisted to `localStorage` and downloadable. |
| `api` | Logs into the Express API with an access token (`ApiClient.login`). Full CRUD when the token has write rights; read-only otherwise. Admin tokens can manage access tokens from the UI. |

The active mode is determined by `DataSource` in `dataTypes.ts` and flows through `TreeWrapper.tsx`. Both modes are wrapped by the `FamilyDataClient` interface (`dataClient.ts`) — `createSqliteDataClient(db)` / `createApiDataClient(apiClient)` — so `TreeWrapper` and `EditMemberModal` are source-agnostic. API sessions (JWT + refresh token) persist in `localStorage` (`family_api_session`) and auto-refresh on 401.

---

## Database Schema

Reference file: `family.web/familytree - default.db`

### `FamilyMember`
```sql
CREATE TABLE FamilyMember (
    FamilyMemberId  INTEGER PRIMARY KEY AUTOINCREMENT UNIQUE,
    FirstName       TEXT,
    MiddleName      TEXT,
    LastName        TEXT,
    BirthDate       TEXT,
    DeceasedDate    TEXT,
    Gender          TEXT,          -- "Male" | "Female"
    OriginCoupleId  INTEGER,       -- FK → FamilyCouple.CoupleId (parents' couple)
    Description     TEXT
);
```
> **Note:** `CoupleId` was removed from `FamilyMember` (migration 003). The active couple is now derived by joining `FamilyCouple` on `ParterFamilyMemberId` or `OtherPartnerFamilyMemberId`.

### `FamilyCouple`
```sql
CREATE TABLE FamilyCouple (
    CoupleId                    INTEGER PRIMARY KEY AUTOINCREMENT,
    ParterFamilyMemberId        INTEGER,
    OtherPartnerFamilyMemberId  INTEGER,
    StartDate                   TEXT,
    EndDate                     TEXT,
    RelationshipType            TEXT NOT NULL DEFAULT 'Partner'  -- migration 001
);
```
Valid `RelationshipType` values (enforced in app, not DB): `Partner`, `Common-Law Partner`, `Have shared kids`, `Divorcee`. These map directly to `CoupleRelationshipType` in `tree/types.ts` and control edge rendering (solid vs dashed).

> **Note:** `FamilyCouple` is now written by `setCoupleAssociation` and deleted by `removeCoupleAssociation`. The `FamilyMember.CoupleId` field remains the join key used by the tree layout engine. `StartDate`/`EndDate` exist in the schema but are not yet surfaced in the UI.

### `FamilyGroup`
```sql
CREATE TABLE FamilyGroup (
    FamilyGroupId  INTEGER PRIMARY KEY AUTOINCREMENT UNIQUE,
    FamilyName     TEXT NOT NULL,
    FamilyHeadId   INTEGER        -- FK → FamilyMember.FamilyMemberId (root node)
);
```

### `FamilyGroupAssociation`
```sql
CREATE TABLE FamilyGroupAssociation (
    FamilyGroupId   INTEGER NOT NULL,
    FamilyMemberId  INTEGER NOT NULL
);
```
Members can belong to multiple family groups. The primary group is loaded by `selectedFamily` (currently hardcoded to `1`). A second group association surfaces as a "More" badge on the node.

### `FamilyAccessTokens` (migration 005 — API only)
```sql
CREATE TABLE FamilyAccessTokens (
    TokenId              INTEGER PRIMARY KEY AUTOINCREMENT,
    Name                 TEXT NOT NULL,
    TokenSecret          TEXT NOT NULL,   -- "<salt>$<sha256(salt+secret) hex>", never plaintext
    IsAdmin              INTEGER NOT NULL DEFAULT 0,
    HasWriteRights       INTEGER NOT NULL DEFAULT 0,
    Expires              TEXT,            -- ISO datetime or NULL (never expires)
    FamilyIdGroupRights  TEXT,            -- comma-separated FamilyGroupIds; NULL/''/'*' = all
    IsDeleted            INTEGER NOT NULL DEFAULT 0  -- soft delete = revocation
);
```
Secrets are generated by the API (`POST /tokens`, `POST /tokens/:id/rotate`) or by `scripts/create-db.js`, returned in plaintext exactly once. Admins imply write rights. Revoking (soft-deleting) a token also kills its refresh-token chain because `/auth/refresh` re-checks the row.

---

## Couple Association Logic

Partners are linked via a `FamilyCouple` row where the member appears as either `ParterFamilyMemberId` or `OtherPartnerFamilyMemberId`. `queryFamily` derives `CoupleId` from this join.  
Children reference their parents via `OriginCoupleId` on `FamilyMember` (equal to the parents' `FamilyCouple.CoupleId`).

```
FamilyCouple(CoupleId=5, Partner=A, OtherPartner=B)
  Parent A ──┐
             ├── Child (OriginCoupleId=5)
  Parent B ──┘
```

### Current `SqliteService.ts` operations

| Function | Description |
|----------|-------------|
| `setCoupleAssociation(db, memberId, partnerId)` | Links two members as a couple. Updates the existing `FamilyCouple` row if either is already in one; otherwise inserts a new row (AUTOINCREMENT ID). |
| `removeCoupleAssociation(db, memberId)` | Deletes the `FamilyCouple` row(s) where the member appears. Does **not** touch `OriginCoupleId` on children — parent-child links survive. |

---

## Relation Types Rendered as Couple Edges

The following `RelationTypes` are treated as couple connections (see `tree/utils.ts → isRelationSharingKids`):

- `"Partner"` — solid edge
- `"Common-Law Partner"` — dashed edge
- `"Have shared kids"` — dashed edge
- `"Divorcee"` — dashed edge

---

## API Server (`family.api`)

- **Config:** `config.json` — `FamilyDBFile` (path to the SQLite file, relative to `family.api/`), `Port` (3001), `Auth` (JWT secret auto-generated and persisted on first boot; access/refresh lifetimes), `S3` (optional mirror).
- **First run:** `npm run create-db` — prompts for the initial family name (+ optional file path / admin token name), creates the DB file with the full schema, seeds an admin access token (secret printed once), and points `config.json.FamilyDBFile` at the new file. Start with `npm start`.
- **Auth flow:** `POST /auth/login { token }` → `{ accessToken, refreshToken, isAdmin, hasWriteRights, … }`. Access JWTs are short-lived; `POST /auth/refresh { refreshToken }` issues a new pair (re-validating the token row, so revocation/expiry/flag changes take effect). All other endpoints require `Authorization: Bearer <accessToken>`; expired ones 401 with `code: "TOKEN_EXPIRED"`.
- **Permissions:** writes require `HasWriteRights` (or admin); `/tokens*` requires `IsAdmin`; `FamilyIdGroupRights` restricts which family groups (and, via `FamilyGroupAssociation`, which members) a token can read/write.
- **S3:** when `S3.Enabled`, the DB file is downloaded from the bucket at startup and re-uploaded (debounced) after every write, so the durable copy lives in S3.
- **Endpoints:**
  - Auth: `POST /auth/login`, `POST /auth/refresh`, `GET /auth/me`
  - Family: `GET /family?familyGroupId=N` → `{ FamilyMembers, WritePermission }`; `GET /family/options` → `{ FamilyGroups, WritePermission }` (filtered by group rights)
  - Groups: `POST /family/groups`, `PUT /family/groups/:id`
  - Members: `POST /members` (body incl. `familyGroupId`), `PUT /members/:id`, `GET/POST/DELETE /members/:id/groups[/:groupId]`
  - Couples: `GET /couples`, `POST /couples { memberId, partnerId, relationshipType }`, `DELETE /couples/member/:memberId`
  - Attachments: `GET/POST /members/:id/attachments`, `PUT/DELETE /attachments/:id`
  - Timeline: `GET/POST /members/:id/timeline`, `PUT/DELETE /timeline/:id` (soft delete)
  - Tokens (admin): `GET /tokens`, `POST /tokens` (returns plaintext secret once), `PUT /tokens/:id`, `POST /tokens/:id/rotate`, `DELETE /tokens/:id` (soft delete)

---

## Key Conventions

- Double-clicking a node opens `EditMemberModal` (read-only unless editing is enabled and the source is writable).
- In API mode, admins get a &#128273; Tokens navbar button opening `TokenAdminPage`: create/edit/rotate/revoke tokens; new secrets are shown once with a QR code + auto-login link (`#connect?url=…&token=…`) that logs the scanner in automatically.
- The modal has two sections: **member fields** (name, gender, dates, description) and **couple management** (assign/remove partner).
- After any DB write, `saveDbToLocalStorage` is called and `loadFamily` re-fetches to re-render.
- Tree layout is purely computed — no layout is persisted. ReactFlow handles pan/zoom state only.
- `BirthDate` is in the schema but not yet surfaced in the UI (subtitles currently show hardcoded `"Born XXXX"`).

---

## Schema Change Log

| Date | Change | File(s) Affected |
|------|--------|-----------------|
| 2026-05-04 | Documented initial schema from `familytree - default.db`; noted `FamilyCouple` table exists but is unused | `CLAUDE.md` |
| 2026-05-04 | Added `setCoupleAssociation` / `removeCoupleAssociation` operating on `FamilyMember.CoupleId` | `SqliteService.ts` |
| 2026-05-04 | `EditMemberModal` gains couple section: partner display, assign dropdown, remove button | `EditMemberModal.tsx`, `EditMemberModal.css` |
| 2026-05-04 | Added `RelationshipType TEXT NOT NULL DEFAULT 'Partner'` to `FamilyCouple` — see `migrations/001_add_relationship_type_to_family_couple.sql` | `FamilyCouple` table |
| 2026-05-04 | `setCoupleAssociation` now writes a `FamilyCouple` record (`INSERT OR REPLACE`) with `RelationshipType`; `removeCoupleAssociation` now also `DELETE`s the `FamilyCouple` row; `queryFamily` LEFT JOINs `FamilyCouple` and returns `CoupleRelationshipType` | `SqliteService.ts` |
| 2026-05-04 | Added `CoupleRelationshipType` union type (`"Partner" \| "Common-Law Partner" \| "Have shared kids" \| "Divorcee"`) | `tree/types.ts` |
| 2026-05-04 | `FamilyMemberRow` gains `CoupleRelationshipType` field; `buildRawFromApiData` uses it instead of hardcoded `"Partner"`; `handleAssignCouple` forwards the type to `setCoupleAssociation` | `TreeWrapper.tsx` |
| 2026-05-04 | Couple section in edit modal gains relationship-type dropdown; partner select pre-fills with current partner; Assign button shows "Update" when re-assigning the same partner | `EditMemberModal.tsx` |
| 2026-05-04 | Added `createNewDatabase(familyName)` (creates all tables + first FamilyGroup in memory); `addFamilyGroup(db, name)` returns new ID; `addFamilyMember` now auto-sets `FamilyHeadId` if the group has none | `SqliteService.ts` |
| 2026-05-04 | SplashPage gains "New File" inline form (family name → `onNewSqlite` callback); `main.tsx` wires `createNewDatabase` | `SplashPage.tsx`, `main.tsx` |
| 2026-05-04 | Navbar title shows `[FamilyName] Family`; chyron pill opens dropdown listing other groups (click to switch) + inline "Add family group" form | `Navbar.tsx`, `Navbar.css` |
| 2026-05-04 | `selectedFamily` is now nullable mutable state synced from `familyOptions`; family-switch / add-group handlers added; empty-state rendered with "+ Add Member" prompt when no root member exists | `TreeWrapper.tsx` |
| 2026-07-11 | Added `FamilyAccessTokens` table — see `migrations/005_add_family_access_tokens.sql`; API auto-creates it at startup | `FamilyAccessTokens` table |
| 2026-07-11 | Rewrote the API: config-driven DB path (`config.json.FamilyDBFile`), JWT login/refresh (`/auth/*`), permission middleware (write rights, admin, per-group rights), full CRUD endpoints mirroring `SqliteService.ts`, admin token CRUD (`/tokens*`), optional S3 mirror of the DB file | `family.api/index.js`, `family.api/services/*`, `family.api/config.json` |
| 2026-07-11 | Added interactive first-run setup script (`npm run create-db`): creates the DB file, seeds the first FamilyGroup + admin token, updates `config.json` | `family.api/scripts/create-db.js` |
| 2026-07-11 | Frontend API mode: token login on SplashPage, JWT session persistence + auto-refresh (`ApiService.ts`), full editing over the API via the new `FamilyDataClient` abstraction (`dataClient.ts`), shared row types moved to `dataTypes.ts` | `ApiService.ts`, `dataClient.ts`, `dataTypes.ts`, `main.tsx`, `SplashPage.tsx`, `TreeWrapper.tsx`, `EditMemberModal.tsx`, `Navbar.tsx` |
| 2026-07-11 | Added `TokenAdminPage` (API mode, admin only): list/create/edit/rotate/revoke access tokens; one-time secret display with QR code and `#connect?url=…&token=…` auto-login link handled in `main.tsx` | `TokenAdminPage.tsx`, `TokenAdminPage.css`, `Navbar.tsx`, `main.tsx` |
