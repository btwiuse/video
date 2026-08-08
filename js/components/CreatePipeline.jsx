const { useState, useEffect, useRef, useCallback, useMemo } = React;

function CreatePipeline({ onCreated }) {
  const [scriptFile, setScriptFile] = useState(null);
  const [scriptText, setScriptText] = useState('');
  const [stylePresets, setStylePresets] = useState([]);
  const [selectedStyleId, setSelectedStyleId] = useState('');
  const [stylesLoading, setStylesLoading] = useState(true);
  const [imageModels, setImageModels] = useState([]);
  const [videoModels, setVideoModels] = useState([]);
  const [imageModelId, setImageModelId] = useState('');
  const [videoModelId, setVideoModelId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef();

  useEffect(() => {
    let active = true;
    api('/style-presets')
      .then(res => res.ok ? res.json() : Promise.reject(new Error('风格预设加载失败')))
      .then(data => {
        if (!active) return;
        const presets = data.presets || [];
        setStylePresets(presets);
        const initial = presets.find(preset => preset.is_default) || presets[0];
        setSelectedStyleId(initial?.id || '');
      })
      .catch(() => { if (active) setStylePresets([]); })
      .finally(() => { if (active) setStylesLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    api('/models').then(res => res.ok ? res.json() : Promise.reject(new Error('模型目录加载失败'))).then(data => {
      if (!active) return;
      const images = data.image_models || [];
      const videos = data.video_models || [];
      setImageModels(images); setVideoModels(videos);
      setImageModelId(images[0]?.id || ''); setVideoModelId(videos[0]?.id || '');
    }).catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, []);

  const selectedStyle = stylePresets.find(preset => preset.id === selectedStyleId);

  const handleFile = (e) => {
    const f = e.target.files[0];
    if (f) {
      setScriptFile(f);
      const reader = new FileReader();
      reader.onload = (ev) => setScriptText(ev.target.result);
      reader.readAsText(f);
    }
  };

  const submit = async () => {
    setError('');
    if (!scriptFile && !scriptText.trim()) {
      setError('请上传剧本文件或输入剧本内容');
      return;
    }
    setSubmitting(true);
    try {
      const fd = new FormData();
      if (scriptFile) {
        fd.append('script', scriptFile, scriptFile.name || 'script.txt');
      } else {
        const blob = new Blob([scriptText], { type: 'text/plain' });
        fd.append('script', blob, 'script.txt');
      }
      if (selectedStyleId) fd.append('style_preset_id', selectedStyleId);

      if (imageModelId) fd.append('image_model_id', imageModelId);
      if (videoModelId) fd.append('video_model_id', videoModelId);
      const organizationId = getActiveOrganizationId();
      if (organizationId) fd.append('organization_id', organizationId);
      const res = await fetch(`${API_BASE}/pipelines`, { method: 'POST', body: fd, credentials: 'same-origin' });
      if (!res.ok) { const txt = await res.text(); throw new Error(txt || `HTTP ${res.status}`); }
      const data = await res.json();
      onCreated(data.pipeline_id);
    } catch (e) { setError(e.message); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="bg-ink-900 rounded-2xl p-5 sm:p-8 border border-ink-700 shadow-sm">
      <p className="text-[11px] font-medium tracking-wide text-brass-500">NEW PROJECT</p>
      <h2 className="mt-1 font-heading text-2xl font-semibold text-stone-100">创建短剧项目</h2>
      <p className="mt-2 mb-7 text-sm text-stone-400">上传剧本，或直接粘贴内容后开始 AI 创作。</p>
      {error && <div className="bg-clay-500/10 border border-clay-500/30 text-clay-400 p-3 rounded text-sm mb-4">{error}</div>}
      <div className="space-y-5">
        <div>
          <div className="mb-2 flex items-center justify-between gap-3">
            <label className="block text-sm font-medium text-stone-300">选择风格预设</label>
            <button type="button" onClick={() => { window.location.hash = '#/styles'; }} className="text-xs font-medium text-brass-600 hover:text-brass-500">管理预设</button>
          </div>
          {stylesLoading ? <div className="rounded-xl border border-ink-700 bg-ink-800/60 px-3 py-4 text-sm text-stone-500">正在加载风格预设...</div> : stylePresets.length === 0 ? <div className="rounded-xl border border-dashed border-ink-600 bg-ink-800/40 px-3 py-4 text-sm text-stone-500">暂无可用预设</div> : <>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {stylePresets.map(preset => <button key={preset.id} type="button" onClick={() => setSelectedStyleId(preset.id)}
                className={'style-preset-picker text-left ' + (selectedStyleId === preset.id ? 'style-preset-picker-selected' : '')}>
                <span className={`style-swatch ${presetTone(preset)}`} aria-hidden="true" />
                <span className="min-w-0 flex-1"><span className="flex items-center gap-1.5"><span className="truncate text-sm font-medium text-stone-200">{preset.name}</span>{preset.is_default && <span className="rounded bg-leaf-500/10 px-1.5 py-0.5 text-[10px] font-medium text-leaf-500">默认</span>}</span><span className="mt-0.5 block truncate text-xs text-stone-500">{preset.description || preset.image_style}</span></span>
                {selectedStyleId === preset.id && <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brass-500 text-xs font-bold text-ink-950">✓</span>}
              </button>)}
            </div>
            {selectedStyle && <div className="mt-2 flex flex-wrap gap-1.5 text-xs text-stone-500"><span className="rounded-md bg-ink-800 px-2 py-1">图像 · {selectedStyle.image_style}</span><span className="rounded-md bg-ink-800 px-2 py-1">视频 · {selectedStyle.video_style}</span><span className="rounded-md bg-ink-800 px-2 py-1">{selectedStyle.aspect_ratio}</span></div>}
          </>}
        </div>
        <div className="grid gap-4 rounded-xl border border-ink-700 bg-ink-800/35 p-4 sm:grid-cols-2">
          <div><label className="mb-1.5 block text-xs font-medium text-stone-300">图片模型</label><select value={imageModelId} onChange={event => setImageModelId(event.target.value)} className="style-input">{imageModels.map(model => <option key={model.id} value={model.id}>{model.name} · {model.credits_per_call} 积分/次</option>)}</select><p className="mt-1.5 text-xs text-stone-500">批量视觉素材固定记录 10 次模型调用。</p></div>
          <div><label className="mb-1.5 block text-xs font-medium text-stone-300">视频模型</label><select value={videoModelId} onChange={event => setVideoModelId(event.target.value)} className="style-input">{videoModels.map(model => <option key={model.id} value={model.id}>{model.name} · {model.credits_per_call} 积分/镜头</option>)}</select><p className="mt-1.5 text-xs text-stone-500">批量视频固定记录 5 个镜头调用。</p></div>
        </div>
        <div>
          <label className="block text-sm text-stone-300 mb-1.5 font-medium">上传剧本文件</label>
          <input ref={fileRef} type="file" accept=".txt,.md" onChange={handleFile}
            className="block w-full rounded-xl border border-dashed border-ink-600 bg-ink-800/50 p-3 text-sm text-stone-400 file:mr-4 file:rounded-lg file:border-0 file:bg-brass-500/10 file:px-3 file:py-2 file:text-sm file:font-medium file:text-brass-600 hover:file:bg-brass-500/15 file:transition-colors file:cursor-pointer cursor-pointer" />
        </div>
        <div className="flex items-center gap-3 text-stone-500 text-sm">
          <span className="h-px flex-1 bg-ink-700" />
          <span>或</span>
          <span className="h-px flex-1 bg-ink-700" />
        </div>
        <div>
          <label className="block text-sm text-stone-300 mb-1.5 font-medium">剧本内容</label>
          <textarea
            value={scriptText}
            onChange={(e) => { setScriptText(e.target.value); setScriptFile(null); if(fileRef.current) fileRef.current.value = ''; }}
            rows={8}
            className="w-full bg-ink-950 border border-ink-700 rounded-xl p-3 text-stone-200 text-sm focus:outline-none focus:border-brass-500/50 transition-colors placeholder:text-stone-500"
            placeholder="在此粘贴剧本内容..."
          />
        </div>
        <button onClick={submit} disabled={submitting}
          className="step-btn volc-primary w-full py-3 disabled:bg-ink-700 text-ink-950 rounded-xl font-medium transition-all disabled:text-stone-400">
          {submitting ? '创建中...' : '创建项目并开始'}
        </button>
      </div>
    </div>
  );
}
