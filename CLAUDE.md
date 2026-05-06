# Family.API — Project Guide

## Migrations

SQL migration scripts live in `migrations/` at the repo root. Each file is named `NNN_description.sql` and must be run once against a database to bring it up to date. The app does **not** auto-apply migrations — run them manually via `sqlite3 <db-file> < migrations/NNN_....sql`.

| # | File | Change |
|---|------|--------|
| 001 | `001_add_relationship_type_to_family_couple.sql` | Adds `RelationshipType TEXT NOT NULL DEFAULT 'Partner'` to `FamilyCouple` |
| 002 | `002_add_family_member_attachment.sql` | Creates `FamilyMemberAttachment` table |
| 003 | `003_deprecate_familymember_coupleid.sql` | Backfills orphan couples into `FamilyCouple`, then drops `FamilyMember.CoupleId` (requires SQLite 3.35+) |
| 004 | `004_add_family_member_timeline.sql` | Creates `FamilyMemberTimeline` table |

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
