#!/usr/bin/env node

const SET_ARG = process.argv[2];
if (!SET_ARG) {
  console.error('Usage: node add-set.js <set-number>  e.g. node add-set.js 42105');
  process.exit(1);
}

const { Client } = require('pg');

const REBRICKABLE_KEY = 'b88380fc1e0fa11fab4efd2e5db1a2fa';
const DB_URL = 'postgresql://postgres.urbwassefngfpqdtxcif:xyKdod-norwa7-qutvir@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres';

const rbHeaders = { Authorization: `key ${REBRICKABLE_KEY}` };

async function rbGet(path) {
  const res = await fetch(`https://rebrickable.com/api/v3/lego${path}`, { headers: rbHeaders });
  if (!res.ok) throw new Error(`Rebrickable ${res.status}: ${path}`);
  return res.json();
}

async function rbGetAll(path) {
  const results = [];
  let next = path;
  while (next) {
    const data = await rbGet(next);
    results.push(...data.results);
    next = data.next ? data.next.replace('https://rebrickable.com/api/v3/lego', '') : null;
    if (data.next) await new Promise(r => setTimeout(r, 1100));
  }
  return results;
}

async function main() {
  const setNum = SET_ARG.includes('-') ? SET_ARG : `${SET_ARG}-1`;

  const [setData] = await Promise.all([rbGet(`/sets/${setNum}/`)]);
  console.log(`${setData.name} (${setData.year}) — ${setData.num_parts} pieces`);

  const client = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  // Check for duplicate
  const existing = await client.query('SELECT id FROM sets WHERE set_number = $1', [setData.set_num]);
  if (existing.rows.length > 0) {
    console.error(`Set ${setData.set_num} is already in the database.`);
    await client.end();
    process.exit(1);
  }

  // Fetch parts and theme in parallel
  const [rbParts, themeData] = await Promise.all([
    rbGetAll(`/sets/${setNum}/parts/?page_size=500`),
    rbGet(`/themes/${setData.theme_id}/`).catch(() => null),
  ]);

  await client.query('BEGIN');
  try {
    // Insert set
    const setRes = await client.query(
      `INSERT INTO sets (set_number, name, year, piece_count, theme, image_url)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        setData.set_num,
        setData.name,
        setData.year,
        setData.num_parts,
        themeData?.name ?? String(setData.theme_id),
        setData.set_img_url ?? null,
      ]
    );
    const setId = setRes.rows[0].id;

    // Upsert parts and link to set
    let newParts = 0, updatedParts = 0;
    for (const part of rbParts) {
      const key = { num: part.part.part_num, color: part.color.name };

      const res = await client.query(
        `INSERT INTO parts (part_num, part_name, color, quantity, image_url)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (part_num, color) DO UPDATE
           SET quantity = parts.quantity + EXCLUDED.quantity
         RETURNING id, (xmax = 0) AS inserted`,
        [key.num, part.part.name, key.color, part.quantity, `https://cdn.rebrickable.com/media/parts/photos/${part.color.id}/${part.part.part_num}.jpg`]
      );

      const partId = res.rows[0].id;
      const wasInserted = res.rows[0].inserted;
      if (wasInserted) newParts++; else updatedParts++;

      await client.query(
        `INSERT INTO set_parts (set_id, part_id, quantity) VALUES ($1, $2, $3)
         ON CONFLICT (set_id, part_id) DO UPDATE SET quantity = EXCLUDED.quantity`,
        [setId, partId, part.quantity]
      );
    }

    await client.query('COMMIT');
    console.log(`Done — ${newParts} new parts, ${updatedParts} updated`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`Failed: ${err.message}`);
    console.log('Rolled back. No changes saved.');
    process.exit(1);
  } finally {
    await client.end();
  }
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
