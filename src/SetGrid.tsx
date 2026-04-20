import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import type { LegoSet } from './supabase';

const LEGO_PLACEHOLDER = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="200" height="150" viewBox="0 0 200 150"%3E%3Crect width="200" height="150" fill="%23e8e8e8"/%3E%3Ctext x="100" y="80" text-anchor="middle" fill="%23aaa" font-size="40"%3E🧱%3C/text%3E%3C/svg%3E';

type SortKey = 'name' | 'year' | 'piece_count';

export default function SetGrid({ onSelect }: { onSelect: (set: LegoSet) => void }) {
  const [sets, setSets] = useState<LegoSet[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [theme, setTheme] = useState('');
  const [sort, setSort] = useState<SortKey>('name');

  useEffect(() => {
    supabase.from('sets').select('*').then(({ data }) => {
      setSets(data ?? []);
      setLoading(false);
    });
  }, []);

  const themes = [...new Set(sets.map(s => s.theme).filter(Boolean))].sort();

  const filtered = sets
    .filter(s =>
      (!theme || s.theme === theme) &&
      (!search || s.name.toLowerCase().includes(search.toLowerCase()) || s.theme?.toLowerCase().includes(search.toLowerCase()))
    )
    .sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name);
      if (sort === 'year') return b.year - a.year;
      return b.piece_count - a.piece_count;
    });

  if (loading) return <p style={{ textAlign: 'center', marginTop: 60, color: '#888' }}>Loading collection…</p>;

  const selectStyle = { padding: '10px 14px', borderRadius: 10, border: '1px solid #ddd', fontSize: 14, background: '#fff', cursor: 'pointer' };

  return (
    <div>
      <div style={{ marginBottom: 20, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
        <input
          type="text"
          placeholder="Search sets…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ padding: '10px 14px', borderRadius: 10, border: '1px solid #ddd', fontSize: 15, width: 220, background: '#fff' }}
        />
        <select value={theme} onChange={e => setTheme(e.target.value)} style={selectStyle}>
          <option value="">All themes</option>
          {themes.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={sort} onChange={e => setSort(e.target.value as SortKey)} style={selectStyle}>
          <option value="name">Sort: Name</option>
          <option value="year">Sort: Newest</option>
          <option value="piece_count">Sort: Piece count</option>
        </select>
        <span style={{ color: '#888', fontSize: 14 }}>{filtered.length} sets</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16 }}>
        {filtered.map(set => (
          <div
            key={set.id}
            onClick={() => onSelect(set)}
            style={{
              background: '#fff',
              borderRadius: 12,
              overflow: 'hidden',
              cursor: 'pointer',
              boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
              transition: 'transform 0.15s, box-shadow 0.15s',
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-3px)';
              (e.currentTarget as HTMLDivElement).style.boxShadow = '0 6px 20px rgba(0,0,0,0.12)';
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLDivElement).style.transform = 'none';
              (e.currentTarget as HTMLDivElement).style.boxShadow = '0 1px 4px rgba(0,0,0,0.08)';
            }}
          >
            <img
              src={set.image_url ?? LEGO_PLACEHOLDER}
              alt={set.name}
              style={{ width: '100%', height: 150, objectFit: 'cover', background: '#f0f0f0' }}
              onError={e => { (e.currentTarget as HTMLImageElement).src = LEGO_PLACEHOLDER; }}
            />
            <div style={{ padding: '12px 14px' }}>
              <div style={{ fontWeight: 700, fontSize: 14, lineHeight: 1.3, marginBottom: 4 }}>{set.name}</div>
              <div style={{ fontSize: 12, color: '#888' }}>{set.theme} · {set.year}</div>
              <div style={{ fontSize: 12, color: '#aaa', marginTop: 2 }}>{set.piece_count.toLocaleString()} pieces</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
