# Family Tree

A family tree viewer and editor that runs entirely in the browser using a local SQLite database file.

## Overview

The app has two modes:

| Mode | Description |
|------|-------------|
| **Local file** | Load a `.db` file from your machine. All reads and writes happen in-browser via [sql.js](https://sql-wasm.netlify.app/) (WASM). Changes are saved to `localStorage` and can be exported as a new `.db` file. |
| **API** | Connect to a remote Express API. Currently read-only from the frontend. |

---

## Project Structure

```
Family.API/
├── family.api/     # Express REST API (Node.js + sqlite3) — port 3001
└── family.web/     # React SPA (Vite + TypeScript + ReactFlow)
```

---

## Getting Started

### Web app (local file mode)

```bash
cd family.web
npm install
npm run dev
```

Open `http://localhost:5173`. On the splash screen you can:

- **Load existing** — drag-and-drop or browse to a `.db` file
- **Create new** — enter a family name to start from a blank database

A blank template database (`familytree - default.db`) is included in `family.web/`.

### API server

> **Note:** The API project requires further development before it can be used as a live data source. The database path is currently hardcoded and auth middleware is commented out. It is not required to run the web app in local file mode.

```bash
cd family.api
npm install
node index.js
```

Update the hardcoded database path in `family.api/index.js` before connecting.

---

## Database

The app uses SQLite. Schema migrations live in `migrations/` and must be applied manually:

```bash
sqlite3 your-file.db < migrations/001_add_relationship_type_to_family_couple.sql
# repeat for each subsequent migration in order
```

See [CLAUDE.md](CLAUDE.md) for the full schema reference and migration log.

---

## Features

- Interactive family tree rendered with [ReactFlow](https://reactflow.dev/)
- Add, edit, and delete family members
- Partner/couple management with relationship types (Partner, Common-Law, Divorced, etc.)
- Multiple family groups with the ability to switch between them
- Member timeline and attachment support
- Export updated `.db` file for sharing or backup

---

## Credits

UI design and tree layout inspired by [fokolo/family-tree](https://github.com/fokolo/family-tree).

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, TypeScript, Vite |
| Tree rendering | @xyflow/react (ReactFlow) |
| In-browser database | sql.js (SQLite via WASM) |
| API server | Express 5, sqlite3 (Node.js) |
