// Run explicitly against disposable PostgreSQL with HISTORY_TEST_DATABASE_URL.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import postgres from 'postgres';
import { readFile } from 'node:fs/promises';
import { createCategoryHistoryLookup } from '../src/lib/category-history.mjs';

test('PostgreSQL: majority, ties, exact raw names, owner and retries', {
  skip: !process.env.HISTORY_TEST_DATABASE_URL,
}, async () => {
  const sql = postgres(process.env.HISTORY_TEST_DATABASE_URL, { max: 1 });
  try {
    await sql`CREATE TEMP TABLE movements (
      space_id text, created_by_user_id text, original_name text, name text, category_id text,
      source_email_provider text, source_email_id text
    )`;
    await sql`CREATE TEMP TABLE accounts (id text PRIMARY KEY, space_id text)`;
    await sql`CREATE TEMP TABLE categories (id text PRIMARY KEY, space_id text)`;
    await sql`INSERT INTO accounts VALUES ('destination-account', 'personal')`;
    await sql`INSERT INTO categories VALUES ('food', 'personal'), ('travel', 'personal'),
      ('foreign-category', 'casa'), ('other-user', 'personal'), ('normalized-only', 'personal'),
      ('wrong-case', 'personal'), ('trimmed', 'personal'), ('current-import', 'personal')`;
    await sql.unsafe(await readFile(new URL('../../../drizzle/0020_category_history_index.sql', import.meta.url), 'utf8'));
    let lastQuery;
    let lastValues;
    const lookup = createCategoryHistoryLookup({ sql: (strings, ...values) => {
      lastQuery = strings.reduce((query, part, index) => query + (index ? `$${index}` : '') + part, '');
      lastValues = values;
      return sql(strings, ...values);
    }, userId: 'rai' });
    const find = originalName => lookup({ originalName, provider: 'bci', sourceEmailId: 'current', accountId: 'destination-account' });
    const add = (category, extra = {}) => sql`INSERT INTO movements ${sql({
      space_id: 'personal', created_by_user_id: 'rai', original_name: 'RAW SHOP', name: 'Normalized shop',
      category_id: category, source_email_provider: null, source_email_id: null, ...extra,
    })}`;
    assert.equal(await find('RAW SHOP'), null);
    await add(null);
    assert.equal(await find('RAW SHOP'), null);
    // Neither foreign movements nor foreign categories cast a vote.
    await add('food', { space_id: 'casa' });
    await add('foreign-category');
    assert.equal(await find('RAW SHOP'), null);
    await add('food');
    await add('food');
    await add('travel');
    for (let i = 0; i < 4; i++) {
      await add('foreign-category');
      await add('travel', { space_id: 'casa' });
      await add('other-user', { created_by_user_id: 'someone-else' });
      await add('normalized-only', { original_name: 'different', name: 'RAW SHOP' });
      await add('wrong-case', { original_name: 'raw shop' });
      await add('trimmed', { original_name: ' RAW SHOP ' });
      await add('current-import', { source_email_provider: 'bci', source_email_id: 'current' });
    }
    assert.equal(await find('RAW SHOP'), 'food');
    assert.equal(await find('Normalized shop'), null);
    assert.equal(await find('NEW SHOP'), null);
    await add('travel');
    assert.ok(['food', 'travel'].includes(await find('RAW SHOP')));
    await add('travel', { source_email_provider: 'tenpo', source_email_id: 'current' });
    assert.equal(await find('RAW SHOP'), 'travel');
    // Include legacy rows without email identity: the email dedup index cannot
    // serve this lookup. Verify the migration's index supports the actual query.
    await sql`INSERT INTO movements (space_id, created_by_user_id, original_name, category_id)
      SELECT 'personal', 'rai', 'unrelated-' || n, 'food' FROM generate_series(1, 20000) AS n`;
    await sql`ANALYZE movements`;
    const plan = await sql.unsafe(`EXPLAIN ${lastQuery}`, lastValues);
    assert.match(plan.map(row => row['QUERY PLAN']).join('\n'), /idx_movements_category_history/);
  } finally {
    await sql.end();
  }
});
