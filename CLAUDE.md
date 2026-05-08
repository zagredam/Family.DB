# Family.API — Project Guide

## Migrations

SQL migration scripts live in `migrations/` at the repo root. Each file is named `NNN_description.sql` and must be run once against a database to bring it up to date. The app does **not** auto-apply migrations — run them manually via `sqlite3 <db-file> < migrations/NNN_....sql`.

| # | File | Change |
|---|------|--------|
| 001 | `001_add_relationship_type_to_family_couple.sql` | Adds `RelationshipType TEXT NOT NULL DEFAULT 'Partner'` to `FamilyCouple` |
| 002 | `002_add_family_member_attachment.sql` | Creates `FamilyMemberAttachment` table |
| 003 | `003_deprecate_familymember_coupleid.sql` | Backfills orphan couples into `FamilyCouple`, then drops `FamilyMember.CoupleId` (requires SQLite 3.35+) |
| 004 | `004_add_family_member_timeline.sql` | Creates `FamilyMemberTimeline` table |
| 005 | `005_add_attachment_fields.sql` | Adds `IsProfilePicture`, `TimelineId`, `IsS3` to `FamilyMemberAttachment` |
| 006 | `006_add_family_timeline_tag.sql` | Creates `FamilyTimelineTag` table |
| 007 | `007_add_s3_config.sql` | Creates `S3Config` table |
| 008 | `008_add_s3_config_prefix.sql` | Adds `Prefix TEXT` to `S3Config` |

---

## Repository Layout

