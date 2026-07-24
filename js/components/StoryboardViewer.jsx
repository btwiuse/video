const { useState, useEffect, useRef, useCallback, useMemo } = React;

function StoryboardViewer({ pipelineId, poll, reloadKey }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [charPrompts, setCharPrompts] = useState({});
  const [scenePrompts, setScenePrompts] = useState({});
  const [propPrompts, setPropPrompts] = useState({});
  const [expandedScenes, setExpandedScenes] = useState({ _all: true });
  const [expandedShots, setExpandedShots] = useState({});
  const [expandedChars, setExpandedChars] = useState({ _all: true });
  const [expandedProps, setExpandedProps] = useState({ _all: true });
  const [editCharMd, setEditCharMd] = useState({});
  const [editingChar, setEditingChar] = useState({});
  const [savingChar, setSavingChar] = useState({});
  const [editPropMd, setEditPropMd] = useState({});
  const [editingProp, setEditingProp] = useState({});
  const [savingProp, setSavingProp] = useState({});
  const [editSceneMd, setEditSceneMd] = useState({});
  const [editingScene, setEditingScene] = useState({});
  const [savingScene, setSavingScene] = useState({});
  const [shotPrompts, setShotPrompts] = useState({});
  const [editShotMd, setEditShotMd] = useState({});
  const [editingShotMd, setEditingShotMd] = useState({});
  const [savingShotMd, setSavingShotMd] = useState({});
  const [expandedSb, setExpandedSb] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api(`/pipelines/${pipelineId}/artifacts/storyboard.json`);
      if (res.ok) { const d = await res.json(); setData(d); return d; }
    } catch (e) { /* ignore */ }
    finally { setLoading(false); }
    return null;
  }, [pipelineId]);

  useEffect(() => {
    let cancelled = false;
    if (poll) {
      setData(null);
      setCharPrompts({});
      setScenePrompts({});
      setPropPrompts({});
      setShotPrompts({});
    }
    load();
    if (poll) {
      const t = setInterval(() => {
        if (cancelled || document.hidden) return;
        load();
      }, 30000);
      return () => { cancelled = true; clearInterval(t); };
    }
    return () => { cancelled = true; };
  }, [poll, load, reloadKey]);

  // Load character prompts from .md files
  useEffect(() => {
    if (!data) return;
    const chars = data.characters || [];
    let cancelled = false;
    Promise.all(chars.map(async (c) => {
      if (charPrompts[c.ref_id]) return;
      try {
        const res = await api(`/pipelines/${pipelineId}/artifacts/characters/${encodeURIComponent(c.ref_id)}.md`);
        if (res.ok) {
          const text = await res.text();
          if (!cancelled) setCharPrompts(prev => ({ ...prev, [c.ref_id]: text }));
        }
      } catch (_) {}
    }));
    return () => { cancelled = true; };
  }, [data, pipelineId]);

  // Load prop continuity cards from .md files
  useEffect(() => {
    if (!data) return;
    const props = data.props || [];
    let cancelled = false;
    Promise.all(props.map(async (p) => {
      if (propPrompts[p.ref_id]) return;
      try {
        const res = await api(`/pipelines/${pipelineId}/artifacts/props/${encodeURIComponent(p.ref_id)}.md`);
        if (res.ok) {
          const text = await res.text();
          if (!cancelled) setPropPrompts(prev => ({ ...prev, [p.ref_id]: text }));
        }
      } catch (_) {}
    }));
    return () => { cancelled = true; };
  }, [data, pipelineId]);

  // Load shot prompts from .md files lazily
  useEffect(() => {
    if (!data) return;
    const shots = data.shots || [];
    let cancelled = false;
    Promise.all(shots.map(async (s) => {
      if (shotPrompts[s.full_shot_id]) return;
      if (!expandedShots[s.full_shot_id]) return;
      try {
        const res = await api(`/pipelines/${pipelineId}/artifacts/shots/${encodeURIComponent(s.full_shot_id)}/${encodeURIComponent(s.full_shot_id)}.md`);
        if (res.ok) {
          const text = await res.text();
          if (!cancelled) setShotPrompts(prev => ({ ...prev, [s.full_shot_id]: text }));
        }
      } catch (_) {}
    }));
    return () => { cancelled = true; };
  }, [data, pipelineId, expandedShots]);
  useEffect(() => {
    if (!data) return;
    const scenes = data.scenes || [];
    let cancelled = false;
    Promise.all(scenes.map(async (s) => {
      if (scenePrompts[s.scene_id]) return;
      try {
        const res = await api(`/pipelines/${pipelineId}/artifacts/scenes/${encodeURIComponent(s.scene_id)}.md`);
        if (res.ok) {
          const text = await res.text();
          if (!cancelled) setScenePrompts(prev => ({ ...prev, [s.scene_id]: text }));
        }
      } catch (_) {}
    }));
    return () => { cancelled = true; };
  }, [data, pipelineId]);

  const toggleScene = useCallback((sceneId) => {
    setExpandedScenes(prev => ({ ...prev, [sceneId]: !prev[sceneId] }));
  }, []);

  const toggleShot = useCallback((shotId) => {
    setExpandedShots(prev => ({ ...prev, [shotId]: !prev[shotId] }));
  }, []);

  if (!data && loading) return <div className="mt-6 text-stone-500 text-sm">加载分镜中...</div>;
  if (!data) return null;

  const scenes = data.scenes || [];
  const characters = data.characters || [];
  const props = data.props || [];
  const shots = data.shots || [];

  return (
    <div>
      <h3 className="font-heading text-lg font-semibold text-stone-100 mb-4">
        分镜概览
        <span className="text-stone-400 text-sm font-normal ml-2">
          {characters.length} 角色 · {scenes.length} 场景 · {props.length} 道具 · {shots.length} 镜头
        </span>
      </h3>
      <div className="space-y-3">
        {characters.length > 0 && (
          <div className="bg-ink-900 rounded border border-ink-700 overflow-hidden">
            <div
              className="flex items-center gap-3 p-3 cursor-pointer hover:bg-ink-800 transition-colors"
              onClick={() => setExpandedChars(prev => ({ ...prev, _all: !prev._all }))}
            >
              <span className="text-stone-500 text-xs w-3 text-center transition-transform flex-shrink-0" style={{ transform: expandedChars._all ? 'rotate(90deg)' : 'none' }}>▶</span>
              <h4 className="text-sm font-semibold text-stone-300">角色</h4>
            </div>
            {expandedChars._all && (
              <div className="border-t border-ink-700">
                {characters.map((c, idx) => {
                  const open = expandedChars[c.ref_id] || false;
                  const md = charPrompts[c.ref_id] || '';
                  return (
                    <div key={c.ref_id}>
                      <div
                        className="flex items-center gap-3 p-3 bg-ink-950/50 border-b border-ink-700 last:border-b-0 cursor-pointer hover:bg-ink-800/30 transition-colors"
                        onClick={() => setExpandedChars(prev => ({ ...prev, [c.ref_id]: !prev[c.ref_id] }))}
                      >
                        <span className="text-stone-500 text-xs w-3 text-center transition-transform flex-shrink-0" style={{ transform: open ? 'rotate(90deg)' : 'none' }}>▶</span>
                        <div className="relative w-10 h-10 flex-shrink-0">
                          <img
                            src={`/pipelines/${pipelineId}/artifacts/characters/${encodeURIComponent(c.ref_id)}_front.jpg`}
                            alt={c.ref_id}
                            className="w-10 h-10 object-cover rounded-full bg-ink-700 ring-1 ring-ink-600"
                            onError={e => {
                              const el = e.target;
                              if (el.src.endsWith('.jpg')) { el.src = el.src.replace('.jpg', '.png'); return; }
                              el.style.display = 'none';
                              el.nextElementSibling?.classList.remove('hidden');
                            }}
                          />
                          <div className="w-10 h-10 rounded-full bg-ink-700 ring-1 ring-ink-600 flex items-center justify-center text-stone-500 text-xs hidden absolute inset-0">待生成</div>
                        </div>
                        <span className="text-sm text-stone-200 font-medium">{c.name || c.ref_id}</span>
                        <button
                          onClick={e => { e.stopPropagation(); setEditCharMd(prev => ({ ...prev, [c.ref_id]: md })); setEditingChar(prev => ({ ...prev, [c.ref_id]: !prev[c.ref_id] })); }}
                          className="ml-auto text-stone-500 hover:text-brass-400 transition-colors text-xs px-1.5 py-0.5 rounded cursor-pointer"
                          title={editingChar[c.ref_id] ? '退出编辑' : '编辑 .md'}
                        >{editingChar[c.ref_id] ? '✓' : '✎'}</button>
                      </div>
                      {open && (
                        <div className="bg-ink-950 p-4 border-b border-ink-700 space-y-3 text-xs text-stone-300">
                          {editingChar[c.ref_id] ? (
                            <div className="space-y-2">
                              <textarea
                                className="w-full h-64 bg-ink-900 text-stone-200 text-xs p-3 rounded border border-ink-700 font-mono resize-y"
                                value={editCharMd[c.ref_id] ?? md}
                                onChange={e => setEditCharMd(prev => ({ ...prev, [c.ref_id]: e.target.value }))}
                              />
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={async () => {
                                    setSavingChar(prev => ({ ...prev, [c.ref_id]: true }));
                                    try {
                                      const res = await api(`/pipelines/${pipelineId}/artifacts/characters/${encodeURIComponent(c.ref_id)}.md`, {
                                        method: 'PUT',
                                        body: editCharMd[c.ref_id] ?? md,
                                      });
                                      if (res.ok) {
                                        setCharPrompts(prev => ({ ...prev, [c.ref_id]: editCharMd[c.ref_id] ?? md }));
                                        setEditingChar(prev => { const n = {...prev}; delete n[c.ref_id]; return n; });
                                        load();
                                      }
                                    } catch (_) {}
                                    setSavingChar(prev => ({ ...prev, [c.ref_id]: false }));
                                  }}
                                  className="px-3 py-1.5 text-xs font-medium bg-leaf-500/20 text-leaf-400 rounded hover:bg-leaf-500/30 transition-colors cursor-pointer"
                                >{savingChar[c.ref_id] ? '保存中...' : '保存'}</button>
                                <button
                                  onClick={() => setEditingChar(prev => { const n = {...prev}; delete n[c.ref_id]; return n; })}
                                  className="px-3 py-1.5 text-xs text-stone-500 hover:text-stone-300 transition-colors cursor-pointer"
                                >取消</button>
                              </div>
                            </div>
                          ) : (
                            <div className="markdown-body max-h-96 overflow-y-auto" dangerouslySetInnerHTML={{__html: DOMPurify.sanitize(marked.parse(md))}} />
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
        {props.length > 0 && (
          <div className="bg-ink-900 rounded border border-ink-700 overflow-hidden">
            <div
              className="flex items-center gap-3 p-3 cursor-pointer hover:bg-ink-800 transition-colors"
              onClick={() => setExpandedProps(prev => ({ ...prev, _all: !prev._all }))}
            >
              <span className="text-stone-500 text-xs w-3 text-center transition-transform flex-shrink-0" style={{ transform: expandedProps._all ? 'rotate(90deg)' : 'none' }}>▶</span>
              <h4 className="text-sm font-semibold text-stone-300">道具</h4>
              <span className="text-xs text-stone-500">{props.length}</span>
            </div>
            {expandedProps._all && (
              <div className="border-t border-ink-700">
                {props.map((prop) => {
                  const open = !!expandedProps[prop.ref_id];
                  const md = propPrompts[prop.ref_id] || '';
                  return (
                    <div key={prop.ref_id}>
                      <div
                        className="flex items-center gap-3 p-3 bg-ink-950/50 border-b border-ink-700 last:border-b-0 cursor-pointer hover:bg-ink-800/30 transition-colors"
                        onClick={() => setExpandedProps(prev => ({ ...prev, [prop.ref_id]: !prev[prop.ref_id] }))}
                      >
                        <span className="text-stone-500 text-xs w-3 text-center transition-transform flex-shrink-0" style={{ transform: open ? 'rotate(90deg)' : 'none' }}>▶</span>
                        <div className="w-10 h-10 rounded bg-ink-700 ring-1 ring-ink-600 flex items-center justify-center text-brass-400 text-lg flex-shrink-0">◇</div>
                        <div className="min-w-0">
                          <span className="text-sm text-stone-200 font-medium">{prop.name || prop.ref_id}</span>
                          {prop.category && <span className="text-xs text-stone-500 ml-2">{prop.category}</span>}
                          {prop.narrative_function && <div className="text-xs text-stone-500 truncate mt-0.5">{prop.narrative_function}</div>}
                        </div>
                        <button
                          onClick={e => { e.stopPropagation(); setEditPropMd(prev => ({ ...prev, [prop.ref_id]: md })); setEditingProp(prev => ({ ...prev, [prop.ref_id]: !prev[prop.ref_id] })); }}
                          className="ml-auto text-stone-500 hover:text-brass-400 transition-colors text-xs px-1.5 py-0.5 rounded cursor-pointer"
                          title={editingProp[prop.ref_id] ? '退出编辑' : '编辑 .md'}
                        >{editingProp[prop.ref_id] ? '✓' : '✎'}</button>
                      </div>
                      {open && (
                        <div className="bg-ink-950 p-4 border-b border-ink-700 space-y-3 text-xs text-stone-300">
                          {editingProp[prop.ref_id] ? (
                            <div className="space-y-2">
                              <textarea
                                className="w-full h-64 bg-ink-900 text-stone-200 text-xs p-3 rounded border border-ink-700 font-mono resize-y"
                                value={editPropMd[prop.ref_id] ?? md}
                                onChange={e => setEditPropMd(prev => ({ ...prev, [prop.ref_id]: e.target.value }))}
                              />
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={async () => {
                                    setSavingProp(prev => ({ ...prev, [prop.ref_id]: true }));
                                    try {
                                      const res = await api(`/pipelines/${pipelineId}/artifacts/props/${encodeURIComponent(prop.ref_id)}.md`, {
                                        method: 'PUT', body: editPropMd[prop.ref_id] ?? md,
                                      });
                                      if (res.ok) {
                                        setPropPrompts(prev => ({ ...prev, [prop.ref_id]: editPropMd[prop.ref_id] ?? md }));
                                        setEditingProp(prev => { const n = {...prev}; delete n[prop.ref_id]; return n; });
                                        load();
                                      }
                                    } catch (_) {}
                                    setSavingProp(prev => ({ ...prev, [prop.ref_id]: false }));
                                  }}
                                  className="px-3 py-1.5 text-xs font-medium bg-leaf-500/20 text-leaf-400 rounded hover:bg-leaf-500/30 transition-colors cursor-pointer"
                                >{savingProp[prop.ref_id] ? '保存中...' : '保存'}</button>
                                <button onClick={() => setEditingProp(prev => { const n = {...prev}; delete n[prop.ref_id]; return n; })}
                                  className="px-3 py-1.5 text-xs text-stone-500 hover:text-stone-300 transition-colors cursor-pointer">取消</button>
                              </div>
                            </div>
                          ) : (
                            <div className="markdown-body max-h-96 overflow-y-auto" dangerouslySetInnerHTML={{__html: DOMPurify.sanitize(marked.parse(md))}} />
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
        {scenes.length > 0 && (
          <div className="bg-ink-900 rounded border border-ink-700 overflow-hidden">
            <div
              className="flex items-center gap-3 p-3 cursor-pointer hover:bg-ink-800 transition-colors"
              onClick={() => setExpandedScenes(prev => ({ ...prev, _all: !prev._all }))}
            >
              <span className="text-stone-500 text-xs w-3 text-center transition-transform flex-shrink-0" style={{ transform: expandedScenes._all ? 'rotate(90deg)' : 'none' }}>▶</span>
              <h4 className="text-sm font-semibold text-stone-300">场景</h4>
            </div>
            {expandedScenes._all && (
              <div className="border-t border-ink-700">
                {scenes.map((scene, si) => {
                  const sceneShots = shots.filter(s => s.full_shot_id?.startsWith(scene.scene_id));
                  const isExpanded = expandedScenes[scene.scene_id] || false;
          return (
            <div key={scene.scene_id} className="bg-ink-900 rounded border border-ink-700 overflow-hidden">
              <div
                className="flex items-center gap-3 p-3 cursor-pointer hover:bg-ink-800 transition-colors"
                onClick={() => toggleScene(scene.scene_id)}
              >
                <span className="text-stone-500 text-xs w-3 text-center transition-transform flex-shrink-0" style={{ transform: isExpanded ? 'rotate(90deg)' : 'none' }}>▶</span>
                <div className="relative w-14 h-9 flex-shrink-0">
                  <img
                    src={`/pipelines/${pipelineId}/artifacts/scenes/${scene.scene_id}_detail.jpg`}
                    alt={scene.scene_id}
                    className="w-14 h-9 object-cover rounded flex-shrink-0 bg-ink-700"
                    onError={e => { e.target.style.display = 'none'; e.target.nextElementSibling?.classList.remove('hidden'); }}
                  />
                  <div className="w-14 h-9 rounded bg-ink-700 flex items-center justify-center text-stone-500 text-xs hidden absolute inset-0">待生成</div>
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-stone-100 text-sm font-medium">{scene.scene_id}</span>
                  <span className="text-stone-500 text-xs ml-2">{sceneShots.length} 镜</span>
                </div>
                <button
                  onClick={e => { e.stopPropagation(); const md = scenePrompts[scene.scene_id] || ''; setEditSceneMd(prev => ({ ...prev, [scene.scene_id]: md })); setEditingScene(prev => ({ ...prev, [scene.scene_id]: !prev[scene.scene_id] })); }}
                  className="text-stone-500 hover:text-brass-400 transition-colors text-xs px-1.5 py-0.5 rounded cursor-pointer flex-shrink-0"
                  title={editingScene[scene.scene_id] ? '退出编辑' : '编辑 .md'}
                >{editingScene[scene.scene_id] ? '✓' : '✎'}</button>
              </div>
              {isExpanded && (
                <div className="border-t border-ink-700">
                  {editingScene[scene.scene_id] ? (
                    <div className="bg-ink-950 p-4 border-b border-ink-700 space-y-2">
                      <textarea
                        className="w-full h-48 bg-ink-900 text-stone-200 text-xs p-3 rounded border border-ink-700 font-mono resize-y"
                        value={editSceneMd[scene.scene_id] ?? scenePrompts[scene.scene_id] ?? ''}
                        onChange={e => setEditSceneMd(prev => ({ ...prev, [scene.scene_id]: e.target.value }))}
                      />
                      <div className="flex items-center gap-2">
                        <button
                          onClick={async () => {
                            setSavingScene(prev => ({ ...prev, [scene.scene_id]: true }));
                            try {
                              const res = await api(`/pipelines/${pipelineId}/artifacts/scenes/${encodeURIComponent(scene.scene_id)}.md`, {
                                method: 'PUT',
                                body: editSceneMd[scene.scene_id] ?? scenePrompts[scene.scene_id] ?? '',
                              });
                              if (res.ok) {
                                setScenePrompts(prev => ({ ...prev, [scene.scene_id]: editSceneMd[scene.scene_id] ?? scenePrompts[scene.scene_id] ?? '' }));
                                setEditingScene(prev => { const n = {...prev}; delete n[scene.scene_id]; return n; });
                                load();
                              }
                            } catch (_) {}
                            setSavingScene(prev => ({ ...prev, [scene.scene_id]: false }));
                          }}
                          className="px-3 py-1.5 text-xs font-medium bg-leaf-500/20 text-leaf-400 rounded hover:bg-leaf-500/30 transition-colors cursor-pointer"
                        >{savingScene[scene.scene_id] ? '保存中...' : '保存'}</button>
                        <button
                          onClick={() => setEditingScene(prev => { const n = {...prev}; delete n[scene.scene_id]; return n; })}
                          className="px-3 py-1.5 text-xs text-stone-500 hover:text-stone-300 transition-colors cursor-pointer"
                        >取消</button>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-ink-950 p-4 border-b border-ink-700 space-y-3 text-xs text-stone-300">
                      <div className="markdown-body max-h-96 overflow-y-auto" dangerouslySetInnerHTML={{__html: scenePrompts[scene.scene_id] ? DOMPurify.sanitize(marked.parse(scenePrompts[scene.scene_id])) : ''}} />
                    </div>
                  )}
                  {sceneShots.map((shot, i) => {
                    const shotOpen = !!expandedShots[shot.full_shot_id];
                    return (
                      <div key={shot.full_shot_id}>
                        <div
                          className="flex items-center gap-3 p-3 bg-ink-950/50 border-b border-ink-700 last:border-b-0 cursor-pointer hover:bg-ink-800/30 transition-colors"
                          onClick={() => toggleShot(shot.full_shot_id)}
                        >
                          <span className="text-stone-500 text-xs w-3 text-center transition-transform flex-shrink-0" style={{ transform: shotOpen ? 'rotate(90deg)' : 'none' }}>▶</span>
                          <img
                            src={`/pipelines/${pipelineId}/artifacts/${shot.startframe_file || `shots/${shot.full_shot_id}/${shot.full_shot_id}_startframe.jpg`}`}
                            alt={shot.full_shot_id}
                            className="w-28 h-16 object-cover rounded flex-shrink-0 bg-ink-700"
                            onError={e => {
                              e.target.style.display = 'none';
                              e.target.src = '';
                              const ph = e.target.parentElement?.querySelector('.startframe-placeholder');
                              if (ph) ph.style.display = 'flex';
                            }}
                          />
                          <div className="w-28 h-16 startframe-placeholder hidden items-center justify-center rounded flex-shrink-0 bg-ink-700 text-stone-500 text-xs">待生成</div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-xs font-bold text-brass-400">{shot.full_shot_id}</span>
                              <span className="text-xs text-stone-400 bg-ink-700 px-1.5 py-0.5 rounded">{shot.transition_type || '-'}</span>
                              <span className="text-xs text-stone-400">{shot.duration_sec != null ? (Number.isInteger(shot.duration_sec) ? shot.duration_sec : shot.duration_sec.toFixed(1)) + '秒' : '-'}</span>
                              {shot.shot_size && <span className="text-xs text-stone-500">{shot.shot_size}</span>}
                            </div>
                            <div className="text-xs text-stone-500 truncate">{shot.action_description || `Scene ${si+1} 第${i+1}镜`}</div>
                          </div>
                          <button
                            onClick={e => { e.stopPropagation(); const md = shotPrompts[shot.full_shot_id] || ''; setEditShotMd(prev => ({ ...prev, [shot.full_shot_id]: md })); setEditingShotMd(prev => ({ ...prev, [shot.full_shot_id]: !prev[shot.full_shot_id] })); }}
                            className="text-stone-500 hover:text-brass-400 transition-colors text-xs px-1.5 py-0.5 rounded cursor-pointer flex-shrink-0"
                            title={editingShotMd[shot.full_shot_id] ? '退出编辑' : '编辑 .md'}
                          >{editingShotMd[shot.full_shot_id] ? '✓' : '✎'}</button>
                        </div>
                        {shotOpen && (
                          <div className="border-t border-ink-700">
                            {editingShotMd[shot.full_shot_id] ? (
                              <div className="bg-ink-950 p-4 space-y-2">
                                <textarea
                                  className="w-full h-64 bg-ink-900 text-stone-200 text-xs p-3 rounded border border-ink-700 font-mono resize-y"
                                  value={editShotMd[shot.full_shot_id] ?? shotPrompts[shot.full_shot_id] ?? ''}
                                  onChange={e => setEditShotMd(prev => ({ ...prev, [shot.full_shot_id]: e.target.value }))}
                                />
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={async () => {
                                      setSavingShotMd(prev => ({ ...prev, [shot.full_shot_id]: true }));
                                      try {
                                        const res = await api(`/pipelines/${pipelineId}/artifacts/shots/${encodeURIComponent(shot.full_shot_id)}/${encodeURIComponent(shot.full_shot_id)}.md`, {
                                          method: 'PUT',
                                          body: editShotMd[shot.full_shot_id] ?? shotPrompts[shot.full_shot_id] ?? '',
                                        });
                                        if (res.ok) {
                                          setShotPrompts(prev => ({ ...prev, [shot.full_shot_id]: editShotMd[shot.full_shot_id] ?? shotPrompts[shot.full_shot_id] ?? '' }));
                                          setEditingShotMd(prev => { const n = {...prev}; delete n[shot.full_shot_id]; return n; });
                                          load();
                                        }
                                      } catch (_) {}
                                      setSavingShotMd(prev => ({ ...prev, [shot.full_shot_id]: false }));
                                    }}
                                    className="px-3 py-1.5 text-xs font-medium bg-leaf-500/20 text-leaf-400 rounded hover:bg-leaf-500/30 transition-colors cursor-pointer"
                                  >{savingShotMd[shot.full_shot_id] ? '保存中...' : '保存'}</button>
                                  <button
                                    onClick={() => setEditingShotMd(prev => { const n = {...prev}; delete n[shot.full_shot_id]; return n; })}
                                    className="px-3 py-1.5 text-xs text-stone-500 hover:text-stone-300 transition-colors cursor-pointer"
                                  >取消</button>
                                </div>
                              </div>
                            ) : (
                              <div className="bg-ink-950 p-4 border-b border-ink-700 space-y-3 text-xs text-stone-300">
                                {shotPrompts[shot.full_shot_id] ? (
                                  <div className="markdown-body max-h-96 overflow-y-auto" dangerouslySetInnerHTML={{__html: DOMPurify.sanitize(marked.parse(shotPrompts[shot.full_shot_id]))}} />
                                ) : (
                                  <>
                                    {shot.action_description && (
                                      <div>
                                        <span className="text-stone-500 font-semibold">动作描述</span>
                                        <div className="markdown-body mt-1" dangerouslySetInnerHTML={{__html: DOMPurify.sanitize(marked.parse(shot.action_description))}} />
                                      </div>
                                    )}
                                    {shot.dialogue_line && (
                                      <div>
                                        <span className="text-stone-500 font-semibold">对白</span>
                                        <div className="markdown-body mt-1 text-brass-400" dangerouslySetInnerHTML={{__html: DOMPurify.sanitize(marked.parse(shot.dialogue_line) )}} />
                                      </div>
                                    )}
                                    {shot.positive_prompt && (
                                      <div>
                                        <span className="text-stone-500 font-semibold">视频 Prompt</span>
                                        <div className="markdown-body mt-1" dangerouslySetInnerHTML={{__html: DOMPurify.sanitize(marked.parse(shot.positive_prompt))}} />
                                      </div>
                                    )}
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
                </div>
              )}
          </div>
        )}
      </div>

      {/* storyboard.json 查看 */}
      <div className="bg-ink-900 rounded border border-ink-700 overflow-hidden mt-4">
        <div
          className="flex items-center gap-3 p-3 cursor-pointer hover:bg-ink-800 transition-colors"
          onClick={() => setExpandedSb(!expandedSb)}
        >
          <span className="text-stone-500 text-xs w-3 text-center transition-transform flex-shrink-0" style={{ transform: expandedSb ? 'rotate(90deg)' : 'none' }}>▶</span>
          <h4 className="text-sm font-semibold text-stone-300">storyboard.json</h4>
          <span className="text-xs text-stone-500 ml-2">{shots.length} 镜 · {characters.length} 角色 · {scenes.length} 场景 · {props.length} 道具</span>
        </div>
        {expandedSb && (
          <div className="border-t border-ink-700 p-4 bg-ink-950">
            <pre className="text-xs text-stone-400 whitespace-pre-wrap font-mono max-h-96 overflow-y-auto bg-ink-900 p-3 rounded">{JSON.stringify(data, null, 2)}</pre>
          </div>
        )}
      </div>
    </div>
  );
}
