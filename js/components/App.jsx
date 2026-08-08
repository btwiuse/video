const { useState, useEffect, useRef, useCallback, useMemo } = React;

const getHashView = () => {
  const hash = window.location.hash.replace('#', '');
  if (hash.startsWith('/pipelines/')) return { view: 'detail', id: hash.split('/')[2] };
  if (hash === '/create') return { view: 'create', id: null };
  if (hash === '/styles') return { view: 'styles', id: null };
  if (hash === '/auth') return { view: 'auth', id: null };
  if (hash === '/organizations') return { view: 'organizations', id: null };
  return { view: 'list', id: null };
};

const navigateTo = (view, id = null) => {
  if (view === 'detail' && id) { window.location.hash = `#/pipelines/${id}`; }
  else if (view === 'create') { window.location.hash = '#/create'; }
  else if (view === 'styles') { window.location.hash = '#/styles'; }
  else if (view === 'auth') { window.location.hash = '#/auth'; }
  else if (view === 'organizations') { window.location.hash = '#/organizations'; }
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
const [user, setUser] = useState(null);
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
    } else if (v === 'create' || v === 'styles' || v === 'auth' || v === 'organizations') { setCurrentView(v); setPipelineId(null); setSelected(null); }
    else { setCurrentView('list'); setPipelineId(null); setSelected(null); }
  };
  window.addEventListener('hashchange', onHashChange);
  onHashChange();
  return () => window.removeEventListener('hashchange', onHashChange);
}, []);

useEffect(() => {
  api('/auth/me').then(async response => {
    if (response.ok) setUser((await response.json()).user || null);
  }).catch(() => setUser(null));
}, []);

const signOut = async () => {
  await api('/auth/logout', { method: 'POST', body: '{}' });
  setUser(null);
  setActiveOrganizationId('');
  navigateTo('list');
};

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
      <button onClick={() => navigateTo('list')} className="flex min-w-0 shrink-0 items-center gap-3 hover:opacity-80 transition-opacity">
        <img src="/assets/favicon.svg" alt="Reelix Studio" className="volc-logo" />
        <div className="min-w-0">
          <h1 className="whitespace-nowrap font-heading text-[15px] font-semibold text-stone-100 leading-tight">Reelix Studio</h1>
          <p className="text-[11px] text-stone-500 leading-tight">AI 剧本到视频</p>
        </div>
      </button>
      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        <span className="hidden sm:inline text-xs text-stone-500">项目工作台</span>
        <div className="flex items-center gap-1.5 sm:gap-2">
          <div className={`w-2 h-2 rounded-full ${health ? 'bg-leaf-400' : 'bg-clay-500'}`} />
          <span className="hidden text-xs text-stone-400 sm:inline">{health ? '服务正常' : '服务离线'}</span>
        </div>
        <button type="button" onClick={() => setTheme(current => current === 'dark' ? 'light' : 'dark')}
          aria-label={theme === 'dark' ? '切换至浅色模式' : '切换至暗色模式'} title={theme === 'dark' ? '切换至浅色模式' : '切换至暗色模式'}
          className="theme-toggle nav-btn flex h-9 w-9 items-center justify-center rounded-lg border border-ink-700 bg-ink-900 text-base text-stone-400 hover:text-brass-500">
          {theme === 'dark' ? '☀' : '☾'}
        </button>
        {user && <button type="button" onClick={() => navigateTo('organizations')} title="组织"
          className="nav-btn hidden sm:inline-flex h-9 items-center gap-1.5 rounded-lg border border-ink-700 bg-ink-900 px-3 text-sm font-medium text-stone-300 hover:border-brass-500/40 hover:text-brass-500">
          <span aria-hidden="true">◫</span><span>组织</span>
        </button>}
        {user && <button type="button" onClick={() => navigateTo('styles')} title="风格预设"
          className="nav-btn hidden sm:inline-flex h-9 items-center gap-1.5 rounded-lg border border-ink-700 bg-ink-900 px-3 text-sm font-medium text-stone-300 hover:border-brass-500/40 hover:text-brass-500">
          <span aria-hidden="true">✦</span><span>风格预设</span>
        </button>
        }
        {user ? <><button onClick={() => navigateTo('create')}
          className="nav-btn volc-primary h-9 whitespace-nowrap rounded-lg px-3 text-sm font-medium text-ink-950 transition-all sm:px-3.5">
          + 创建项目
        </button><button type="button" onClick={signOut} title={user.email} className="hidden sm:inline-flex h-9 items-center rounded-lg border border-ink-700 bg-ink-900 px-3 text-sm text-stone-300 hover:text-clay-400">退出</button></> : <button onClick={() => navigateTo('auth')} className="nav-btn volc-primary h-9 whitespace-nowrap rounded-lg px-3 text-sm font-medium text-ink-950 transition-all sm:px-3.5">登录</button>}
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

        {currentView === 'auth' && <AuthScreen onBack={() => navigateTo('list')} onAuthenticated={nextUser => { setUser(nextUser); navigateTo('list'); }} />}

        {currentView === 'organizations' && user && <Organizations onBack={() => navigateTo('list')} onOrganizationsChanged={() => {}} />}

        {currentView === 'styles' && (
          <div className="max-w-6xl mx-auto">
            <StylePresets onCreateNew={() => navigateTo('create')} />
          </div>
        )}

        {currentView === 'list' && (
          <PipelineList key={user ? user.id : 'public'} onSelect={selectPipeline} onCreateNew={() => user ? navigateTo('create') : navigateTo('auth')} />
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
      Reelix Studio · AI 剧本到视频
    </footer>
    <Toaster />
  </div>
);
    }
