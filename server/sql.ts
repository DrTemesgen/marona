// One small async interface over the two SQLite engines the server runs on:
// - node:sqlite (built into Node) on a PC and in the tests, with the file data/game.db;
// - libSQL (Turso, a hosted SQLite) on the online demo, over HTTPS.
// Every query in the server goes through it, with ? parameters only (never string building).
// Writes that must not race (a class cap, one final start or submit per player) are single
// statements, so they stay correct when several server instances write at the same time.
import type { DatabaseSync, SQLInputValue, StatementSync } from 'node:sqlite';
import type { Client, InValue, ResultSet } from '@libsql/client';

export type SqlValue = string | number | bigint | null;

export interface RunInfo {
  changes: number;
  lastInsertRowid: number;
}

export interface Sql {
  get<T>(sql: string, params?: readonly SqlValue[]): Promise<T | undefined>;
  all<T>(sql: string, params?: readonly SqlValue[]): Promise<T[]>;
  run(sql: string, params?: readonly SqlValue[]): Promise<RunInfo>;
  exec(script: string): Promise<void>; // several statements, no parameters (the schema)
}

// node:sqlite. Prepared statements are kept per SQL text.
export function nodeSql(db: DatabaseSync): Sql {
  const cache = new Map<string, StatementSync>();
  const prep = (sql: string): StatementSync => {
    let s = cache.get(sql);
    if (!s) {
      s = db.prepare(sql);
      cache.set(sql, s);
    }
    return s;
  };
  const args = (params: readonly SqlValue[]) => params as SQLInputValue[];
  return {
    async get<T>(sql: string, params: readonly SqlValue[] = []) {
      return prep(sql).get(...args(params)) as T | undefined;
    },
    async all<T>(sql: string, params: readonly SqlValue[] = []) {
      return prep(sql).all(...args(params)) as T[];
    },
    async run(sql: string, params: readonly SqlValue[] = []) {
      const r = prep(sql).run(...args(params));
      return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
    },
    async exec(script: string) {
      db.exec(script);
    },
  };
}

// libSQL rows are array-like; the server reads them as plain objects by column name.
function rowsOf(rs: ResultSet): Record<string, unknown>[] {
  return rs.rows.map((row) => {
    const o: Record<string, unknown> = {};
    rs.columns.forEach((name, i) => {
      o[name] = row[i];
    });
    return o;
  });
}

// libSQL: the same calls over the client from @libsql/client (or @libsql/client/web on Vercel).
export function libsqlSql(client: Client): Sql {
  const exec = (sql: string, params: readonly SqlValue[]) =>
    client.execute({ sql, args: params as InValue[] });
  return {
    async get<T>(sql: string, params: readonly SqlValue[] = []) {
      return rowsOf(await exec(sql, params))[0] as T | undefined;
    },
    async all<T>(sql: string, params: readonly SqlValue[] = []) {
      return rowsOf(await exec(sql, params)) as T[];
    },
    async run(sql: string, params: readonly SqlValue[] = []) {
      const rs = await exec(sql, params);
      return { changes: rs.rowsAffected, lastInsertRowid: Number(rs.lastInsertRowid ?? 0) };
    },
    async exec(script: string) {
      await client.executeMultiple(script);
    },
  };
}
