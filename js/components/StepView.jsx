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
  if (name.startsWith('props/')) {
    const refId = name.split('/')[1]?.replace(/_reference\.(jpg|jpeg|png|webp)$/, '');
    return refId ? `props/${refId}.md` : null;
  }
  if (name.startsWith('shots/')) {
    const m = name.match(/shots\/([^/]+)\/\1_startframe\./);
    return m ? `shots/${m[1]}/${m[1]}_startframe.md` : null;
  }
  return null;
};

function AssetPreview({ file, pipelineId, cacheBust, aspectClass, onOpen, label }) {
  const isPlaceholder = file?.placeholder;
  return (
    <div className={`relative overflow-hidden bg-ink-950 ${aspectClass}`}>
      {isPlaceholder ? (
        <button
          type="button"
          onClick={() => onOpen(file.name)}
          className="w-full h-full flex flex-col items-center justify-center gap-2 bg-ink-800/70 text-stone-600 hover:bg-ink-700/70 transition-colors"
        >
          <span className="w-9 h-9 rounded-full border border-dashed border-ink-500 flex items-center justify-center text-lg">+</span>
          <span className="text-xs">等待生成</span>
        </button>
      ) : (
        <img
          src={artifactUrl(pipelineId, file.name, cacheBust[file.name])}
          alt={label || file.name.split('/').pop()}
          className="w-full h-full object-cover cursor-pointer transition-transform duration-300 group-hover:scale-[1.03]"
          onError={e => { e.currentTarget.style.display = 'none'; }}
          onClick={() => onOpen(file.name)}
        />
      )}
    </div>
  );
}

