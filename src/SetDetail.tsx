import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import type { LegoSet, Part } from './supabase';

async function removeSet(setId: number) {
  // Fetch all parts in this set with their global quantities
  const { data: setPartRows } = await supabase
    .from('set_parts')
    .select('part_id, quantity, parts(id, quantity)')
    .eq('set_id', setId);

  if (setPartRows && setPartRows.length > 0) {
    const toDelete: number[] = [];
    const toUpdate: { id: number; quantity: number }[] = [];

    for (const row of setPartRows as any[]) {
      const part = row.parts;
      const newQty = part.quantity - row.quantity;
      if (newQty <= 0) toDelete.push(part.id);
      else toUpdate.push({ id: part.id, quantity: newQty });
    }

    await Promise.all([
      toDelete.length > 0 ? supabase.from('parts').delete().in('id', toDelete) : null,
      ...toUpdate.map(({ id, quantity }) => supabase.from('parts').update({ quantity }).eq('id', id)),
    ]);
  }

  await supabase.from('set_parts').delete().eq('set_id', setId);
  await supabase.from('sets').delete().eq('id', setId);
}

const PART_PLACEHOLDER = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80"%3E%3Crect width="80" height="80" fill="%23f0f0f0"/%3E%3Ctext x="40" y="48" text-anchor="middle" fill="%23ccc" font-size="28"%3E🔩%3C/text%3E%3C/svg%3E';

type SortKey = 'name' | 'color' | 'qty_desc' | 'qty_asc';

