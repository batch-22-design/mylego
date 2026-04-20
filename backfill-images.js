#!/usr/bin/env node

// Backfills image_url for all existing parts and sets records from Rebrickable

import pg from 'pg';
const { Client } = pg;

const REBRICKABLE_KEY = 'b88380fc1e0fa11fab4efd2e5db1a2fa';
const DB_URL = 'postgresql://postgres.urbwassefngfpqdtxcif:xyKdod-norwa7-qutvir@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres';

const rbHeaders = { Authorization: `key ${REBRICKABLE_KEY}` };
const sleep = ms => new Promise(r => setTimeout(r, ms));

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
    if (data.next) await sleep(1100);
  }
  return results;
}

async function main() {
  const client = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  // --- Backfill Sets ---
  console.log('Backfilling set images...');
  const { rows: sets } = await client.query('SELECT id, set_number FROM sets WHERE image_url IS NULL');
  let setCount = 0;
  for (const set of sets) {
    try {
      await sleep(1100);
      const data = await rbGet(`/sets/${set.set_number}/`);
      if (data.set_img_url) {
        await client.query('UPDATE sets SET image_url = $1 WHERE id = $2', [data.set_img_url, set.id]);
        setCount++;
      }
    } catch {
      console.warn(`  Could not fetch image for set ${set.set_number}`);
    }
  }
  console.log(`  ${setCount}/${sets.length} sets updated`);

  // --- Backfill Parts via set inventories (color-specific images) ---
  console.log('Backfilling part images (color-specific)...');
  const { rows: allSets } = await client.query('SELECT set_number FROM sets');

  // Build "part_num|color_name" → color-specific img_url map
  const imgMap = {};
  for (const set of allSets) {
    await sleep(1100);
    try {
      const parts = await rbGetAll(`/sets/${set.set_number}/parts/?page_size=500`);
      for (const p of parts) {
        const key = `${p.part.part_num}|${p.color.name}`;
        if (!imgMap[key] && p.part.part_img_url) {
          imgMap[key] = p.part.part_img_url;
        }
      }
    } catch {
      console.warn(`  Could not fetch parts for set ${set.set_number}`);
    }
    process.stdout.write('.');
  }
  console.log();

  // Update all parts with their color-specific image
  const { rows: partsToUpdate } = await client.query('SELECT id, part_num, color FROM parts');
  let partCount = 0;
  for (const part of partsToUpdate) {
    const url = imgMap[`${part.part_num}|${part.color}`];
    if (url) {
      await client.query('UPDATE parts SET image_url = $1 WHERE id = $2', [url, part.id]);
      partCount++;
    }
  }
  console.log(`  ${partCount}/${partsToUpdate.length} parts updated`);

  await client.end();
  console.log('Done!');
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
