const { useState, useEffect, useRef, useCallback, useMemo } = React;

    function App() {
const [pipelines, setPipelines] = useState([]);
const [selected, setSelected] = useState(null);
const [health, setHealth] = useState(null);
const [currentView, setCurrentView] = useState('list');
const [pipelineId, setPipelineId] = useState(null);
const [theme, setTheme] = useState(() => { try { return localStorage.getItem('pipelineTheme') || 'default'; } catch { return 'default'; } });
const pollRef = useRef(null);

const getHashView = () => {
  const hash = window.location.hash.replace('#', '');
  if (hash.startsWith('/pipelines/')) return { view: 'detail', id: hash.split('/')[2] };
  if (hash === '/create') return { view: 'create', id: null };
  return { view: 'list', id: null };
};

const navigateTo = (view, id = null) => {
  if (view === 'detail' && id) { window.location.hash = `#/pipelines/${id}`; }
  else if (view === 'create') { window.location.hash = '#/create'; }
  else { window.location.hash = '#'; }
};

const refreshSelected = useCallback(async () => {
  if (!pipelineId) return;
  try {
    const res = await api(`/pipelines/${pipelineId}`);
    if (res.ok) { const data = await res.json(); setSelected(data); }
  } catch (e) { console.error(e); }
}, [pipelineId]);

useEffect(() => {
  const onHashChange = () => {
    const { view: v, id } = getHashView();
    if (v === 'detail' && id) {
      if (currentView === 'detail' && pipelineId === id) return; // step nav only, don't re-fetch
      api(`/pipelines/${id}`).then(res => {
        if (res.ok) {
          res.json().then(data => { setSelected(data); setCurrentView('detail'); setPipelineId(id); });
        } else { navigateTo('list'); }
      });
    } else if (v === 'create') { setCurrentView('create'); setPipelineId(null); setSelected(null); }
    else { setCurrentView('list'); setPipelineId(null); setSelected(null); }
  };
  window.addEventListener('hashchange', onHashChange);
  onHashChange();
  return () => window.removeEventListener('hashchange', onHashChange);
}, [currentView, pipelineId]);

useEffect(() => {
  if (currentView !== 'detail' || !selected) return;
  const shouldPoll = selected.status === 'running' || selected.status?.startsWith('step_');
  if (shouldPoll) {
    const poll = () => { if (!document.hidden) refreshSelected(); };
    pollRef.current = setInterval(poll, 10000);
  }
  return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
}, [currentView, selected, refreshSelected]);

const selectPipeline = async (id) => { navigateTo('detail', id); };

useEffect(() => {
  (async () => {
    try { const res = await api('/health'); setHealth(res.ok); }
    catch (e) { setHealth(false); }
  })();
}, []);

useEffect(() => {
  document.body.className = theme === 'default' ? '' : `theme-${theme}`;
  try { localStorage.setItem('pipelineTheme', theme); } catch {}
}, [theme]);

return (
  <div className="min-h-screen flex flex-col">
    <header className="bg-ink-900 border-b border-ink-700 px-6 py-4 flex items-center justify-between">
      <button onClick={() => navigateTo('list')} className="flex items-center gap-3 hover:opacity-80 transition-opacity">
        <div className="w-9 h-9 bg-brass-500 rounded flex items-center justify-center text-ink-950 font-heading font-bold text-lg">F</div>
        <div>
          <h1 className="font-heading text-lg font-semibold text-stone-100 leading-tight">Film Pipeline Studio</h1>
          <p className="text-xs text-stone-500 leading-tight">AI 剧本到电影</p>
        </div>
      </button>
      <div className="flex items-center gap-3">
        <select value={theme} onChange={e => setTheme(e.target.value)}
          className="text-xs bg-ink-800 text-stone-400 border border-ink-700 rounded px-2 py-1 focus:outline-none focus:border-brass-500 cursor-pointer">
          <option value="default">默认主题</option>
          <option value="carbon">碳纤维</option>
          <option value="stripes">斜纹</option>
          <option value="dots">波点</option>
          <option value="checker">棋盘</option>
          <option value="argyle">菱形</option>
          <option value="wave">波纹</option>
        </select>
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${health ? 'bg-leaf-400' : 'bg-clay-500'}`} />
          <span className="text-sm text-stone-400">{health ? '在线' : '离线'}</span>
        </div>
        <button onClick={() => navigateTo('create')}
          className="nav-btn text-sm px-3 py-1.5 bg-brass-500 hover:bg-brass-400 text-ink-950 rounded font-medium transition-all">
          新建 Pipeline
        </button>
      </div>
    </header>

    <main className="flex-1 p-6 overflow-auto">
      {currentView === 'create' && (
        <div className="max-w-xl mx-auto">
          <button onClick={() => navigateTo('list')} className="nav-btn text-sm text-stone-400 hover:text-brass-400 mb-4 transition-colors">← 返回列表</button>
          <CreatePipeline onCreated={(id) => { selectPipeline(id); }} />
        </div>
      )}

      {currentView === 'list' && (
        <div>
          <div className="flex items-center justify-between mb-6">
            <h2 className="font-heading text-lg font-semibold text-stone-100">Pipeline 列表</h2>
          </div>
          <PipelineList onSelect={selectPipeline} onCreateNew={() => navigateTo('create')} />
        </div>
      )}

      {currentView === 'detail' && selected && (
        <div className="max-w-4xl mx-auto">
          <button onClick={() => navigateTo('list')} className="nav-btn text-sm text-stone-400 hover:text-brass-400 mb-4 transition-colors">← 返回列表</button>
          <PipelineDetail pipeline={selected} onRefresh={refreshSelected} onBack={() => navigateTo('list')} />
        </div>
      )}
    </main>

    <footer className="bg-ink-900 border-t border-ink-700 px-6 py-4 text-center text-xs text-stone-500">
      Film Pipeline Studio — AI Screenplay to Film Pipeline
    </footer>
    <Toaster />
  </div>
);
    }