export default function SetDetail({ set, onRemove }: { set: LegoSet; onRemove: () => void }) {
  const [parts, setParts] = useState<Part[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [colorFilter, setColorFilter] = useState('');
  const [sort, setSort] = useState<SortKey>('color');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [cols, setCols] = useState(4);
  const [lightbox, setLightbox] = useState<Part | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    supabase
      .from('set_parts')
      .select('quantity, parts(*)')
      .eq('set_id', set.id)
      .then(({ data }) => {
        setParts((data ?? []).map((row: any) => ({ ...row.parts as Part, quantity: row.quantity })));
        setLoading(false);
      });
  }, [set.id]);

  const colors = [...new Set(parts.map(p => p.color))].sort();

  const filtered = parts
    .filter(p => {
      const matchSearch = !search || p.part_name.toLowerCase().includes(search.toLowerCase()) || p.part_num.includes(search);
      const matchColor = !colorFilter || p.color === colorFilter;
      return matchSearch && matchColor;
    })
    .sort((a, b) => {
      if (sort === 'name') return a.part_name.localeCompare(b.part_name);
      if (sort === 'color') return a.color.localeCompare(b.color) || a.part_name.localeCompare(b.part_name);
      if (sort === 'qty_desc') return b.quantity - a.quantity;
      return a.quantity - b.quantity;
    });

  const selectStyle: React.CSSProperties = {
    padding: '7px 10px', borderRadius: 8, border: '1px solid #ddd',
    fontSize: 13, background: '#fff', cursor: 'pointer',
  };

  const btnStyle = (active: boolean): React.CSSProperties => ({
    padding: '7px 12px', borderRadius: 8, border: '1px solid #ddd',
    fontSize: 13, background: active ? '#e63946' : '#fff',
    color: active ? '#fff' : '#333', cursor: 'pointer', fontWeight: active ? 600 : 400,
  });

  return (
    <div>
      {set.image_url && (
        <img
          src={set.image_url}
          alt={set.name}
          style={{ width: '100%', maxHeight: 300, objectFit: 'contain', marginBottom: 20, borderRadius: 12, background: '#fff' }}
        />
      )}

      <div style={{ marginBottom: 14, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="text"
          placeholder="Search parts…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ ...selectStyle, width: 180 }}
        />
        <select value={colorFilter} onChange={e => setColorFilter(e.target.value)} style={selectStyle}>
          <option value="">All colors</option>
          {colors.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={sort} onChange={e => setSort(e.target.value as SortKey)} style={selectStyle}>
          <option value="color">Sort: Color</option>
          <option value="name">Sort: Name</option>
          <option value="qty_desc">Sort: Qty ↓</option>
          <option value="qty_asc">Sort: Qty ↑</option>
        </select>

        <div style={{ display: 'flex', gap: 4, marginLeft: 4 }}>
          <button style={btnStyle(viewMode === 'grid')} onClick={() => setViewMode('grid')}>⊞ Grid</button>
          <button style={btnStyle(viewMode === 'list')} onClick={() => setViewMode('list')}>☰ List</button>
        </div>

        {viewMode === 'grid' && (
          <div style={{ display: 'flex', gap: 4 }}>
            {[3, 4, 5, 6].map(n => (
              <button key={n} style={btnStyle(cols === n)} onClick={() => setCols(n)}>{n}</button>
            ))}
          </div>
        )}

        <span style={{ color: '#888', fontSize: 13, marginLeft: 'auto' }}>
          {loading ? 'Loading…' : `${filtered.length} parts`}
        </span>
        <button
          onClick={() => setConfirmRemove(true)}
          style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid #ffcccc', background: '#fff5f5', color: '#cc0000', fontSize: 13, cursor: 'pointer' }}
        >Remove Set</button>
      </div>

      {viewMode === 'grid' ? (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 10 }}>
          {filtered.map(part => (
            <div
              key={part.id}
              onClick={() => setLightbox(part)}
              style={{ background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.07)', cursor: 'pointer' }}
            >
              <img
                src={part.image_url ?? PART_PLACEHOLDER}
                alt={part.part_name}
                style={{ width: '100%', height: 100, objectFit: 'contain', background: '#fff', padding: 8 }}
                onError={e => { (e.currentTarget as HTMLImageElement).src = PART_PLACEHOLDER; }}
              />
              <div style={{ padding: '8px 10px' }}>
                <div style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.3, marginBottom: 2 }}>{part.part_name}</div>
                <div style={{ fontSize: 11, color: '#888' }}>{part.color}</div>
                <div style={{ fontSize: 11, color: '#aaa' }}>#{part.part_num} · qty {part.quantity}</div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.07)' }}>
          <thead>
            <tr style={{ background: '#f5f5f5', fontSize: 12, color: '#666', textAlign: 'left' }}>
              <th style={{ padding: '10px 12px', fontWeight: 600 }}>Image</th>
              <th style={{ padding: '10px 12px', fontWeight: 600 }}>Part</th>
              <th style={{ padding: '10px 12px', fontWeight: 600 }}>Color</th>
              <th style={{ padding: '10px 12px', fontWeight: 600 }}>Part #</th>
              <th style={{ padding: '10px 12px', fontWeight: 600 }}>Qty</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((part, i) => (
              <tr
                key={part.id}
                onClick={() => setLightbox(part)}
                style={{ borderTop: '1px solid #f0f0f0', cursor: 'pointer', background: i % 2 === 0 ? '#fff' : '#fafafa' }}
                onMouseEnter={e => (e.currentTarget as HTMLTableRowElement).style.background = '#fff8f0'}
                onMouseLeave={e => (e.currentTarget as HTMLTableRowElement).style.background = i % 2 === 0 ? '#fff' : '#fafafa'}
              >
                <td style={{ padding: '8px 12px' }}>
                  <img
                    src={part.image_url ?? PART_PLACEHOLDER}
                    alt={part.part_name}
                    style={{ width: 48, height: 48, objectFit: 'contain', background: '#fff' }}
                    onError={e => { (e.currentTarget as HTMLImageElement).src = PART_PLACEHOLDER; }}
                  />
                </td>
                <td style={{ padding: '8px 12px', fontSize: 13, fontWeight: 500 }}>{part.part_name}</td>
                <td style={{ padding: '8px 12px', fontSize: 13, color: '#666' }}>{part.color}</td>
                <td style={{ padding: '8px 12px', fontSize: 12, color: '#aaa', fontFamily: 'monospace' }}>#{part.part_num}</td>
                <td style={{ padding: '8px 12px', fontSize: 13, fontWeight: 600 }}>{part.quantity}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {confirmRemove && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#fff', borderRadius: 16, padding: 32, maxWidth: 400, width: '90%', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            <h2 style={{ margin: '0 0 10px', fontSize: 18, fontWeight: 800 }}>Remove "{set.name}"?</h2>
            <p style={{ color: '#666', fontSize: 14, margin: '0 0 24px' }}>
              This will remove the set and decrement all its parts from your collection. Parts only in this set will be deleted.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setConfirmRemove(false)} disabled={removing}
                style={{ padding: '10px 18px', borderRadius: 10, border: '1.5px solid #ddd', background: '#fff', cursor: 'pointer', fontSize: 15 }}>
                Cancel
              </button>
              <button
                disabled={removing}
                onClick={async () => {
                  setRemoving(true);
                  await removeSet(set.id);
                  onRemove();
                }}
                style={{ padding: '10px 20px', borderRadius: 10, border: 'none', background: '#cc0000', color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 15 }}
              >
                {removing ? 'Removing…' : 'Yes, Remove'}
              </button>
            </div>
          </div>
        </div>
      )}

      {lightbox && (
        <div
          onClick={() => setLightbox(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: 16, padding: 32, maxWidth: 480, width: '90%', textAlign: 'center' }}
          >
            <img
              src={lightbox.image_url ?? PART_PLACEHOLDER}
              alt={lightbox.part_name}
              style={{ width: '100%', maxHeight: 320, objectFit: 'contain', marginBottom: 20 }}
              onError={e => { (e.currentTarget as HTMLImageElement).src = PART_PLACEHOLDER; }}
            />
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>{lightbox.part_name}</div>
            <div style={{ color: '#666', fontSize: 14, marginBottom: 4 }}>{lightbox.color}</div>
            <div style={{ color: '#aaa', fontSize: 13 }}>#{lightbox.part_num} · qty {lightbox.quantity}</div>
            <button
              onClick={() => setLightbox(null)}
              style={{ marginTop: 20, padding: '8px 24px', borderRadius: 8, border: 'none', background: '#e63946', color: '#fff', fontSize: 14, cursor: 'pointer' }}
            >Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
