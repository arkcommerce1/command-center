import { Pool } from "pg";

let _pool: Pool | null = null;

function getPool(): Pool {
  if (!_pool) {
    const connStr = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!connStr) throw new Error("DATABASE_URL not set");
    _pool = new Pool({ connectionString: connStr, max: 10 });
  }
  return _pool;
}

export interface SqlResult<T = any> {
  rows: T[];
  rowCount: number;
}

// Tagged template — same interface as @vercel/postgres `sql`.
export async function sql<T = any>(strings: TemplateStringsArray, ...values: any[]): Promise<SqlResult<T>> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    let query = strings[0];
    for (let i = 1; i < strings.length; i++) {
      query += `$${i}${strings[i]}`;
    }
    const res = await client.query(query, values);
    return { rows: res.rows as T[], rowCount: res.rowCount ?? 0 };
  } finally {
    client.release();
  }
}

// Allow `sql.query()` for raw SQL
(sql as any).query = async (text: string, params?: any[]) => {
  const pool = getPool();
  const client = await pool.connect();
  try {
    const res = await client.query(text, params);
    return { rows: res.rows, rowCount: res.rowCount ?? 0 };
  } finally {
    client.release();
  }
};
