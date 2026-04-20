#!/usr/bin/env node
const AIRTABLE_KEY = process.env.AIRTABLE_KEY;
const BASE_ID = 'appVs3M9EcrzuFDps';
const atHeaders = { Authorization: `Bearer ${AIRTABLE_KEY}` };

async function atGetAll(table) {
  const records = [];
  let offset;
  do {
    const params = new URLSearchParams({ pageSize: '100' });
    if (offset) params.set('offset', offset);
    const url = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(table)}?${params}`;
    const res = await fetch(url, { headers: atHeaders });
    if (!res.ok) throw new Error(`Airtable ${res.status}: ${await res.text()}`);
    const data = await res.json();
    records.push(...data.records);
    offset = data.offset;
  } while (offset);
  return records;
}

async function main() {
  console.log('Fetching Sets...');
  const sets = await atGetAll('Sets');
  console.log(`  ${sets.length} sets`);

  console.log('Fetching Parts...');
  const parts = await atGetAll('Parts');
  console.log(`  ${parts.length} parts`);

  const fs = await import('fs');
  fs.writeFileSync('/Users/neilthomas/lego/airtable-export.json', JSON.stringify({ sets, parts }, null, 2));
  console.log('Saved to airtable-export.json');
}

main().catch(err => { console.error(err.message); process.exit(1); });
