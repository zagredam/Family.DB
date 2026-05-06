import type { Database } from 'sql.js';

export type ApiSource = { type: 'api'; url: string; accessKey: string };
export type SqliteSource = { type: 'sqlite'; db: Database };
export type DataSource = ApiSource | SqliteSource;
