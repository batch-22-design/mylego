#!/usr/bin/env node

// Searches Rebrickable for each set by name+pieces, then adds them all to Supabase.
// Run with --dry-run to preview matches without writing anything.

const DRY_RUN = process.argv.includes('--dry-run');

const { Client } = require('pg');

const REBRICKABLE_KEY = 'b88380fc1e0fa11fab4efd2e5db1a2fa';
const DB_URL = 'postgresql://postgres.urbwassefngfpqdtxcif:xyKdod-norwa7-qutvir@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres';

const rbHeaders = { Authorization: `key ${REBRICKABLE_KEY}` };

// Sets to import (name as it appears on LEGO.com, piece count for matching)
const COLLECTION = [
  { name: "Thor's Hammer", pieces: 979 },
  { name: "Central Perk", pieces: 1070 },
  { name: "Back to the Future Time Machine", pieces: 1872 },
  { name: "The Razor Crest", pieces: 1023 },
  { name: "McLaren MP4/4 & Ayrton Senna", pieces: 693 },
  { name: "Batman: The Classic TV Series Batmobile", pieces: 1822 },
  { name: "NASA Mars Rover Perseverance", pieces: 1132 },
  { name: "NASA Space Shuttle Discovery", pieces: 2354 },
  { name: "The Globe", pieces: 2585 },
  { name: "Hokusai The Great Wave", pieces: 1810 },
  { name: "The Razor Crest Microfighter", pieces: 98 },
  { name: "Mercedes-AMG F1 W14 E Performance Pull-Back", pieces: 240, setNum: "42165-1" },
  { name: "Dark Trooper Attack", pieces: 166 },
  { name: "McLaren Formula 1 Team", pieces: 1432 },
  { name: "NEOM McLaren Formula E Race Car", pieces: 452 },
  { name: "Mario Kart Standard Kart", pieces: 174 },
  { name: "Visa Cash App RB VCARB 01 F1 Race Car", pieces: 248 },
  { name: "Aston Martin Aramco F1 AMR24 Race Car", pieces: 269 },
  { name: "MoneyGram Haas F1 Team VF-24 Race Car", pieces: 242 },
  { name: "BWT Alpine F1 Team A524 Race Car", pieces: 258 },
  { name: "Williams Racing FW46 F1 Race Car", pieces: 263 },
  { name: "Mercedes-AMG F1 W15 Race Car", pieces: 267 },
  { name: "McLaren F1 Team MCL38 Race Car", pieces: 269 },
  { name: "KICK Sauber F1 Team C44 Race Car", pieces: 259 },
  { name: "Ferrari SF-24 F1 Race Car", pieces: 275 },
  { name: "Oracle Red Bull Racing RB20 F1 Race Car", pieces: 251 },
  { name: "Imperial TIE Fighter", pieces: 432 },
  { name: "Tales of the Space Age", pieces: 688 },
  { name: "Game Boy", pieces: 421, setNum: "72046-1" },
  { name: "WALL-E and EVE", pieces: 811 },
  { name: "Disney Pixar Luxo Jr", pieces: 613 },
  { name: "Sonic the Hedgehog Green Hill Zone", pieces: 1125 },
  { name: "Dubai", pieces: 740 },
  { name: "Up House", pieces: 598 },
  { name: "Hogwarts Chamber of Secrets", pieces: 1176 },
  { name: "Hogwarts Wizard's Chess", pieces: 876 },
  { name: "Wild Animals Panda Family", pieces: 626 },
  { name: "Deep Sea Creatures", pieces: 230 },
  { name: "Adventures with Mario Starter Course", pieces: 231 },
  { name: "Race Boat Transporter", pieces: 238 },
  { name: "LEGO Large Creative Brick Box", pieces: 790, setNum: "10698-1" },
  { name: "Time Machine from Back to the Future", pieces: 357 },
  { name: "APXGP Team Race Car F1 The Movie", pieces: 268 },
  { name: "Audi Revolut F1 Team R26 Race Car", pieces: 216 },
  { name: "Polaroid OneStep SX-70 Camera", pieces: 516, setNum: "21345-1" },
  { name: "TRON Legacy", pieces: 230 },
  { name: "NASA Apollo Saturn V", pieces: 1969 },
  { name: "The Friends Apartments", pieces: 2048 },
  { name: "Land Rover Defender", pieces: 2573 },
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function rbGet(path, retries = 3) {
  const res = await fetch(`https://rebrickable.com/api/v3/lego${path}`, { headers: rbHeaders });
  if (res.status === 429) {
    if (retries === 0) throw new Error(`Rebrickable rate limit: ${path}`);
    await sleep(2000);
    return rbGet(path, retries - 1);
  }
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

async function findSet(name, pieces) {
  const data = await rbGet(`/sets/?search=${encodeURIComponent(name)}&page_size=10`);
  if (!data.results.length) return null;
  return data.results.reduce((best, s) =>
    Math.abs(s.num_parts - pieces) < Math.abs(best.num_parts - pieces) ? s : best
  );
}

async function addSet(client, setData, existingSets) {
  if (existingSets.has(setData.set_num)) {
    return { status: 'skipped' };
  }

  const [rbParts, themeData] = await Promise.all([
    rbGetAll(`/sets/${setData.set_num}/parts/?page_size=500`),
    rbGet(`/themes/${setData.theme_id}/`).catch(() => null),
  ]);

  await client.query('BEGIN');
  try {
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

    let newParts = 0, updatedParts = 0;
    for (const part of rbParts) {
      const res = await client.query(
        `INSERT INTO parts (part_num, part_name, color, quantity, image_url)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (part_num, color) DO UPDATE
           SET quantity = parts.quantity + EXCLUDED.quantity
         RETURNING id, (xmax = 0) AS inserted`,
        [part.part.part_num, part.part.name, part.color.name, part.quantity, part.part.part_img_url ?? null]
      );
      const partId = res.rows[0].id;
      if (res.rows[0].inserted) newParts++; else updatedParts++;
      await client.query(
        `INSERT INTO set_parts (set_id, part_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [setId, partId]
      );
    }

    await client.query('COMMIT');
    return { status: 'added', created: newParts, updated: updatedParts };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

async function main() {
  if (DRY_RUN) console.log('--- DRY RUN (no changes will be made) ---\n');

  const client = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const { rows } = await client.query('SELECT set_number, COUNT(*) OVER() AS total_sets FROM sets');
  const existingSets = new Set(rows.map(r => r.set_number));
  const existingPartsCount = await client.query('SELECT COUNT(*) FROM parts');
  console.log(`Existing DB: ${existingSets.size} sets, ${existingPartsCount.rows[0].count} parts\n`);

  // Phase 1: Find all set numbers on Rebrickable
  console.log('Searching Rebrickable for set numbers...');
  const resolved = [];
  const unresolved = [];

  for (const item of COLLECTION) {
    await sleep(1100);
    const match = item.setNum
      ? await rbGet(`/sets/${item.setNum}/`).catch(() => null)
      : await findSet(item.name, item.pieces);
    if (!match) {
      unresolved.push(item);
      console.log(`  ✗ NOT FOUND: ${item.name}`);
    } else {
      const pieceDiff = Math.abs(match.num_parts - item.pieces);
      const confidence = pieceDiff === 0 ? 'exact' : pieceDiff <= 10 ? `~${pieceDiff} off` : `⚠ ${pieceDiff} off`;
      console.log(`  ${pieceDiff > 20 ? '?' : '✓'} ${match.set_num.replace(/-\d+$/, '')} — ${match.name} [${confidence}]`);
      resolved.push({ item, match });
    }
  }

  if (unresolved.length) console.log(`\n${unresolved.length} sets not found on Rebrickable.`);

  if (DRY_RUN) {
    console.log('\nDry run complete. Run without --dry-run to import.');
    await client.end();
    return;
  }

  // Phase 2: Add sets
  console.log(`\nImporting ${resolved.length} sets...\n`);
  let added = 0, skipped = 0, failed = 0;

  for (const { match } of resolved) {
    process.stdout.write(`  ${match.name}... `);
    try {
      const result = await addSet(client, match, existingSets);
      if (result.status === 'skipped') {
        console.log('already exists, skipped');
        skipped++;
      } else {
        console.log(`done (+${result.created} new, ~${result.updated} updated)`);
        existingSets.add(match.set_num);
        added++;
      }
    } catch (err) {
      console.log(`FAILED: ${err.message}`);
      failed++;
    }
  }

  console.log(`\nDone — ${added} added, ${skipped} skipped, ${failed} failed`);
  await client.end();
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
