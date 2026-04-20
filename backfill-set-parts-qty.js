#!/usr/bin/env node
const { Client } = require('pg');
const REBRICKABLE_KEY = 'b88380fc1e0fa11fab4efd2e5db1a2fa';
const DB_URL = 'postgresql://postgres.urbwassefngfpqdtxcif:xyKdod-norwa7-qutvir@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres';

async function rbGetAll(path) {
  const results = [];
  let next = `https://rebrickable.com/api/v3/lego${path}`;
  while (next) {
    const res = await fetch(next, { headers: { Authorization: `key ${REBRICKABLE_KEY}` } });
    if (!res.ok) throw new Error(`Rebrickable ${res.status}: ${path}`);
    const data = await res.json();
    results.push(...data.results);
    next = data.next ?? null;
    if (next) await new Promise(r => setTimeout(r, 1100));
  }
  return results;
}

async function main() {
  const client = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const { rows: sets } = await client.query('SELECT id, set_number, name FROM sets ORDER BY name');
  console.log(`Backfilling set_parts.quantity for ${sets.length} sets…\n`);

  for (const set of sets) {
    process.stdout.write(`  ${set.name} (${set.set_number})… `);
    try {
      const rbParts = await rbGetAll(`/sets/${set.set_number}/parts/?page_size=500`);
      let updated = 0;
      for (const part of rbParts) {
        const { rows } = await client.query(
          'SELECT id FROM parts WHERE part_num = $1 AND color = $2',
          [part.part.part_num, part.color.name]
        );
        if (!rows.length) continue;
        const partId = rows[0].id;
        await client.query(
          `INSERT INTO set_parts (set_id, part_id, quantity) VALUES ($1, $2, $3)
           ON CONFLICT (set_id, part_id) DO UPDATE SET quantity = EXCLUDED.quantity`,
          [set.id, partId, part.quantity]
        );
        updated++;
      }
      console.log(`${updated} parts updated`);
    } catch (e) {
      console.log(`ERROR: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 1100));
  }

  await client.end();
  console.log('\nDone!');
}

main().catch(e => { console.error(e.message); process.exit(1); });