function AssetToolbar({ onGenerate, onUpload, onDelete, disabled }) {
  const uploadRef = useRef(null);
  return (
    <div className="absolute top-2 right-2 z-10 flex items-center gap-1 rounded-lg border border-ink-600/80 bg-ink-950/85 p-1 shadow-lg opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
      <button type="button" title="AI 生成" onClick={onGenerate} disabled={disabled} className="w-7 h-7 rounded-md text-brass-400 hover:bg-brass-500 hover:text-ink-950 disabled:opacity-40">✦</button>
      <button type="button" title="本地上传" onClick={() => uploadRef.current?.click()} disabled={disabled} className="w-7 h-7 rounded-md text-stone-300 hover:bg-ink-700 disabled:opacity-40">⇧</button>
      <button type="button" title="删除" onClick={onDelete} disabled={disabled} className="w-7 h-7 rounded-md text-clay-400 hover:bg-clay-500 hover:text-white disabled:opacity-40">⌫</button>
      <input ref={uploadRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={event => { const file = event.target.files?.[0]; if (file) onUpload(file); event.target.value = ''; }} />
    </div>
  );
}

function StepView({ step, pipeline, onRun, actionLoading, pipelineId, onCancel, onRefresh, visualAssetsCompletionKnown, onVisualAssetsCompletionChange,
                    maxShotsPerScene, setMaxShotsPerScene, totalShots, setTotalShots, totalDuration, setTotalDuration }) {
  const getCS = () => {
    if (pipeline.status === 'done') return 5;
    if (pipeline.status === 'failed' || pipeline.status === 'canceled') return Math.max(0, (pipeline.step || 1) - 1);
    const pipelineStep = pipeline.step || 0;
    if (pipelineStep === 1 && visualAssetsCompletionKnown) return 2;
    if (pipelineStep === 2 && !visualAssetsCompletionKnown) return 1;
    return pipelineStep;
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
  const [regeneratingLightbox, setRegeneratingLightbox] = useState(false);
  const [stepReloadKey, setStepReloadKey] = useState(0);
  const [storyboardData, setStoryboardData] = useState(null);
  const [scriptText, setScriptText] = useState(null);
  const [editingScript, setEditingScript] = useState(false);
  const [savingScript, setSavingScript] = useState(false);
  const [assetTab, setAssetTab] = useState('characters');
  const [assetDialog, setAssetDialog] = useState(null);
  const [showAddCharacter, setShowAddCharacter] = useState(false);
  const [newCharacter, setNewCharacter] = useState({ name: '', identity: '', appearance: '', prompt: '', gender: '', age: '', generationMode: 'ai', characterRefs: [], propRefs: [], sceneId: '' });
  const [newEntityFile, setNewEntityFile] = useState(null);
  const [addingCharacter, setAddingCharacter] = useState(false);
  const [assetErrors, setAssetErrors] = useState({});
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
    if (!isStepDone && !isStepRunning && !(step === 2 && canGenerate)) { setArtifacts([]); return; }
    let cancelled = false;
    let t;
    const doFetch = async () => {
      try {
        const res = await api(`/pipelines/${pipelineId}/artifacts`);
        if (res.ok && !cancelled) setArtifacts((await res.json()).files || []);
      } catch (e) { /* ignore */ }
    };
    doFetch();
    if (isStepRunning) {
      t = setInterval(() => { if (!document.hidden) doFetch(); }, 15000);
    }
    return () => { cancelled = true; if (t) clearInterval(t); };
  }, [pipelineId, isStepDone, isStepRunning, step, canGenerate, pipeline.status, stepReloadKey]);
  const refreshArtifacts = useCallback(async () => {
    try {
      setStepReloadKey(k => k + 1);
      const res = await api(`/pipelines/${pipelineId}/artifacts`);
      if (res.ok) setArtifacts((await res.json()).files || []);
    } catch (e) { /* ignore */ }
  }, [pipelineId]);

  // Load storyboard data for step 2 placeholders (independent of actionLoading)
  useEffect(() => {
    if (step !== 2 || storyboardData || artLoading) return;
    let cancelled = false;
    let retries = 0;
    const tryFetch = () => {
      if (cancelled) return;
      api(`/pipelines/${pipelineId}/artifacts/storyboard.json`).then(r => {
        if (r.ok) { r.json().then(d => setStoryboardData(d)); }
        else if (retries++ < 20) { setTimeout(tryFetch, 1500); }
      });
    };
    tryFetch();
    return () => { cancelled = true; };
  }, [step, pipelineId, storyboardData, artLoading]);

  // Load script text
  useEffect(() => {
    if (!pipelineId || step !== 1) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await api(`/pipelines/${pipelineId}/artifacts/script.txt`);
        if (res.ok && !cancelled) setScriptText(await res.text());
      } catch (_) {}
    })();
    return () => { cancelled = true; };
  }, [pipelineId, step]);

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
  const propImages = artifacts.filter(f => f.name.startsWith('props/') && /_reference\.(jpg|jpeg|png|webp)$/i.test(f.name));
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
  const propPlaceholders = React.useMemo(() => {
    if (!storyboardData) return [];
    const propImageNames = new Set(propImages.map(f => f.name));
    const expected = [];
    for (const p of storyboardData.props || []) {
      const name = `props/${p.ref_id}_reference.jpg`;
      if (!propImageNames.has(name)) expected.push({ name, placeholder: true, prop_id: p.ref_id, prop_name: p.name });
    }
    return expected;
  }, [storyboardData, propImages]);
  const allCharImages = [...charImages, ...charPlaceholders];
  const allSceneImages = [...sceneImages, ...scenePlaceholders];
  const allPropImages = [...propImages, ...propPlaceholders];
  const shotImages = artifacts.filter(f => f.name.startsWith('shots/') && /_startframe\.(jpg|jpeg|png|webp)$/i.test(f.name));
  const shotPlaceholders = React.useMemo(() => {
    if (!storyboardData) return [];
    const shotImageNames = new Set(shotImages.map(f => f.name));
    const expected = [];
    for (const s of storyboardData.shots || []) {
      const sf = s.startframe_file;
      const name = sf || `shots/${s.full_shot_id}/${s.full_shot_id}_startframe.jpg`;
      if (!shotImageNames.has(name)) {
        // Also check if any file with same shot_id prefix exists (extension might differ)
        const prefix = `shots/${s.full_shot_id}/${s.full_shot_id}_startframe.`;
        const exists = shotImages.some(f => f.name.startsWith(prefix));
        if (!exists) expected.push({ name, placeholder: true, shot_id: s.full_shot_id });
      }
    }
    return expected;
  }, [storyboardData, shotImages]);
  const allShotImages = [...shotImages, ...shotPlaceholders];
  const videoFiles = artifacts.filter(f => f.name.startsWith('shots/') && /\.(mp4|webm|mov)$/i.test(f.name));
  const audioFiles = artifacts.filter(f => (f.name.startsWith('audio/') || f.name.startsWith('sfx/') || f.name.startsWith('bgm/')) && /\.(wav|mp3|m4a|flac)$/i.test(f.name));
  const finalVideo = artifacts.find(f => f.name === 'final.mp4');
  const characterCards = useMemo(() => (storyboardData?.characters || []).map(character => {
    const images = ['front', 'profile', 'fullbody'].map(angle => {
      const prefix = `characters/${character.ref_id}_${angle}.`;
      return charImages.find(file => file.name.startsWith(prefix)) || {
        name: `characters/${character.ref_id}_${angle}.jpg`, placeholder: true, ref_id: character.ref_id, angle,
      };
    });
    return { ...character, images };
  }), [storyboardData, charImages]);
  const sceneCards = useMemo(() => (storyboardData?.scenes || []).map(scene => {
    const images = ['wide', 'detail'].map(suffix => {
      const prefix = `scenes/${scene.scene_id}_${suffix}.`;
      return sceneImages.find(file => file.name.startsWith(prefix)) || {
        name: `scenes/${scene.scene_id}_${suffix}.jpg`, placeholder: true, scene_id: scene.scene_id, suffix,
      };
    });
    return { ...scene, images };
  }), [storyboardData, sceneImages]);
  const assetOverview = useMemo(() => {
    const count = (items, isComplete, keyFor) => ({
      total: items.length,
      completed: items.filter(isComplete).length,
      generating: items.filter(item => regenerating[keyFor(item)]).length,
      failed: items.filter(item => assetErrors[keyFor(item)]).length,
    });
    return {
      characters: count(characterCards, card => card.images.every(image => !image.placeholder), card => 'char_' + card.ref_id),
      props: count(allPropImages, prop => !prop.placeholder, prop => 'prop_' + (prop.prop_id || prop.name.split('/').pop()?.replace(/_reference\.(jpg|jpeg|png|webp)$/, ''))),
      scenes: count(sceneCards, scene => scene.images.some(image => !image.placeholder), scene => 'scene_' + scene.scene_id),
      shots: count(allShotImages, shot => !shot.placeholder, shot => 'shot_' + (shot.shot_id || shot.name.split('/')[1])),
    };
  }, [characterCards, allPropImages, sceneCards, allShotImages, regenerating, assetErrors]);
  const visualAssetsCompleted = useMemo(() => Boolean(storyboardData) && Object.values(assetOverview).every(section =>
    section.total === section.completed && section.generating === 0 && section.failed === 0
  ), [storyboardData, assetOverview]);

  useEffect(() => {
    if (step === 2) onVisualAssetsCompletionChange?.(visualAssetsCompleted);
  }, [step, visualAssetsCompleted, onVisualAssetsCompletionChange]);

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
  const isPlaceholderInLb = lightboxName && storyboardData && !artifacts.some(a => a.name === lightboxName);

  const closeLightbox = () => { setLightboxName(null); setPromptText(null); setEditPrompt(''); };
  const regenerateFromLightbox = async () => {
    const name = lightboxName;
    if (!name) return;
    setRegeneratingLightbox(true);
    let body = {};
    let regenKey = null;
    if (name.startsWith('characters/')) {
      const label = name.split('/')[1]?.replace(/\.(jpg|jpeg|png)$/, '');
      body = { character_images: [label] };
      regenKey = 'char_' + label;
    } else if (name.startsWith('scenes/')) {
      const label = name.split('/')[1]?.replace(/\.(jpg|jpeg|png)$/, '');
      body = { scene_images: [label] };
      regenKey = 'scene_' + label;
    } else if (name.startsWith('props/')) {
      const label = name.split('/')[1]?.replace(/_reference\.(jpg|jpeg|png|webp)$/, '');
      body = { prop_images: [label] };
      regenKey = 'prop_' + label;
    } else if (name.startsWith('shots/')) {
      const shotId = name.match(/shots\/([^/]+)\//)?.[1];
      if (shotId) body = { shots: [shotId] };
      regenKey = 'shot_' + shotId;
    }
    if (!Object.keys(body).length) { setRegeneratingLightbox(false); return; }
    if (regenKey) setRegenerating(r => ({ ...r, [regenKey]: true }));
    try {
      await api(`/pipelines/${pipelineId}/regenerate`, { method: 'POST', body: JSON.stringify(body) });
      setCacheBust(c => ({ ...c, [name]: Date.now() }));
      await refreshArtifacts();
      onRefresh?.();
    } catch (_) {}
    setRegeneratingLightbox(false);
    if (regenKey) setRegenerating(r => { const n = {...r}; delete n[regenKey]; return n; });
  };

  const regenerateAsset = async (key, body, files = []) => {
    if (regenerating[key]) return;
    setRegenerating(current => ({ ...current, [key]: true }));
    setAssetErrors(current => { const next = { ...current }; delete next[key]; return next; });
    try {
      const response = await api(`/pipelines/${pipelineId}/regenerate`, {
        method: 'POST', body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(await response.text());
      setCacheBust(current => ({
        ...current,
        ...Object.fromEntries(files.filter(file => !file.placeholder).map(file => [file.name, Date.now()])),
      }));
      await refreshArtifacts();
      onRefresh?.();
    } catch (_) {
      setAssetErrors(current => ({ ...current, [key]: true }));
      toast.error('生成失败，请检查服务日志后重试');
    } finally {
      setRegenerating(current => { const next = { ...current }; delete next[key]; return next; });
    }
  };

  const addCharacter = async (event) => {
    event.preventDefault();
    const name = newCharacter.name.trim();
    const appearance = newCharacter.appearance.trim();
    const kind = assetDialog || 'characters';
    if (!name || !appearance) return;
    setAddingCharacter(true);
    try {
      const response = await api(`/pipelines/${pipelineId}/entities`, {
        method: 'POST', body: JSON.stringify({
          kind, name, identity: newCharacter.identity.trim(), appearance,
          prompt: newCharacter.prompt.trim(), gender: newCharacter.gender, age: newCharacter.age,
          character_refs: newCharacter.characterRefs, prop_refs: newCharacter.propRefs, scene_id: newCharacter.sceneId,
          generation_mode: newCharacter.generationMode,
        }),
      });
      if (!response.ok) throw new Error(await response.text());
      const result = await response.json();
      setStoryboardData(current => ({
        ...(current || { scenes: [], props: [], shots: [] }),
        [kind]: [...(current?.[kind] || []), result.entity],
      }));
      const entityId = kind === 'scenes' ? result.entity.scene_id : kind === 'shots' ? result.entity.full_shot_id : result.entity.ref_id;
      if (newCharacter.generationMode === 'upload' && newEntityFile && entityId) {
        await uploadAsset(kind, entityId, newEntityFile);
      }
      setNewCharacter({ name: '', identity: '', appearance: '', prompt: '', gender: '', age: '', generationMode: 'ai', characterRefs: [], propRefs: [], sceneId: '' });
      setNewEntityFile(null);
      setShowAddCharacter(false);
      setAssetDialog(null);
      setAssetTab(kind);
      toast((kind === 'characters' ? '角色' : kind === 'props' ? '道具' : '场景') + '已添加，可使用卡片上的 AI 生成或本地上传。');
    } catch (_) {
      toast.error('添加失败，请稍后重试');
    } finally {
      setAddingCharacter(false);
    }
  };

  const toggleEntityReference = (field, id) => {
    setNewCharacter(current => ({
      ...current,
      [field]: current[field].includes(id)
        ? current[field].filter(value => value !== id)
        : [...current[field], id],
    }));
  };

  const uploadAsset = async (kind, entityId, file) => {
    const form = new FormData();
    form.append('file', file);
    try {
      const response = await fetch(`/pipelines/${pipelineId}/entities/${kind}/${encodeURIComponent(entityId)}/upload`, { method: 'POST', body: form });
      if (!response.ok) throw new Error(await response.text());
      await refreshArtifacts();
      onRefresh?.();
      toast('素材已上传');
    } catch (_) {
      toast.error('上传失败，请确认文件格式后重试');
    }
  };

  const deleteEntity = async (kind, entityId) => {
    const label = kind === 'characters' ? '角色' : kind === 'props' ? '道具' : kind === 'scenes' ? '场景' : '镜头起始帧';
    if (!window.confirm(`确定删除此${label}及其素材吗？此操作不可撤销。`)) return;
    try {
      const response = await api(`/pipelines/${pipelineId}/entities/${kind}/${encodeURIComponent(entityId)}`, { method: 'DELETE' });
      if (!response.ok) throw new Error(await response.text());
      const result = await response.json();
      if (result.status !== 'deleted' || result.entity_id !== entityId) throw new Error('服务端未确认删除');
      const collection = kind === 'characters' ? 'characters' : kind === 'props' ? 'props' : kind === 'scenes' ? 'scenes' : 'shots';
      const idKey = kind === 'characters' || kind === 'props' ? 'ref_id' : kind === 'scenes' ? 'scene_id' : 'full_shot_id';
      setStoryboardData(current => current ? { ...current, [collection]: (current[collection] || []).filter(item => item[idKey] !== entityId) } : current);
      await refreshArtifacts();
      onRefresh?.();
      toast(`${label}已删除`);
    } catch (error) {
      toast.error(`删除失败：${error?.message || '请稍后重试'}`);
    }
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
        <>
          {scriptText !== null && (
            <div className="mb-6 p-4 bg-ink-900/50 rounded border border-ink-700">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-stone-400 font-medium">剧本</p>
                <button
                  onClick={async () => {
                    if (editingScript) {
                      setEditingScript(false);
                    } else {
                      setEditingScript(true);
                    }
                  }}
                  className="text-xs text-stone-500 hover:text-brass-400 transition-colors px-1.5 py-0.5 rounded cursor-pointer"
                >{editingScript ? '✓' : '✎'}</button>
              </div>
              {editingScript ? (
                <div className="space-y-2">
                  <textarea
                    className="w-full h-64 bg-ink-950 text-stone-300 text-xs p-3 rounded border border-ink-700 font-mono resize-y"
                    value={scriptText}
                    onChange={e => setScriptText(e.target.value)}
                  />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={async () => {
                        setSavingScript(true);
                        try {
                          const res = await api(`/pipelines/${pipelineId}/artifacts/script.txt`, {
                            method: 'PUT', body: scriptText,
                          });
                          if (res.ok) setEditingScript(false);
                        } catch (_) {}
                        setSavingScript(false);
                      }}
                      disabled={savingScript}
                      className="px-3 py-1.5 text-xs font-medium bg-leaf-500/20 text-leaf-400 rounded hover:bg-leaf-500/30 transition-colors cursor-pointer disabled:opacity-40"
                    >{savingScript ? '保存中...' : '保存'}</button>
                    <button onClick={() => { setEditingScript(false); setScriptText(scriptText); }}
                      className="px-3 py-1.5 text-xs text-stone-500 hover:text-stone-300 transition-colors cursor-pointer">取消</button>
                  </div>
                </div>
              ) : (
                <pre className="text-xs text-stone-400 whitespace-pre-wrap max-h-48 overflow-y-auto">{scriptText}</pre>
              )}
            </div>
          )}
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
      </>
      )}

      {step === 1 && (isStepDone || isStepRunning) && <StoryboardViewer pipelineId={pipelineId} poll={isStepRunning} reloadKey={stepReloadKey} />}

      {step === 2 && (isStepDone || isStepRunning || canGenerate) && (
        <div className="space-y-5">
          <div className="rounded-xl border border-ink-700 bg-ink-950/45 overflow-hidden">
            <div className="px-4 pt-4 pb-3 border-b border-ink-700/80">
              <p className="text-xs text-stone-500 leading-relaxed">素材按实体归类展示。点击图片可查看和编辑提示词；角色需生成正面、侧面和全身三个视角后才视为完成。</p>
            </div>
            <div className="flex flex-col gap-4 p-4">
              <div className="flex flex-wrap items-center gap-x-1 gap-y-2" role="tablist" aria-label="视觉素材分类">
                {[
                  ['characters', '角色肖像', characterCards.length],
                  ['props', '道具', allPropImages.length],
                  ['scenes', '场景', sceneCards.length],
                  ['shots', '镜头起始帧', allShotImages.length],
                ].map(([key, label, count]) => (
                  <button key={key} type="button" role="tab" aria-selected={assetTab === key} onClick={() => setAssetTab(key)}
                    className={'px-3 py-2 text-sm rounded-lg transition-colors ' + (assetTab === key ? 'bg-brass-500 text-ink-950 font-semibold shadow-sm' : 'text-stone-400 hover:text-stone-100 hover:bg-ink-800')}>
                    {label}<span className={'ml-1.5 text-xs ' + (assetTab === key ? 'text-ink-950/70' : 'text-stone-600')}>{count}</span>
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
                {[
                  [assetTab === 'characters' ? '角色总计' : assetTab === 'props' ? '道具总计' : assetTab === 'scenes' ? '场景总计' : '起始帧总计', assetOverview[assetTab].total, 'text-stone-100'],
                  ['已完成', assetOverview[assetTab].completed, 'text-leaf-400'],
                  ['生成中', assetOverview[assetTab].generating, 'text-brass-400'],
                  ['失败', assetOverview[assetTab].failed, 'text-clay-400'],
                ].map(([label, value, color]) => (
                  <div key={label} className="flex items-baseline gap-1.5"><span className="text-xs text-stone-500">{label}</span><span className={'text-lg leading-none font-semibold ' + color}>{value}</span></div>
                ))}
                <div className="flex-1" />
                <button type="button" onClick={() => { setAssetDialog(assetTab); setNewEntityFile(null); setNewCharacter({ name: '', identity: '', appearance: '', prompt: '', gender: '', age: '', generationMode: 'ai', characterRefs: [], propRefs: [], sceneId: '' }); setShowAddCharacter(true); }} disabled={pipeline.status === 'running'}
                  className="px-3.5 py-2 rounded-lg text-sm font-medium bg-ink-800 border border-ink-600 text-stone-200 hover:border-brass-500 hover:text-brass-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">+ 添加{assetTab === 'characters' ? '角色' : assetTab === 'props' ? '道具' : assetTab === 'scenes' ? '场景' : '起始帧'}</button>
              </div>
            </div>
          </div>

          {assetTab === 'characters' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {characterCards.map(character => {
                const regenKey = 'char_' + character.ref_id;
                const isGenerating = regenerating[regenKey];
                const complete = character.images.every(image => !image.placeholder);
                return (
                  <article key={character.ref_id} className="group overflow-hidden rounded-xl border border-ink-700 bg-ink-900/80 hover:border-ink-600 transition-colors">
                    <div className="relative grid grid-cols-3 gap-px bg-ink-700">
                      {character.images.map((image, index) => (
                        <div key={image.name} className="relative">
                          <AssetPreview file={image} pipelineId={pipelineId} cacheBust={cacheBust} aspectClass="aspect-[3/4]" onOpen={openLightbox} label={(character.name || character.ref_id) + ' ' + ['正面', '侧面', '全身'][index]} />
                          <span className="absolute left-2 bottom-2 px-1.5 py-0.5 rounded bg-ink-950/75 text-[10px] text-stone-300 pointer-events-none">{['正面', '侧面', '全身'][index]}</span>
                        </div>
                      ))}
                      <AssetToolbar onGenerate={() => regenerateAsset(regenKey, { characters: [character.ref_id] }, character.images)} onUpload={file => uploadAsset('characters', character.ref_id, file)} onDelete={() => deleteEntity('characters', character.ref_id)} disabled={isGenerating} />
                    </div>
                    <div className="p-3.5">
                      <div className="flex items-start gap-3">
                        <div className="min-w-0 flex-1"><h4 className="text-sm font-semibold text-stone-100 truncate">{character.name || character.ref_id}</h4><p className="mt-1 text-xs text-stone-500 line-clamp-2">{character.description || character.identity || (complete ? '3 个视角 · 素材已完成' : '等待生成 · 需 3 个视角')}</p></div>
                        <span className={'mt-0.5 w-2 h-2 rounded-full ' + (isGenerating ? 'bg-brass-400 animate-pulse' : assetErrors[regenKey] ? 'bg-clay-400' : complete ? 'bg-leaf-400' : 'bg-stone-600')} />
                      </div>
                      {assetErrors[regenKey] && <p className="mt-2 text-xs text-clay-400">上次生成失败，请重试。</p>}
                      <div className="flex items-center gap-2 mt-3">
                        <button type="button" onClick={() => openLightbox(character.images[0].name)} className="text-xs text-stone-400 hover:text-stone-100 transition-colors">查看提示词</button>
                        <button type="button" onClick={() => regenerateAsset(regenKey, { characters: [character.ref_id] }, character.images)} disabled={isGenerating}
                          className="ml-auto px-2.5 py-1.5 rounded-md text-xs font-medium bg-brass-500/15 text-brass-400 hover:bg-brass-500 hover:text-ink-950 disabled:opacity-50 transition-colors">{isGenerating ? '生成中…' : complete ? '重新生成' : '生成角色'}</button>
                      </div>
                    </div>
                  </article>
                );
              })}
              {characterCards.length === 0 && <div className="sm:col-span-2 xl:col-span-3 py-12 text-center rounded-xl border border-dashed border-ink-700 text-sm text-stone-500">暂无角色。可手动添加一个角色，或先运行步骤 1。</div>}
            </div>
          )}

          {assetTab === 'props' && (
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
              {allPropImages.map(prop => {
                const label = prop.prop_id || prop.name.split('/').pop()?.replace(/_reference\.(jpg|jpeg|png|webp)$/, '');
                const regenKey = 'prop_' + label;
                return (
                  <article key={prop.name} className="group overflow-hidden rounded-xl border border-ink-700 bg-ink-900/80 hover:border-ink-600 transition-colors">
                    <div className="relative"><AssetPreview file={prop} pipelineId={pipelineId} cacheBust={cacheBust} aspectClass="aspect-square" onOpen={openLightbox} label={prop.prop_name || label} /><AssetToolbar onGenerate={() => regenerateAsset(regenKey, { prop_images: [label] }, [prop])} onUpload={file => uploadAsset('props', label, file)} onDelete={() => deleteEntity('props', label)} disabled={regenerating[regenKey]} /></div>
                    <div className="p-3"><div className="flex items-center gap-2"><h4 className="min-w-0 flex-1 text-sm font-medium text-stone-200 truncate">{prop.prop_name || label}</h4><span className={'w-2 h-2 rounded-full ' + (regenerating[regenKey] ? 'bg-brass-400 animate-pulse' : prop.placeholder ? 'bg-stone-600' : assetErrors[regenKey] ? 'bg-clay-400' : 'bg-leaf-400')} /></div><p className="mt-1 text-xs text-stone-500 line-clamp-2">{prop.description || prop.narrative_function || prop.category || '道具设定'}</p>
                      <div className="flex items-center mt-3"><button type="button" onClick={() => regenerateAsset(regenKey, { prop_images: [label] }, [prop])} disabled={regenerating[regenKey]} className="ml-auto px-2.5 py-1.5 rounded-md text-xs font-medium bg-brass-500/15 text-brass-400 hover:bg-brass-500 hover:text-ink-950 disabled:opacity-50 transition-colors">{regenerating[regenKey] ? '生成中…' : prop.placeholder ? '生成道具' : '重新生成'}</button></div>
                    </div>
                  </article>
                );
              })}
              {allPropImages.length === 0 && <div className="col-span-full py-12 text-center rounded-xl border border-dashed border-ink-700 text-sm text-stone-500">剧本中暂无道具设定。</div>}
            </div>
          )}

          {assetTab === 'scenes' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {sceneCards.map(scene => {
                const regenKey = 'scene_' + scene.scene_id;
                const complete = scene.images.some(image => !image.placeholder);
                return (
                  <article key={scene.scene_id} className="group overflow-hidden rounded-xl border border-ink-700 bg-ink-900/80 hover:border-ink-600 transition-colors">
                    <div className="relative grid grid-cols-2 gap-px bg-ink-700">
                      {scene.images.map((image, index) => <div key={image.name} className="relative"><AssetPreview file={image} pipelineId={pipelineId} cacheBust={cacheBust} aspectClass="aspect-video" onOpen={openLightbox} label={scene.scene_id + ' ' + (index === 0 ? '全景' : '细节')} /><span className="absolute left-2 bottom-2 px-1.5 py-0.5 rounded bg-ink-950/75 text-[10px] text-stone-300 pointer-events-none">{index === 0 ? '全景' : '细节'}</span></div>)}
                      <AssetToolbar onGenerate={() => regenerateAsset(regenKey, { scenes: [scene.scene_id] }, scene.images)} onUpload={file => uploadAsset('scenes', scene.scene_id, file)} onDelete={() => deleteEntity('scenes', scene.scene_id)} disabled={regenerating[regenKey]} />
                    </div>
                    <div className="p-3.5 flex items-center gap-3"><div className="min-w-0 flex-1"><h4 className="text-sm font-semibold text-stone-100">{scene.name || scene.scene_id}</h4><p className="mt-1 text-xs text-stone-500 line-clamp-2">{scene.description || (complete ? '场景参考已生成' : '等待生成')}</p></div>
                      <button type="button" onClick={() => regenerateAsset(regenKey, { scenes: [scene.scene_id] }, scene.images)} disabled={regenerating[regenKey]} className="px-2.5 py-1.5 rounded-md text-xs font-medium bg-ink-800 text-stone-300 hover:bg-brass-500 hover:text-ink-950 disabled:opacity-50 transition-colors">{regenerating[regenKey] ? '生成中…' : complete ? '重新生成' : '生成场景'}</button>
                    </div>
                  </article>
                );
              })}
              {sceneCards.length === 0 && <div className="col-span-full py-12 text-center rounded-xl border border-dashed border-ink-700 text-sm text-stone-500">剧本中暂无场景设定。</div>}
            </div>
          )}

          {assetTab === 'shots' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {allShotImages.map(shot => {
                const shotId = shot.shot_id || shot.name.split('/')[1];
                const regenKey = 'shot_' + shotId;
                return (
                  <article key={shot.name} className="group overflow-hidden rounded-xl border border-ink-700 bg-ink-900/80 hover:border-ink-600 transition-colors">
                    <div className="relative"><AssetPreview file={shot} pipelineId={pipelineId} cacheBust={cacheBust} aspectClass="aspect-video" onOpen={openLightbox} label={shotId} /><AssetToolbar onGenerate={() => regenerateAsset(regenKey, { shots: [shotId] }, [shot])} onUpload={file => uploadAsset('shots', shotId, file)} onDelete={() => deleteEntity('shots', shotId)} disabled={regenerating[regenKey]} /></div>
                    <div className="p-3.5 flex items-center gap-3"><div className="min-w-0 flex-1"><h4 className="text-sm font-semibold text-stone-100 truncate">{shotId}</h4><p className="mt-1 text-xs text-stone-500">{shot.placeholder ? '等待生成起始帧' : '起始帧已完成'}</p></div>
                      <button type="button" onClick={() => regenerateAsset(regenKey, { shots: [shotId] }, [shot])} disabled={regenerating[regenKey]} className="px-2.5 py-1.5 rounded-md text-xs font-medium bg-ink-800 text-stone-300 hover:bg-brass-500 hover:text-ink-950 disabled:opacity-50 transition-colors">{regenerating[regenKey] ? '生成中…' : shot.placeholder ? '生成' : '重新生成'}</button>
                    </div>
                  </article>
                );
              })}
              {allShotImages.length === 0 && <div className="col-span-full py-12 text-center rounded-xl border border-dashed border-ink-700 text-sm text-stone-500">暂无镜头起始帧。</div>}
            </div>
          )}

          {showAddCharacter && (
            <div className="fixed inset-0 z-50 bg-ink-950/80 backdrop-blur-sm flex items-center justify-center p-4" onMouseDown={() => !addingCharacter && setShowAddCharacter(false)}>
              <form onSubmit={addCharacter} onMouseDown={event => event.stopPropagation()} className="w-full max-w-2xl rounded-xl border border-ink-600 bg-ink-900 shadow-2xl">
                <div className="flex items-center justify-between px-5 py-4 border-b border-ink-700"><div><h4 className="text-base font-semibold text-stone-100">新增{assetDialog === 'characters' ? '角色' : assetDialog === 'props' ? '道具' : assetDialog === 'scenes' ? '场景' : '镜头起始帧'}</h4><p className="mt-1 text-xs text-stone-500">参考火山引擎设定页：先创建实体，再选择 AI 生成或本地上传素材。</p></div><button type="button" onClick={() => { setShowAddCharacter(false); setAssetDialog(null); }} disabled={addingCharacter} className="w-7 h-7 rounded-md text-stone-500 hover:bg-ink-800 hover:text-stone-200">×</button></div>
                <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[70vh] overflow-y-auto">
                  <label className="block"><span className="text-xs font-medium text-stone-300">{assetDialog === 'characters' ? '名称' : assetDialog === 'props' ? '道具名称' : assetDialog === 'scenes' ? '场景名称' : '起始帧名称'} <span className="text-clay-400">*</span></span><input autoFocus required maxLength="80" value={newCharacter.name} onChange={event => setNewCharacter(current => ({ ...current, name: event.target.value }))} placeholder="请输入" className="mt-1.5 w-full rounded-lg border border-ink-600 bg-ink-950 px-3 py-2.5 text-sm text-stone-100 placeholder:text-stone-600 focus:border-brass-500 focus:outline-none" /></label>
                  {assetDialog === 'characters' && <><label className="block"><span className="text-xs font-medium text-stone-300">性别</span><select value={newCharacter.gender} onChange={event => setNewCharacter(current => ({ ...current, gender: event.target.value }))} className="mt-1.5 w-full rounded-lg border border-ink-600 bg-ink-950 px-3 py-2.5 text-sm text-stone-100 focus:border-brass-500 focus:outline-none"><option value="">请选择</option><option>男</option><option>女</option><option>未知</option></select></label><label className="block"><span className="text-xs font-medium text-stone-300">年龄</span><input value={newCharacter.age} onChange={event => setNewCharacter(current => ({ ...current, age: event.target.value }))} placeholder="例如：28 岁" className="mt-1.5 w-full rounded-lg border border-ink-600 bg-ink-950 px-3 py-2.5 text-sm text-stone-100 placeholder:text-stone-600 focus:border-brass-500 focus:outline-none" /></label><label className="block"><span className="text-xs font-medium text-stone-300">身份 / 关系</span><input maxLength="160" value={newCharacter.identity} onChange={event => setNewCharacter(current => ({ ...current, identity: event.target.value }))} placeholder="例如：刑警队长，主角的姐姐" className="mt-1.5 w-full rounded-lg border border-ink-600 bg-ink-950 px-3 py-2.5 text-sm text-stone-100 placeholder:text-stone-600 focus:border-brass-500 focus:outline-none" /></label></>}
                  <div className="md:col-span-2"><span className="text-xs font-medium text-stone-300">形象生成方式</span><div className="mt-2 flex flex-wrap gap-2">{[['ai', 'AI 生成'], ['upload', '本地上传']].map(([value, label]) => <label key={value} className={'cursor-pointer rounded-lg border px-3 py-2 text-sm ' + (newCharacter.generationMode === value ? 'border-brass-500 bg-brass-500/10 text-brass-400' : 'border-ink-600 text-stone-400')}><input type="radio" className="sr-only" checked={newCharacter.generationMode === value} onChange={() => setNewCharacter(current => ({ ...current, generationMode: value }))} />{label}</label>)}</div></div>
                  {newCharacter.generationMode === 'ai' && <label className="block md:col-span-2"><span className="text-xs font-medium text-stone-300">提示词</span><textarea maxLength="3000" value={newCharacter.prompt} onChange={event => setNewCharacter(current => ({ ...current, prompt: event.target.value }))} placeholder="描述希望生成的视觉效果；为空时将使用下方描述生成提示词。" className="mt-1.5 min-h-24 w-full rounded-lg border border-ink-600 bg-ink-950 px-3 py-2.5 text-sm leading-relaxed text-stone-100 placeholder:text-stone-600 focus:border-brass-500 focus:outline-none resize-y" /></label>}
                  {newCharacter.generationMode === 'upload' && <label className="block md:col-span-2"><span className="text-xs font-medium text-stone-300">上传图片 <span className="text-clay-400">*</span></span><input required type="file" accept="image/png,image/jpeg,image/webp" onChange={event => setNewEntityFile(event.target.files?.[0] || null)} className="mt-1.5 block w-full rounded-lg border border-dashed border-ink-600 bg-ink-950 px-3 py-2 text-sm text-stone-400 file:mr-3 file:rounded-md file:border-0 file:bg-ink-700 file:px-3 file:py-1.5 file:text-sm file:text-stone-200 hover:file:bg-ink-600" /><span className="mt-1 block text-xs text-stone-600">支持 JPG、PNG、WebP，上传后会成为首张参考图。</span></label>}
                  {(assetDialog === 'scenes' || assetDialog === 'shots') && <div className="md:col-span-2 rounded-lg border border-ink-700 bg-ink-950/60 p-3.5"><div><span className="text-xs font-medium text-stone-300">关联素材（可选）</span><p className="mt-1 text-xs text-stone-600">选中的已完成素材会作为图片生成参考，帮助保持角色与道具的一致性。</p></div>
                    {assetDialog === 'shots' && <label className="mt-3 block"><span className="text-xs text-stone-400">关联场景</span><select value={newCharacter.sceneId} onChange={event => setNewCharacter(current => ({ ...current, sceneId: event.target.value }))} className="mt-1.5 w-full rounded-md border border-ink-600 bg-ink-900 px-2.5 py-2 text-sm text-stone-200 focus:border-brass-500 focus:outline-none"><option value="">不指定场景</option>{(storyboardData?.scenes || []).map(scene => <option key={scene.scene_id} value={scene.scene_id}>{scene.name || scene.scene_id}</option>)}</select></label>}
                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3"><div><span className="text-xs text-stone-400">角色</span><div className="mt-1.5 flex flex-wrap gap-1.5">{(storyboardData?.characters || []).length ? (storyboardData.characters || []).map(character => <label key={character.ref_id} className={'cursor-pointer rounded-md border px-2 py-1 text-xs transition-colors ' + (newCharacter.characterRefs.includes(character.ref_id) ? 'border-brass-500 bg-brass-500/10 text-brass-400' : 'border-ink-600 text-stone-400 hover:text-stone-200')}><input type="checkbox" className="sr-only" checked={newCharacter.characterRefs.includes(character.ref_id)} onChange={() => toggleEntityReference('characterRefs', character.ref_id)} />{character.name || character.ref_id}</label>) : <span className="text-xs text-stone-600">暂无可选角色</span>}</div></div><div><span className="text-xs text-stone-400">道具</span><div className="mt-1.5 flex flex-wrap gap-1.5">{(storyboardData?.props || []).length ? (storyboardData.props || []).map(prop => <label key={prop.ref_id} className={'cursor-pointer rounded-md border px-2 py-1 text-xs transition-colors ' + (newCharacter.propRefs.includes(prop.ref_id) ? 'border-brass-500 bg-brass-500/10 text-brass-400' : 'border-ink-600 text-stone-400 hover:text-stone-200')}><input type="checkbox" className="sr-only" checked={newCharacter.propRefs.includes(prop.ref_id)} onChange={() => toggleEntityReference('propRefs', prop.ref_id)} />{prop.name || prop.ref_id}</label>) : <span className="text-xs text-stone-600">暂无可选道具</span>}</div></div></div>
                  </div>}
                  <label className="block md:col-span-2"><span className="text-xs font-medium text-stone-300">{assetDialog === 'characters' ? '角色描述' : assetDialog === 'shots' ? '画面描述' : '设定描述'} <span className="text-clay-400">*</span></span><textarea required maxLength="2000" value={newCharacter.appearance} onChange={event => setNewCharacter(current => ({ ...current, appearance: event.target.value }))} placeholder={assetDialog === 'characters' ? '描述外貌、服装、性格与标志性特征…' : assetDialog === 'shots' ? '描述构图、景别、人物动作、空间与光影…' : '描述用途、外观、材质、空间、氛围等…'} className="mt-1.5 min-h-32 w-full rounded-lg border border-ink-600 bg-ink-950 px-3 py-2.5 text-sm leading-relaxed text-stone-100 placeholder:text-stone-600 focus:border-brass-500 focus:outline-none resize-y" /></label>
                  {assetDialog === 'characters' && <div className="md:col-span-2 flex items-center gap-3 rounded-lg bg-ink-950/70 px-3 py-2.5 text-xs text-stone-500"><span>音色</span><select className="bg-transparent text-stone-300 focus:outline-none"><option>暂不配置</option><option>成熟男声</option><option>温柔女声</option></select><span className="ml-auto">模型：Doubao-Seedream-5.0-Pro · 3:4</span></div>}
                </div>
                <div className="flex justify-end gap-2 px-5 py-4 border-t border-ink-700"><button type="button" onClick={() => { setShowAddCharacter(false); setAssetDialog(null); }} disabled={addingCharacter} className="px-3 py-2 text-sm text-stone-400 hover:text-stone-200 disabled:opacity-50">取消</button><button type="submit" disabled={addingCharacter || !newCharacter.name.trim() || !newCharacter.appearance.trim()} className="px-4 py-2 rounded-lg bg-brass-500 text-sm font-medium text-ink-950 hover:bg-brass-400 disabled:opacity-50 disabled:cursor-not-allowed">{addingCharacter ? '添加中…' : '确认添加'}</button></div>
              </form>
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

      {!isStepDone && !isStepRunning && !(step === 2 && canGenerate) && (
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
              {isPlaceholderInLb ? (
                <div className="max-h-[70vh] max-w-full lg:max-w-[50vw] min-w-[280px] flex flex-col items-center justify-center rounded bg-ink-800 border border-dashed border-ink-600" style={{ aspectRatio: '16/9' }}>
                  <span className="text-stone-600 text-2xl">?</span>
                  <span className="text-stone-600 text-xs mt-1">待生成</span>
                </div>
              ) : (
                <img
                  key={cacheBust[lightboxName] || ''}
                  src={artifactUrl(pipelineId, lightboxName, cacheBust[lightboxName])}
                  className="max-h-[70vh] max-w-full lg:max-w-[50vw] object-contain rounded"
                  alt="放大预览"
                  onError={e => { e.target.style.display = 'none'; }}
                />
              )}
              {regeneratingLightbox && (
                <div className="absolute inset-0 bg-ink-950/70 rounded flex items-center justify-center">
                  <div className="w-8 h-8 border-2 border-brass-400 border-t-transparent rounded-full animate-spin" />
                </div>
              )}
              {lightboxName && (
                <button
                  onClick={regenerateFromLightbox}
                  disabled={regeneratingLightbox}
                  className="absolute top-2 right-2 w-8 h-8 rounded bg-ink-900/80 hover:bg-brass-500/80 text-stone-400 hover:text-ink-950 flex items-center justify-center text-sm transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
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
