import { useState, useRef } from 'react';
import { supabase } from './supabase';

const RB_KEY = import.meta.env.VITE_REBRICKABLE_KEY;
const rbHeaders = { Authorization: `key ${RB_KEY}` };

async function rbGet(path: string) {
  const res = await fetch(`https://rebrickable.com/api/v3/lego${path}`, { headers: rbHeaders });
  if (!res.ok) throw new Error(`Rebrickable error ${res.status}`);
  return res.json();
}

async function rbGetAll(path: string, cancelled: () => boolean) {
  const results: any[] = [];
  let next: string | null = path;
  while (next) {
    if (cancelled()) throw new Error('CANCELLED');
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
  const cancelledRef = useRef(false);

  function handleCancel() {
    cancelledRef.current = true;
    onClose();
  }

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
    cancelledRef.current = false;
    setStatus('adding');
    setError('');
    const cancelled = () => cancelledRef.current;

    try {
      const { data: existing } = await supabase.from('sets').select('id').eq('set_number', preview.set_num).maybeSingle();
      if (existing) { setError('This set is already in your collection.'); setStatus('idle'); return; }

      setProgress('Fetching parts from Rebrickable…');
      const setNum = preview.set_num;
      const [rbParts, themeData] = await Promise.all([
        rbGetAll(`/sets/${setNum}/parts/?page_size=500`, cancelled),
        rbGet(`/themes/${preview.theme_id}/`).catch(() => null),
      ]);
      if (cancelled()) return;

      setProgress('Saving set…');
      const { data: setRow, error: setErr } = await supabase
        .from('sets')
        .insert({ set_number: preview.set_num, name: preview.name, year: preview.year, piece_count: preview.num_parts, theme: themeData?.name ?? String(preview.theme_id), image_url: preview.image })
        .select('id').single();
      if (setErr) throw new Error(setErr.message);
      const setId = setRow.id;

      // Batch: fetch all existing parts matching these part_nums in one query
      setProgress(`Saving ${rbParts.length} parts…`);
      const partNums = [...new Set(rbParts.map((p: any) => p.part.part_num as string))];
      const { data: existingParts } = await supabase.from('parts').select('id, quantity, part_num, color').in('part_num', partNums);
      const existingMap = new Map((existingParts ?? []).map((p: any) => [`${p.part_num}|${p.color}`, p]));

      // Split into new vs existing
      const toInsert: any[] = [];
      const toUpdate: { id: number; quantity: number }[] = [];
      for (const p of rbParts) {
        const key = `${p.part.part_num}|${p.color.name}`;
        const ex = existingMap.get(key);
        if (ex) {
          toUpdate.push({ id: ex.id, quantity: ex.quantity + p.quantity });
        } else {
          toInsert.push({ part_num: p.part.part_num, part_name: p.part.name, color: p.color.name, quantity: p.quantity, image_url: p.part.part_img_url ?? null });
        }
      }

      // Batch insert new parts
      let insertedParts: any[] = [];
      if (toInsert.length > 0) {
        if (cancelled()) return;
        const { data } = await supabase.from('parts').insert(toInsert).select('id, part_num, color');
        insertedParts = data ?? [];
      }

      // Update existing parts quantities in parallel batches of 20
      if (toUpdate.length > 0) {
        if (cancelled()) return;
        setProgress(`Updating ${toUpdate.length} existing parts…`);
        for (let i = 0; i < toUpdate.length; i += 20) {
          if (cancelled()) return;
          await Promise.all(toUpdate.slice(i, i + 20).map(({ id, quantity }) =>
            supabase.from('parts').update({ quantity }).eq('id', id)
          ));
        }
      }

      // Batch insert set_parts
      if (cancelled()) return;
      setProgress('Linking parts to set…');
      const insertedMap = new Map(insertedParts.map((p: any) => [`${p.part_num}|${p.color}`, p.id]));
      const setPartsToInsert = rbParts.map((p: any) => {
        const key = `${p.part.part_num}|${p.color.name}`;
        const ex = existingMap.get(key);
        const partId = ex ? ex.id : insertedMap.get(key);
        return partId ? { set_id: setId, part_id: partId, quantity: p.quantity } : null;
      }).filter(Boolean);

      await supabase.from('set_parts').insert(setPartsToInsert);

      if (!cancelled()) {
        setProgress('Done!');
        setTimeout(() => { onAdded(); onClose(); }, 600);
      }
    } catch (e: any) {
      if (e.message === 'CANCELLED') return;
      setError(e.message);
      setStatus('idle');
      setProgress('');
    }
  }

  const busy = status !== 'idle';

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
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
          <button onClick={handleCancel}
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
