const { useState, useEffect, useRef, useCallback, useMemo } = React;



function PipelineList({ onSelect, onCreateNew }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState('grid');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api('/pipelines');
      if (res.ok) {
        const data = await res.json();
        setItems(data.pipelines || []);
      }
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); const t = setInterval(() => { if (!document.hidden) load(); }, 10000); return () => clearInterval(t); }, []);

  const sorted = items.toSorted((a, b) => {
    const ta = new Date(a.created_at).getTime();
    const tb = new Date(b.created_at).getTime();
    return viewMode === 'list' ? ta - tb : tb - ta;
  });

  if (viewMode === 'grid') {
    return (
      <div>
        <div className="flex items-center justify-between mb-4">
          <div />
          <button onClick={() => setViewMode('list')} className="nav-btn text-sm text-stone-400 hover:text-brass-400 transition-colors">列表视图</button>
        </div>
        {loading && items.length === 0 && <p className="text-stone-500">加载中...</p>}
        {items.length === 0 && !loading && (
          <div className="text-center py-20">
            <p className="text-stone-400 mb-4">暂无 Pipeline</p>
            <button onClick={onCreateNew} className="nav-btn px-4 py-2 bg-brass-500 hover:bg-brass-400 text-ink-950 rounded font-medium transition-all">创建 Pipeline</button>
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sorted.map(p => (
            <div key={p.pipeline_id} onClick={() => onSelect(p.pipeline_id)}
              className="pipeline-card bg-ink-900 p-5 rounded-lg border border-ink-700 cursor-pointer hover:border-brass-500/30 transition-all">
              <div className="flex items-center justify-between mb-2">
                <span className="text-stone-100 text-sm font-medium truncate" title={p.name}>{p.name || p.pipeline_id.slice(-8)}</span>
                <StatusBadge status={p.status} />
              </div>
              <div className="text-stone-400 text-xs">步骤 {p.step}/5</div>
              <div className="mt-3 w-full bg-ink-700 rounded-full h-1 overflow-hidden">
                <div className="bg-brass-500 h-full rounded-full transition-all duration-500" style={{ width: `${(p.step / 5) * 100}%` }} />
              </div>
              <div className="mt-3 text-xs text-stone-500">{new Date(p.updated_at).toLocaleString()}</div>
              {p.duration && <div className="mt-0.5 text-xs text-stone-500">运行时长: {formatDuration(p.duration)}</div>}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div />
        <button onClick={() => setViewMode('grid')} className="nav-btn text-sm text-stone-400 hover:text-brass-400 transition-colors">卡片视图</button>
      </div>
      {loading && items.length === 0 && <p className="text-stone-500">加载中...</p>}
      {items.length === 0 && !loading && (
        <div className="text-center py-20">
          <p className="text-stone-400 mb-4">暂无 Pipeline</p>
          <button onClick={onCreateNew} className="nav-btn px-4 py-2 bg-brass-500 hover:bg-brass-400 text-ink-950 rounded font-medium transition-all">创建 Pipeline</button>
        </div>
      )}
      <div className="bg-ink-900 rounded-lg border border-ink-700 overflow-hidden">
        <div className="grid grid-cols-12 gap-4 p-3 bg-ink-800 text-xs text-stone-300 font-semibold">
          <div className="col-span-4">名称</div>
          <div className="col-span-2">状态</div>
          <div className="col-span-1">步骤</div>
          <div className="col-span-3">创建时间</div>
          <div className="col-span-2">运行时长</div>
        </div>
        {sorted.map(p => (
          <div key={p.pipeline_id} onClick={() => onSelect(p.pipeline_id)}
            className="grid grid-cols-12 gap-4 p-3 border-t border-ink-700 cursor-pointer hover:bg-ink-800/50 transition-colors">
            <div className="col-span-4 text-stone-100 text-sm font-medium truncate" title={p.name}>{p.name || p.pipeline_id.slice(-8)}</div>
            <div className="col-span-2"><StatusBadge status={p.status} /></div>
            <div className="col-span-1 text-stone-400 text-xs">步骤 {p.step}/5</div>
            <div className="col-span-3 text-stone-400 text-xs">{new Date(p.created_at).toLocaleString()}</div>
            <div className="col-span-2 text-stone-400 text-xs">{formatDuration(p.duration) || '-'}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
