#!/usr/bin/env node
const { Client } = require('pg');
const fs = require('fs');

const DB_URL = 'postgresql://postgres.urbwassefngfpqdtxcif:xyKdod-norwa7-qutvir@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres';

const { sets: atSets, parts: atParts } = JSON.parse(
  fs.readFileSync('/Users/neilthomas/lego/airtable-export.json')
);

async function main() {
  const client = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log('Connected to Supabase');

  // Create schema
  console.log('Creating tables...');
  await client.query(`
    CREATE TABLE IF NOT EXISTS sets (
      id SERIAL PRIMARY KEY,
      set_number TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      year INTEGER,
      piece_count INTEGER,
      theme TEXT,
      image_url TEXT,
      quantity INTEGER DEFAULT 1,
      on_display BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS parts (
      id SERIAL PRIMARY KEY,
      part_num TEXT NOT NULL,
      part_name TEXT,
      color TEXT NOT NULL,
      quantity INTEGER DEFAULT 0,
      image_url TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(part_num, color)
    );

    CREATE TABLE IF NOT EXISTS set_parts (
      set_id INTEGER REFERENCES sets(id) ON DELETE CASCADE,
      part_id INTEGER REFERENCES parts(id) ON DELETE CASCADE,
      PRIMARY KEY (set_id, part_id)
    );
  `);
  console.log('Tables created');

  // Insert sets, build airtable_id -> db_id map
  console.log(`Inserting ${atSets.length} sets...`);
  const setIdMap = {}; // airtable record id -> supabase id
  for (const rec of atSets) {
    const f = rec.fields;
    const res = await client.query(
      `INSERT INTO sets (set_number, name, year, piece_count, theme, quantity, on_display)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (set_number) DO UPDATE SET name=EXCLUDED.name
       RETURNING id`,
      [
        f['Set Number'],
        f['Name'],
        f['Year'] ?? null,
        f['Piece Count'] ?? null,
        f['Theme'] ?? null,
        f['Quantity'] ?? 1,
        f['On Display'] ?? false,
      ]
    );
    setIdMap[rec.id] = res.rows[0].id;
  }
  console.log(`  ${atSets.length} sets inserted`);

  // Insert parts, build airtable_id -> db_id map
  console.log(`Inserting ${atParts.length} parts...`);
  const partIdMap = {}; // airtable record id -> supabase id
  let partCount = 0;
  for (const rec of atParts) {
    const f = rec.fields;
    const res = await client.query(
      `INSERT INTO parts (part_num, part_name, color, quantity)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (part_num, color) DO UPDATE SET quantity=EXCLUDED.quantity
       RETURNING id`,
      [
        f['Part No.'],
        f['Part Name'] ?? null,
        f['Color'],
        f['Quantity'] ?? 0,
      ]
    );
    partIdMap[rec.id] = res.rows[0].id;
    partCount++;
    if (partCount % 500 === 0) process.stdout.write(`  ${partCount}/${atParts.length}\r`);
  }
  console.log(`  ${atParts.length} parts inserted`);

  // Build set_parts junction from parts' Set(s) field
  console.log('Building set_parts junction...');
  let junctionCount = 0;
  for (const rec of atParts) {
    const partDbId = partIdMap[rec.id];
    const setAirtableIds = rec.fields['Set(s)'] ?? [];
    for (const atSetId of setAirtableIds) {
      const setDbId = setIdMap[atSetId];
      if (!setDbId) continue;
      await client.query(
        `INSERT INTO set_parts (set_id, part_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [setDbId, partDbId]
      );
      junctionCount++;
    }
  }
  console.log(`  ${junctionCount} set_parts rows inserted`);

  // Verify
  const counts = await client.query(`
    SELECT
      (SELECT COUNT(*) FROM sets) AS sets,
      (SELECT COUNT(*) FROM parts) AS parts,
      (SELECT COUNT(*) FROM set_parts) AS set_parts
  `);
  console.log('\nFinal counts:', counts.rows[0]);

  await client.end();
  console.log('Done!');
}

main().catch(err => { console.error('Error:', err.message); process.exit(1); });
