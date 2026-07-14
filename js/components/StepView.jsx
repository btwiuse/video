const { useState, useEffect, useRef, useCallback, useMemo } = React;

const promptPathFromImage = (name) => {
  if (name.startsWith('characters/')) {
    const refId = name.split('/')[1]?.replace(/_(front|profile|fullbody)\.(jpg|jpeg|png)$/, '');
    return refId ? `characters/${refId}.md` : null;
  }
  if (name.startsWith('scenes/')) {
    const sid = name.split('/')[1]?.replace(/_(wide|detail)\.(jpg|jpeg|png)$/, '');
    return sid ? `scenes/${sid}.md` : null;
  }
  if (name.startsWith('shots/')) {
    const m = name.match(/shots\/([^/]+)\/\1_startframe\./);
    return m ? `shots/${m[1]}/${m[1]}_startframe.md` : null;
  }
  return null;
};

function StepView({ step, pipeline, onRun, actionLoading, pipelineId, onCancel,
                    maxShotsPerScene, setMaxShotsPerScene, totalShots, setTotalShots, totalDuration, setTotalDuration }) {
  const getCS = () => {
    if (pipeline.status === 'done') return 5;
    if (pipeline.status === 'failed' || pipeline.status === 'canceled') return Math.max(0, (pipeline.step || 1) - 1);
    return pipeline.step || 0;
  };
  const currentStep = getCS();
  const isStepDone = step <= currentStep || pipeline.status === 'done';
  const isStepRunning = pipeline.status === 'running' && pipeline.step === step;
  const canGenerate = (step === currentStep + 1 || step <= currentStep) && !actionLoading;
  const [artifacts, setArtifacts] = useState([]);
  const [artLoading, setArtLoading] = useState(false);
  const [previews, setPreviews] = useState({});
  const [regenerating, setRegenerating] = useState({});
  const [cacheBust, setCacheBust] = useState({});
  const [lightboxName, setLightboxName] = useState(null);
  const [promptText, setPromptText] = useState(null);
  const [editPrompt, setEditPrompt] = useState('');
  const [promptLoading, setPromptLoading] = useState(false);
  const [promptSaving, setPromptSaving] = useState(false);
  const [editingLightbox, setEditingLightbox] = useState(false);
  const [stepReloadKey, setStepReloadKey] = useState(0);
  const [storyboardData, setStoryboardData] = useState(null);
  const prevPipelineRef = useRef(pipeline);
  const textareaRef = useRef(null);

  useEffect(() => {
    const prev = prevPipelineRef.current;
    prevPipelineRef.current = pipeline;
    if (prev && prev.status !== pipeline.status) {
      setStepReloadKey(k => k + 1);
    }
  }, [pipeline, pipeline.status]);

  useEffect(() => {
    if (!isStepDone && !isStepRunning) { setArtifacts([]); return; }
    let cancelled = false;
    let t;
    const fetchArtifacts = async () => {
      try {
        const res = await api(`/pipelines/${pipelineId}/artifacts`);
        if (res.ok && !cancelled) setArtifacts((await res.json()).files || []);
      } catch (e) { /* ignore */ }
    };
    fetchArtifacts();
    if (isStepRunning) {
      t = setInterval(() => { if (!document.hidden) fetchArtifacts(); }, 15000);
    }
    const prevStep = prevPipelineRef.current?.step;
    if (!storyboardData && step === 2 && !artLoading && (isStepDone || isStepRunning)) {
      api(`/pipelines/${pipelineId}/artifacts/storyboard.json`).then(r => r.ok && r.json().then(d => setStoryboardData(d)));
    }
    return () => { cancelled = true; if (t) clearInterval(t); };
  }, [pipelineId, isStepDone, isStepRunning, pipeline.status, stepReloadKey]);

  const previewUrl = async (name) => {
    if (previews[name]) { setPreviews(p => { const n = {...p}; delete n[name]; return n; }); return; }
    try {
      const res = await api(`/pipelines/${pipelineId}/artifacts/${encodeURIComponent(name)}`);
      if (!res.ok) return;
      const blob = await res.blob();
      setPreviews(p => ({ ...p, [name]: URL.createObjectURL(blob) }));
    } catch (e) { /* ignore */ }
  };

  const charImages = artifacts.filter(f => f.name.startsWith('characters/') && /\.(jpg|jpeg|png|webp)$/i.test(f.name));
  const sceneImages = artifacts.filter(f => f.name.startsWith('scenes/') && /\.(jpg|jpeg|png|webp)$/i.test(f.name));
  const charPlaceholders = React.useMemo(() => {
    if (!storyboardData) return [];
    const charImageNames = new Set(charImages.map(f => f.name));
    const expected = [];
    for (const c of storyboardData.characters || []) {
      for (const suffix of ['front', 'profile', 'fullbody']) {
        const name = `characters/${c.ref_id}_${suffix}.jpg`;
        if (!charImageNames.has(name)) expected.push({ name, placeholder: true, ref_id: c.ref_id, angle: suffix });
      }
    }
    return expected;
  }, [storyboardData, charImages]);
  const scenePlaceholders = React.useMemo(() => {
    if (!storyboardData) return [];
    const sceneImageNames = new Set(sceneImages.map(f => f.name));
    const expected = [];
    for (const s of storyboardData.scenes || []) {
      for (const suffix of ['wide', 'detail']) {
        const name = `scenes/${s.scene_id}_${suffix}.jpg`;
        if (!sceneImageNames.has(name)) expected.push({ name, placeholder: true, scene_id: s.scene_id, suffix });
      }
    }
    return expected;
  }, [storyboardData, sceneImages]);
  const allCharImages = [...charImages, ...charPlaceholders];
  const allSceneImages = [...sceneImages, ...scenePlaceholders];
  const shotImages = artifacts.filter(f => f.name.startsWith('shots/') && /_startframe\.(jpg|jpeg|png|webp)$/i.test(f.name));
  const shotPlaceholders = React.useMemo(() => {
    if (!storyboardData) return [];
    const shotImageNames = new Set(shotImages.map(f => f.name));
    const expected = [];
    for (const s of storyboardData.shots || []) {
      const sf = s.startframe_file;
      const name = sf || `shots/${s.full_shot_id}/${s.full_shot_id}_startframe.jpg`;
      if (!shotImageNames.has(name)) expected.push({ name, placeholder: true, shot_id: s.full_shot_id });
    }
    return expected;
  }, [storyboardData, shotImages]);
  const allShotImages = [...shotImages, ...shotPlaceholders];
  const videoFiles = artifacts.filter(f => f.name.startsWith('shots/') && /\.(mp4|webm|mov)$/i.test(f.name));
  const audioFiles = artifacts.filter(f => (f.name.startsWith('audio/') || f.name.startsWith('sfx/') || f.name.startsWith('bgm/')) && /\.(wav|mp3|m4a|flac)$/i.test(f.name));
  const finalVideo = artifacts.find(f => f.name === 'final.mp4');

  const openLightbox = async (name) => {
    setLightboxName(name);
    setPromptText(null);
    setEditPrompt('');
    setPromptLoading(true);
    const pp = promptPathFromImage(name);
    if (pp) {
      try {
        const cb = cacheBust[name];
        const enc = pp.split('/').map(s => encodeURIComponent(s)).join('/');
        const res = await api(`/pipelines/${pipelineId}/artifacts/${enc}${cb ? '?ck=' + cb : ''}`);
        if (res.ok) { const t = await res.text(); setPromptText(t); setEditPrompt(t); }
      } catch (_) {}
    }
    setPromptLoading(false);
  };
  const closeLightbox = () => { setLightboxName(null); setPromptText(null); setEditPrompt(''); };
  const regenerateFromLightbox = async () => {
    const name = lightboxName;
    if (!name) return;
    let body = {};
    if (name.startsWith('characters/')) {
      const label = name.split('/')[1]?.replace(/\.(jpg|jpeg|png)$/, '');
      body = { character_images: [label] };
    } else if (name.startsWith('scenes/')) {
      const label = name.split('/')[1]?.replace(/\.(jpg|jpeg|png)$/, '');
      body = { scene_images: [label] };
    } else if (name.startsWith('shots/')) {
      const shotId = name.match(/shots\/([^/]+)\//)?.[1];
      if (shotId) body = { shots: [shotId] };
    }
    if (!Object.keys(body).length) return;
    try {
      await api(`/pipelines/${pipelineId}/regenerate`, { method: 'POST', body: JSON.stringify(body) });
      setCacheBust(c => ({ ...c, [name]: Date.now() }));
    } catch (_) {}
  };

  return (
    <div className="bg-ink-800/30 border border-ink-700 rounded p-6 mb-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="font-heading text-lg font-semibold text-stone-100">
            步骤 {step}: {STEP_NAMES[step]}
          </h3>
          <p className="text-xs text-stone-500 mt-1">
            {isStepDone ? '已完成' : isStepRunning ? '正在生成...' : canGenerate ? '准备就绪' : '前置步骤尚未完成'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isStepRunning && (
            <button
              onClick={() => onCancel && onCancel()}
              className="px-4 py-2.5 rounded text-sm font-medium bg-clay-500/20 text-clay-400 hover:bg-clay-500/30 transition-all"
            >
              停止
            </button>
          )}
          <button
            onClick={() => onRun(step)}
            disabled={!canGenerate || isStepRunning}
            className={`px-5 py-2.5 rounded text-sm font-medium transition-all ${
              isStepRunning
                ? 'bg-brass-500 text-ink-950 animate-pulse-brass'
                : canGenerate
                  ? 'bg-brass-500 hover:bg-brass-400 text-ink-950 cursor-pointer'
                  : 'bg-ink-700 text-stone-500 cursor-not-allowed'
            }`}
          >
            {isStepRunning ? '⏳ 生成中...' : isStepDone ? '重新生成' : 'Generate'}
          </button>
        </div>
      </div>

      {step === 1 && canGenerate && !isStepRunning && (
        <div className="mb-6 p-4 bg-ink-900/50 rounded border border-ink-700 space-y-3">
          <p className="text-xs text-stone-400 font-medium">分镜参数</p>
          <div className="flex items-center gap-4">
            <label className="text-xs text-stone-400 w-28 flex-shrink-0">每场景最多镜头</label>
            <input type="range" min="1" max="20" value={maxShotsPerScene}
              onChange={e => setMaxShotsPerScene(parseInt(e.target.value))}
              className="flex-1 accent-brass-500 h-1.5" />
            <span className="text-xs text-stone-200 w-6 text-right">{maxShotsPerScene}</span>
          </div>
          <div className="flex items-center gap-4">
            <label className="text-xs text-stone-400 w-28 flex-shrink-0">总镜头数上限</label>
            <input type="range" min="1" max="60" value={totalShots}
              onChange={e => setTotalShots(parseInt(e.target.value))}
              className="flex-1 accent-brass-500 h-1.5" />
            <span className="text-xs text-stone-200 w-6 text-right">{totalShots}</span>
          </div>
          <div className="flex items-center gap-4">
            <label className="text-xs text-stone-400 w-28 flex-shrink-0">总时长（秒）</label>
            <input type="range" min="1" max="60" value={totalDuration}
              onChange={e => setTotalDuration(parseInt(e.target.value))}
              className="flex-1 accent-brass-500 h-1.5" />
            <span className="text-xs text-stone-200 w-6 text-right">{totalDuration}s</span>
          </div>
        </div>
      )}

      {step === 1 && (isStepDone || isStepRunning) && <StoryboardViewer pipelineId={pipelineId} poll={isStepRunning} reloadKey={stepReloadKey} />}

      {step === 2 && (isStepDone || isStepRunning) && (
        <div className="space-y-6">
          {allCharImages.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-stone-300 mb-3">角色肖像</h4>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {allCharImages.map(f => {
                  const label = f.name.split('/')[1]?.replace(/\.(jpg|jpeg|png)$/, '');
                  const isRegen = regenerating['char_' + label];
                  const cb = cacheBust[f.name];
                  const isPlaceholder = f.placeholder;
                  return (
                    <div key={f.name + (cb || '')} className="flex flex-col items-center gap-1.5 group relative">
                      <div className="relative w-full aspect-[3/4]">
                        {isPlaceholder ? (
                          <div className="w-full h-full rounded bg-ink-800 border border-dashed border-ink-600 flex flex-col items-center justify-center">
                            <span className="text-stone-600 text-2xl">?</span>
                            <span className="text-stone-600 text-xs mt-1">待生成</span>
                          </div>
                        ) : (
                          <img
                            src={artifactUrl(pipelineId, f.name, cb)}
                            alt={f.name.split('/').pop()}
                            className="w-full h-full object-cover rounded bg-ink-700 cursor-pointer"
                            onError={e => { e.target.style.display = 'none'; }}
                            onClick={() => openLightbox(f.name)}
                          />
                        )}
                        {!isPlaceholder && isRegen && (
                          <div className="absolute inset-0 bg-ink-950/70 rounded flex items-center justify-center">
                            <div className="w-6 h-6 border-2 border-brass-400 border-t-transparent rounded-full animate-spin" />
                          </div>
                        )}
                      </div>
                      <span className="text-xs text-stone-500 truncate max-w-full">{f.name.split('/').pop()?.replace(/\.(jpg|jpeg|png)$/, '')}</span>
                      {!isPlaceholder && (
                        <button
                          onClick={async () => {
                            if (isRegen) return;
                            setRegenerating(r => ({ ...r, ['char_' + label]: true }));
                            try {
                              await api(`/pipelines/${pipelineId}/regenerate`, {
                                method: 'POST',
                                body: JSON.stringify({ character_images: [label] }),
                              });
                              setCacheBust(c => ({ ...c, [f.name]: Date.now() }));
                            } catch (e) { /* ignore */ }
                            setRegenerating(r => { const n = {...r}; delete n['char_' + label]; return n; });
                          }}
                          className="absolute top-1 right-1 w-7 h-7 rounded bg-ink-900/80 hover:bg-brass-500/80 text-stone-400 hover:text-ink-950 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-all cursor-pointer disabled:opacity-0"
                          disabled={isRegen}
                          title="重新生成此角色"
                        >⟳</button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {allSceneImages.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-stone-300 mb-3">场景参考</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {allSceneImages.map(f => {
                  const label = f.name.split('/')[1]?.replace(/\.(jpg|jpeg|png)$/, '');
                  const isRegen = regenerating['scene_' + label];
                  const cb = cacheBust[f.name];
                  const isPlaceholder = f.placeholder;
                  return (
                    <div key={f.name + (cb || '')} className="group relative">
                      <div className="relative w-full aspect-video">
                        {isPlaceholder ? (
                          <div className="w-full h-full rounded bg-ink-800 border border-dashed border-ink-600 flex flex-col items-center justify-center">
                            <span className="text-stone-600 text-2xl">?</span>
                            <span className="text-stone-600 text-xs mt-1">待生成</span>
                          </div>
                        ) : (
                          <img
                            src={artifactUrl(pipelineId, f.name, cb)}
                            alt={f.name.split('/').pop()}
                            className="w-full h-full object-cover rounded bg-ink-700 cursor-pointer"
                            onError={e => { e.target.style.display = 'none'; }}
                            onClick={() => openLightbox(f.name)}
                          />
                        )}
                        {!isPlaceholder && isRegen && (
                          <div className="absolute inset-0 bg-ink-950/70 rounded flex items-center justify-center">
                            <div className="w-6 h-6 border-2 border-brass-400 border-t-transparent rounded-full animate-spin" />
                          </div>
                        )}
                      </div>
                      <span className="text-xs text-stone-500 mt-1 block">{f.name.split('/').pop()?.replace(/\.(jpg|jpeg|png)$/, '')}</span>
                      {!isPlaceholder && (
                        <button
                          onClick={async () => {
                            if (isRegen) return;
                            setRegenerating(r => ({ ...r, ['scene_' + label]: true }));
                            try {
                              await api(`/pipelines/${pipelineId}/regenerate`, {
                                method: 'POST',
                                body: JSON.stringify({ scene_images: [label] }),
                              });
                              setCacheBust(c => ({ ...c, [f.name]: Date.now() }));
                            } catch (e) { /* ignore */ }
                            setRegenerating(r => { const n = {...r}; delete n['scene_' + label]; return n; });
                          }}
                          className="absolute top-1 right-1 w-7 h-7 rounded bg-ink-900/80 hover:bg-brass-500/80 text-stone-400 hover:text-ink-950 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-all cursor-pointer disabled:opacity-0"
                          disabled={isRegen}
                          title="重新生成此场景"
                        >⟳</button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {allCharImages.length === 0 && allSceneImages.length === 0 && <p className="text-stone-500 text-sm">暂无视觉素材</p>}
          {allShotImages.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-stone-300 mb-3">镜头起始帧</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {allShotImages.map(f => {
                  const shotId = f.placeholder ? f.shot_id : f.name.split('/')[1];
                  const isRegen = regenerating['shot_' + shotId];
                  const cb = cacheBust[f.name];
                  const isPlaceholder = f.placeholder;
                  return (
                    <div key={f.name + (cb || '')} className="flex flex-col items-center gap-1.5 group relative">
                      <div className="relative w-full aspect-video">
                        {isPlaceholder ? (
                          <div className="w-full h-full rounded bg-ink-800 border border-dashed border-ink-600 flex flex-col items-center justify-center">
                            <span className="text-stone-600 text-2xl">?</span>
                            <span className="text-stone-600 text-xs mt-1">待生成</span>
                          </div>
                        ) : (
                          <img
                            src={artifactUrl(pipelineId, f.name, cb)}
                            alt={f.name.split('/').pop()}
                            className="w-full h-full object-cover rounded bg-ink-700 cursor-pointer"
                            onError={e => { e.target.style.display = 'none'; }}
                            onClick={() => openLightbox(f.name)}
                          />
                        )}
                        {!isPlaceholder && isRegen && (
                          <div className="absolute inset-0 bg-ink-950/70 rounded flex items-center justify-center">
                            <div className="w-6 h-6 border-2 border-brass-400 border-t-transparent rounded-full animate-spin" />
                          </div>
                        )}
                      </div>
                      <span className="text-xs text-stone-500 truncate max-w-full">{shotId}</span>
                      {!isPlaceholder && (
                        <button
                          onClick={async () => {
                            if (isRegen) return;
                            setRegenerating(r => ({ ...r, ['shot_' + shotId]: true }));
                            try {
                              await api(`/pipelines/${pipelineId}/regenerate`, {
                                method: 'POST',
                                body: JSON.stringify({ shots: [shotId] }),
                              });
                              setCacheBust(c => ({ ...c, [f.name]: Date.now() }));
                            } catch (e) { /* ignore */ }
                            setRegenerating(r => { const n = {...r}; delete n['shot_' + shotId]; return n; });
                          }}
                          className="absolute top-1 right-1 w-7 h-7 rounded bg-ink-900/80 hover:bg-brass-500/80 text-stone-400 hover:text-ink-950 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-all cursor-pointer disabled:opacity-0"
                          disabled={isRegen}
                          title="重新生成此镜头"
                        >⟳</button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {step === 3 && (isStepDone || isStepRunning) && (
        <div>
          {videoFiles.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {videoFiles.map(f => (
                <div key={f.name}>
                  <p className="text-xs text-stone-400 mb-1.5 truncate">{f.name.split('/').slice(0,2).join('/')}</p>
                  <video
                    src={`/pipelines/${pipelineId}/artifacts/${encodeURIComponent(f.name)}`}
                    controls
                    className="w-full rounded bg-ink-950"
                    preload="metadata"
                  />
                </div>
              ))}
            </div>
          ) : (
            <p className="text-stone-500 text-sm">暂无视频片段</p>
          )}
        </div>
      )}

      {step === 4 && (isStepDone || isStepRunning) && (
        <div>
          {audioFiles.length > 0 ? (
            <div className="space-y-3">
              {audioFiles.map(f => (
                <div key={f.name} className="flex items-center gap-3 bg-ink-900 rounded p-3 border border-ink-700">
                  <span className="text-stone-400 text-xs font-mono flex-shrink-0">🔊</span>
                  <span className="text-stone-200 text-sm flex-1 min-w-0 truncate">{f.name}</span>
                  <audio
                    src={`/pipelines/${pipelineId}/artifacts/${encodeURIComponent(f.name)}`}
                    controls
                    className="h-8 max-w-[200px]"
                    preload="none"
                  />
                </div>
              ))}
            </div>
          ) : (
            <p className="text-stone-500 text-sm">暂无音频文件</p>
          )}
        </div>
      )}

      {step === 5 && (isStepDone || isStepRunning) && (
        <div>
          {finalVideo ? (
            <div>
              <video
                src={`/pipelines/${pipelineId}/artifacts/final.mp4`}
                controls
                className="w-full rounded bg-ink-950 max-h-[500px]"
              />
              <p className="text-xs text-stone-500 mt-2">{(finalVideo.size / 1024 / 1024).toFixed(1)} MB</p>
            </div>
          ) : (
            <p className="text-stone-500 text-sm">暂无最终影片</p>
          )}
        </div>
      )}

      {!isStepDone && !isStepRunning && (
        <div className="text-center py-8 text-stone-500 text-sm border border-dashed border-ink-700 rounded">
          此步骤尚未执行
        </div>
      )}
      {lightboxName && (
        <div
          className="fixed inset-0 z-50 bg-ink-950/90 flex items-center justify-center p-4 cursor-pointer"
          onClick={closeLightbox}
          onKeyDown={e => { if (e.key === 'Escape') closeLightbox(); }}
          tabIndex={-1}
          ref={el => { if (el) el.focus(); }}
        >
          <button
            onClick={closeLightbox}
            className="absolute top-4 right-4 w-8 h-8 rounded-full bg-ink-900/80 hover:bg-clay-500/80 text-stone-400 hover:text-white flex items-center justify-center text-sm transition-all cursor-pointer z-10"
          >✕</button>
          <div className="flex flex-col lg:flex-row gap-4 max-w-full max-h-full items-start cursor-default" onClick={e => e.stopPropagation()}>
            <div className="relative">
              <img
                src={artifactUrl(pipelineId, lightboxName, cacheBust[lightboxName])}
                className="max-h-[70vh] max-w-full lg:max-w-[50vw] object-contain rounded"
                alt="放大预览"
              />
              {lightboxName && !lightboxName.includes('placeholder') && (
                <button
                  onClick={regenerateFromLightbox}
                  className="absolute top-2 right-2 w-8 h-8 rounded bg-ink-900/80 hover:bg-brass-500/80 text-stone-400 hover:text-ink-950 flex items-center justify-center text-sm transition-all cursor-pointer"
                  title="重新生成"
                >⟳</button>
              )}
            </div>
            {promptText !== null && (
              <div className="bg-ink-900/95 border border-ink-700 rounded p-4 self-stretch max-h-[70vh] overflow-y-auto min-w-[280px] max-w-full lg:max-w-[40vw] flex flex-col gap-3 min-h-0">
                <div className="flex items-center justify-between flex-shrink-0">
                  <h4 className="text-xs text-stone-400 font-medium">生成提示词</h4>
                  {editingLightbox ? (
                    <div className="flex items-center gap-2">
                      <button onClick={async () => {
                        const pp = promptPathFromImage(lightboxName);
                        if (!pp) return;
                        setPromptSaving(true);
                        const val = textareaRef.current?.value ?? editPrompt;
                        const enc = pp.split('/').map(s => encodeURIComponent(s)).join('/');
                        const res = await api(`/pipelines/${pipelineId}/artifacts/${enc}`, { method: 'PUT', body: val });
                        if (res.ok) { setPromptText(val); setEditPrompt(val); }
                        setPromptSaving(false);
                        setEditingLightbox(false);
                      }} disabled={promptSaving} className="text-xs px-2 py-1 bg-leaf-500/20 text-leaf-400 rounded hover:bg-leaf-500/30 transition-colors disabled:opacity-40 cursor-pointer">
                        {promptSaving ? '保存中...' : '保存'}
                      </button>
                      <button onClick={() => { setEditingLightbox(false); }}
                        className="text-xs px-2 py-1 bg-ink-700 text-stone-400 rounded hover:bg-ink-600 transition-colors cursor-pointer">取消</button>
                    </div>
                  ) : (
                    <button onClick={() => { setEditingLightbox(true); }}
                      className="w-6 h-6 rounded bg-ink-700 hover:bg-brass-500/30 text-stone-400 hover:text-brass-400 flex items-center justify-center text-sm transition-all cursor-pointer"
                      title="编辑 .md">✎</button>
                  )}
                </div>
                {editingLightbox ? (
                  <div className="flex-1 min-h-0 overflow-y-auto">
                    <textarea
                      ref={textareaRef}
                      key={lightboxName}
                      defaultValue={editPrompt}
                      className="w-full h-full bg-ink-950 text-stone-300 text-xs p-3 rounded border border-ink-700 font-mono resize-y"
                    />
                  </div>
                ) : (
                  <div className="markdown-body flex-1 min-h-0 overflow-y-auto">
                    <div dangerouslySetInnerHTML={{__html: DOMPurify.sanitize(marked.parse(promptText))}} />
                  </div>
                )}
              </div>
            )}
            {promptLoading && (
              <div className="bg-ink-900/95 border border-ink-700 rounded p-4 min-w-[280px]">
                <p className="text-xs text-stone-500">加载提示词中...</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
