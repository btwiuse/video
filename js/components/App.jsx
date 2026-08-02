const { useState, useEffect, useRef, useCallback, useMemo } = React;

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

const THEME_STORAGE_KEY = 'film-pipeline-theme';
const getSavedTheme = () => {
  try { return localStorage.getItem(THEME_STORAGE_KEY) === 'dark' ? 'dark' : 'light'; }
  catch { return 'light'; }
};

    function App() {
const [pipelines, setPipelines] = useState([]);
const [selected, setSelected] = useState(null);
const [health, setHealth] = useState(null);
const [currentView, setCurrentView] = useState('list');
const [pipelineId, setPipelineId] = useState(null);
const [theme, setTheme] = useState(getSavedTheme);
const pollRef = useRef(null);
const currentViewRef = useRef(currentView);
currentViewRef.current = currentView;
const pipelineIdRef = useRef(pipelineId);
pipelineIdRef.current = pipelineId;

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
    const cv = currentViewRef.current;
    const pid = pipelineIdRef.current;
    if (v === 'detail' && id) {
      if (cv === 'detail' && pid === id) return;
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
}, []);

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
  document.body.className = `theme-volc${theme === 'dark' ? ' theme-volc-dark' : ''}`;
  try { localStorage.setItem(THEME_STORAGE_KEY, theme); } catch {}
}, [theme]);

return (
  <div className="min-h-screen flex flex-col">
    <header className="volc-header px-4 sm:px-7">
      <button onClick={() => navigateTo('list')} className="flex items-center gap-3 hover:opacity-80 transition-opacity">
        <img src="/assets/favicon.svg" alt="剧创工作台" className="volc-logo" />
        <div>
          <h1 className="font-heading text-[15px] font-semibold text-stone-100 leading-tight">剧创工作台</h1>
          <p className="text-[11px] text-stone-500 leading-tight">AI 剧本到视频</p>
        </div>
      </button>
      <div className="flex items-center gap-3">
        <span className="hidden sm:inline text-xs text-stone-500">项目工作台</span>
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${health ? 'bg-leaf-400' : 'bg-clay-500'}`} />
          <span className="text-xs text-stone-400">{health ? '服务正常' : '服务离线'}</span>
        </div>
        <button type="button" onClick={() => setTheme(current => current === 'dark' ? 'light' : 'dark')}
          aria-label={theme === 'dark' ? '切换至浅色模式' : '切换至暗色模式'} title={theme === 'dark' ? '切换至浅色模式' : '切换至暗色模式'}
          className="theme-toggle nav-btn flex h-9 w-9 items-center justify-center rounded-lg border border-ink-700 bg-ink-900 text-base text-stone-400 hover:text-brass-500">
          {theme === 'dark' ? '☀' : '☾'}
        </button>
        <button onClick={() => navigateTo('create')}
          className="nav-btn volc-primary text-sm px-3.5 py-2 text-ink-950 rounded-lg font-medium transition-all">
          + 创建项目
        </button>
      </div>
    </header>

    <main className="flex-1 px-4 py-5 sm:px-7 sm:py-7 overflow-auto">
      <ErrorBoundary>
        {currentView === 'create' && (
          <div className="max-w-2xl mx-auto">
            <button onClick={() => navigateTo('list')} className="nav-btn text-sm text-stone-400 hover:text-brass-400 mb-4 transition-colors">← 返回列表</button>
            <CreatePipeline onCreated={(id) => { selectPipeline(id); }} />
          </div>
        )}

        {currentView === 'list' && (
          <PipelineList onSelect={selectPipeline} onCreateNew={() => navigateTo('create')} />
        )}

        {currentView === 'detail' && selected && (
          <div className="max-w-6xl mx-auto">
            <button onClick={() => navigateTo('list')} className="nav-btn text-sm text-stone-400 hover:text-brass-400 mb-4 transition-colors">← 返回列表</button>
            <PipelineDetail pipeline={selected} onRefresh={refreshSelected} onBack={() => navigateTo('list')} />
          </div>
        )}
      </ErrorBoundary>
    </main>

    <footer className="border-t border-ink-700 px-6 py-4 text-center text-xs text-stone-500 bg-ink-900/70">
      剧创工作台 · AI 剧本到视频
    </footer>
    <Toaster />
  </div>
);
    }
