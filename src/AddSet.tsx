import { useState } from 'react';
import { supabase } from './supabase';

const RB_KEY = import.meta.env.VITE_REBRICKABLE_KEY;
const rbHeaders = { Authorization: `key ${RB_KEY}` };

async function rbGet(path: string) {
  const res = await fetch(`https://rebrickable.com/api/v3/lego${path}`, { headers: rbHeaders });
  if (!res.ok) throw new Error(`Rebrickable error ${res.status}`);
  return res.json();
}

async function rbGetAll(path: string) {
  const results: any[] = [];
  let next: string | null = path;
  while (next) {
    const data = await rbGet(next);
    results.push(...data.results);
    next = data.next ? data.next.replace('https://rebrickable.com/api/v3/lego', '') : null;
    if (data.next) await new Promise(r => setTimeout(r, 600));
  }
  return results;
}

type Props = { onClose: () => void; onAdded: () => void };

type Preview = { name: string; year: number; num_parts: number; image: string | null; set_num: string; theme_id: number };

export default function AddSet({ onClose, onAdded }: Props) {
  const [input, setInput] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [status, setStatus] = useState<'idle' | 'previewing' | 'adding'>('idle');
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');

  async function handlePreview() {
    setError('');
    setPreview(null);
    setStatus('previewing');
    try {
      const setNum = input.trim().includes('-') ? input.trim() : `${input.trim()}-1`;
      const data = await rbGet(`/sets/${setNum}/`);
      setPreview({ name: data.name, year: data.year, num_parts: data.num_parts, image: data.set_img_url ?? null, set_num: data.set_num, theme_id: data.theme_id });
    } catch (e: any) {
      setError(e.message.includes('404') ? 'Set not found — check the set number.' : e.message);
    } finally {
      setStatus('idle');
    }
  }

  async function handleAdd() {
    if (!preview) return;
    setStatus('adding');
    setError('');
    try {
      // Check for duplicate
      const { data: existing } = await supabase.from('sets').select('id').eq('set_number', preview.set_num).maybeSingle();
      if (existing) { setError('This set is already in your collection.'); setStatus('idle'); return; }

      setProgress('Fetching parts from Rebrickable…');
      const setNum = preview.set_num;
      const [rbParts, themeData] = await Promise.all([
        rbGetAll(`/sets/${setNum}/parts/?page_size=500`),
        rbGet(`/themes/${preview.theme_id}/`).catch(() => null),
      ]);

      setProgress('Saving set…');
      const { data: setRow, error: setErr } = await supabase
        .from('sets')
        .insert({ set_number: preview.set_num, name: preview.name, year: preview.year, piece_count: preview.num_parts, theme: themeData?.name ?? String(preview.theme_id), image_url: preview.image })
        .select('id')
        .single();
      if (setErr) throw new Error(setErr.message);
      const setId = setRow.id;

      setProgress(`Saving ${rbParts.length} parts…`);
      for (let i = 0; i < rbParts.length; i++) {
        const p = rbParts[i];
        const partNum = p.part.part_num;
        const color = p.color.name;
        const imageUrl = p.part.part_img_url ?? null;
        const qty = p.quantity;

        // Upsert part (increment global quantity on conflict)
        const { data: existing } = await supabase.from('parts').select('id, quantity').eq('part_num', partNum).eq('color', color).maybeSingle();
        let partId: number;
        if (existing) {
          await supabase.from('parts').update({ quantity: existing.quantity + qty, image_url: imageUrl }).eq('id', existing.id);
          partId = existing.id;
        } else {
          const { data: inserted } = await supabase.from('parts').insert({ part_num: partNum, part_name: p.part.name, color, quantity: qty, image_url: imageUrl }).select('id').single();
          partId = inserted!.id;
        }

        await supabase.from('set_parts').upsert({ set_id: setId, part_id: partId, quantity: qty });

        if (i % 20 === 0) setProgress(`Saving parts… ${i + 1}/${rbParts.length}`);
      }

      setProgress('Done!');
      setTimeout(() => { onAdded(); onClose(); }, 800);
    } catch (e: any) {
      setError(e.message);
      setStatus('idle');
      setProgress('');
    }
  }

  const busy = status !== 'idle';

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
      onClick={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: 32, width: '100%', maxWidth: 460, boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
        <h2 style={{ margin: '0 0 20px', fontSize: 20, fontWeight: 800 }}>Add a Set</h2>

        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <input
            value={input}
            onChange={e => { setInput(e.target.value); setPreview(null); setError(''); }}
            onKeyDown={e => e.key === 'Enter' && !busy && input && handlePreview()}
            placeholder="Set number, e.g. 10318 or 10318-1"
            disabled={busy}
            style={{ flex: 1, padding: '10px 14px', borderRadius: 10, border: '1.5px solid #ddd', fontSize: 15, outline: 'none' }}
          />
          <button onClick={handlePreview} disabled={!input.trim() || busy}
            style={{ padding: '10px 18px', borderRadius: 10, border: 'none', background: '#F5C400', color: '#000', fontWeight: 700, cursor: 'pointer', fontSize: 15 }}>
            {status === 'previewing' ? '…' : 'Look up'}
          </button>
        </div>

        {error && <p style={{ color: '#cc0000', margin: '0 0 16px', fontSize: 14 }}>{error}</p>}

        {preview && (
          <div style={{ border: '1.5px solid #eee', borderRadius: 12, overflow: 'hidden', marginBottom: 20 }}>
            {preview.image && <img src={preview.image} alt={preview.name} style={{ width: '100%', maxHeight: 200, objectFit: 'contain', background: '#f9f9f9', padding: 12 }} />}
            <div style={{ padding: '12px 16px' }}>
              <div style={{ fontWeight: 700, fontSize: 16 }}>{preview.name}</div>
              <div style={{ color: '#888', fontSize: 13, marginTop: 4 }}>{preview.year} · {preview.num_parts.toLocaleString()} pieces</div>
            </div>
          </div>
        )}

        {status === 'adding' && (
          <p style={{ color: '#666', fontSize: 14, marginBottom: 16 }}>{progress}</p>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} disabled={busy}
            style={{ padding: '10px 18px', borderRadius: 10, border: '1.5px solid #ddd', background: '#fff', cursor: 'pointer', fontSize: 15 }}>
            Cancel
          </button>
          {preview && (
            <button onClick={handleAdd} disabled={busy}
              style={{ padding: '10px 20px', borderRadius: 10, border: 'none', background: '#111', color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 15 }}>
              {status === 'adding' ? 'Adding…' : 'Add to Collection'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