```
Family.API/
├── family.api/          # Express REST API (Node.js, sqlite3)
│   ├── index.js         # Server entry point — port 3001
│   └── services/
│       └── authService.js  # JWT-style token validation (currently commented out)
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
    │   ├── S3Service.ts         # AWS Sig V4 signing, S3 upload, presigned URL generation
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
| `api` | Connects to the Express API at a URL; read-only from the frontend. |

The active mode is determined by `DataSource` in `dataTypes.ts` and flows through `TreeWrapper.tsx`.

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

### `FamilyMemberAttachment` (migration 002, extended by migration 005)
```sql
CREATE TABLE FamilyMemberAttachment (
    AttachmentId      INTEGER PRIMARY KEY AUTOINCREMENT,
    FamilyMemberId    INTEGER NOT NULL,
    Label             TEXT NOT NULL,
    Url               TEXT NOT NULL,        -- full URL for links; S3 key for uploads
    IsProfilePicture  INTEGER NOT NULL DEFAULT 0,  -- 1 = profile picture (max one per member)
    TimelineId        INTEGER,              -- FK → FamilyMemberTimeline.TimelineId (nullable)
    IsS3              INTEGER NOT NULL DEFAULT 0   -- 1 = Url is an S3 object key
);
```
- `setProfilePicture(db, memberId, attachmentId)` clears all others then sets the chosen one.
- If `IsS3=1`, the stored `Url` is a relative S3 key. The frontend fetches a presigned GET URL via `S3Service.getSignedUrl` when the member modal opens.
- Profile pictures with `IsS3=0` are surfaced as `imageUrl` on tree nodes. S3-backed profile pictures are only shown inside the member modal (presigned URL is async).

### `FamilyTimelineTag` (migration 006)
```sql
CREATE TABLE FamilyTimelineTag (
    TagId          INTEGER PRIMARY KEY AUTOINCREMENT,
    TimelineId     INTEGER NOT NULL,    -- FK → FamilyMemberTimeline.TimelineId
    FamilyMemberId INTEGER NOT NULL     -- FK → FamilyMember.FamilyMemberId
);
```
Allows tagging multiple family members to a single timeline event. UI in the Timeline tab shows chips per event with add/remove controls.

### `S3Config` (migration 007)
```sql
CREATE TABLE S3Config (
    S3ConfigId  INTEGER PRIMARY KEY DEFAULT 1,  -- single-row sentinel
    Endpoint    TEXT NOT NULL,   -- e.g. https://s3.us-east-1.amazonaws.com
    BucketName  TEXT NOT NULL,
    AccessKey   TEXT NOT NULL,
    SecretKey   TEXT NOT NULL,
    Region      TEXT NOT NULL DEFAULT 'us-east-1',
    Prefix      TEXT                               -- optional key prefix, e.g. "family-db/photos"
);
```
Stored per-database. Accessed via `getS3Config(db)` / `saveS3Config(db, config)` in `SqliteService.ts`. Editing is via the S3 settings button (☁) in the navbar right section, which opens a modal.

`Prefix` is prepended to every object key on upload (e.g. prefix `my-family` → key `my-family/attachments/1234-photo.jpg`). Useful for sharing a bucket across multiple databases or providers that require a path namespace.

---

## S3 Storage (`S3Service.ts`)

Browser-native AWS Signature V4 implementation using the Web Crypto API — no external SDK required.

| Function | Description |
|----------|-------------|
| `uploadToS3(config, file, prefix?)` | Generates a presigned PUT URL, uploads the file, returns the S3 object key |
| `getSignedUrl(config, key, expiresIn?)` | Generates a presigned GET URL (default: 1 hour) |
| `isImageKey(urlOrKey)` | Returns `true` if the URL/key ends with an image extension |

**CORS requirement:** The S3 bucket must allow PUT/GET from the app's origin. Configure bucket CORS before using upload.

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

- **Port:** 3001
- **Auth:** Token validation middleware exists (`authService.js`) but is currently **commented out**.
- **DB path:** Hardcoded to `X:/familytree.db` — must be updated for local dev.
- **Endpoints:**
  - `GET /family?familyGroupId=N` → returns `{ FamilyMembers: [...] }`
  - `GET /family/options` → returns array of `FamilyGroup` rows

---

## Key Conventions

- Double-clicking a node in sqlite mode opens `EditMemberModal`.
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
| 2026-05-08 | `FamilyMemberAttachment` gains `IsProfilePicture`, `TimelineId`, `IsS3` columns (migration 005); `setProfilePicture`/`clearProfilePicture` added to `SqliteService.ts`; `queryAttachments` returns new columns with graceful fallback | `SqliteService.ts`, `migrations/005_add_attachment_fields.sql` |
| 2026-05-08 | Created `FamilyTimelineTag` table (migration 006); `queryTimelineTagsForMember`, `addTimelineTag`, `removeTimelineTag` added; Timeline tab shows tagged-member chips with add/remove | `SqliteService.ts`, `EditMemberModal.tsx`, `migrations/006_add_family_timeline_tag.sql` |
| 2026-05-08 | Created `S3Config` table (migration 007); `getS3Config`/`saveS3Config` added; S3 settings button + modal added to Navbar | `SqliteService.ts`, `Navbar.tsx`, `migrations/007_add_s3_config.sql` |
| 2026-05-08 | Created `S3Service.ts`: browser-native AWS Sig V4 signing, `uploadToS3`, `getSignedUrl`, `isImageKey` | `S3Service.ts` |
| 2026-05-08 | Attachments tab: Link/Upload mode toggle when S3 configured; profile picture star button; image viewer lightbox for image attachments (opens signed URL); timeline-event linkage dropdown | `EditMemberModal.tsx`, `EditMemberModal.css` |
| 2026-05-08 | `queryFamily` now includes `ProfilePictureUrl` subquery (falls back to old query on older DBs); `buildRawFromApiData` passes direct-URL profile pictures as `imageUrl` on tree nodes | `SqliteService.ts`, `TreeWrapper.tsx` |
| 2026-05-08 | `TreeWrapper` loads/saves `S3Config`; passes it to `Navbar` (for settings modal) and `EditMemberModal` (for signed URLs + upload); `onDataChange` now also calls `loadFamily` to refresh tree nodes | `TreeWrapper.tsx` |
