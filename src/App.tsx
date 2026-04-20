import { useState } from 'react';
import LegoSetGrid from './SetGrid';
import LegoSetDetail from './SetDetail';
import AllParts from './AllParts';
import type { LegoSet } from './supabase';
import './App.css';

type View = 'sets' | 'parts';

export default function App() {
  const [view, setView] = useState<View>('sets');
  const [selected, setSelected] = useState<LegoSet | null>(null);

  const navBtn = (label: string, target: View): React.ReactNode => (
    <button
      onClick={() => { setView(target); setSelected(null); }}
      style={{
        background: view === target ? 'rgba(0,0,0,0.15)' : 'rgba(0,0,0,0.07)',
        border: 'none', color: '#000', borderRadius: 8,
        padding: '6px 14px', cursor: 'pointer', fontSize: 14,
        fontWeight: view === target ? 700 : 400,
      }}
    >{label}</button>
  );

  return (
    <div style={{ minHeight: '100vh', background: '#f5f5f0', fontFamily: 'system-ui, sans-serif' }}>
      <header style={{ background: '#F5C400', color: '#000', padding: '16px 24px', display: 'flex', alignItems: 'center', gap: 12 }}>
        {selected && (
          <button
            onClick={() => setSelected(null)}
            style={{ background: 'rgba(0,0,0,0.1)', border: 'none', color: '#000', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 14 }}
          >← Back</button>
        )}
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, letterSpacing: '-0.5px' }}>
          {selected ? selected.name : '🧱 My LEGO Collection'}
        </h1>
        {selected ? (
          <span style={{ marginLeft: 'auto', opacity: 0.85, fontSize: 14 }}>
            {selected.year} · {selected.piece_count.toLocaleString()} pieces · {selected.theme}
          </span>
        ) : (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            {navBtn('Sets', 'sets')}
            {navBtn('All Parts', 'parts')}
          </div>
        )}
      </header>
      <main style={{ padding: 24, maxWidth: 1400, margin: '0 auto' }}>
        {selected
          ? <LegoSetDetail set={selected} />
          : view === 'sets'
            ? <LegoSetGrid onSelect={setSelected} />
            : <AllParts />
        }
      </main>
    </div>
  );
}
