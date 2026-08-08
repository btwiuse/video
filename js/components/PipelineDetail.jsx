const { useState, useEffect, useRef, useCallback, useMemo } = React;

function PipelineDetail({ pipeline, onRefresh, onBack }) {
  const [actionLoading, setActionLoading] = useState(false);
  const [summary, setSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [editingMetadata, setEditingMetadata] = useState(false);
  const [metadataSaving, setMetadataSaving] = useState(false);
  const [metadataDraft, setMetadataDraft] = useState({ name: '', description: '' });
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [visualAssetsCompleted, setVisualAssetsCompleted] = useState(false);
  const [models, setModels] = useState({ image_models: [], video_models: [] });
  const [modelSaving, setModelSaving] = useState(false);
  // Step 2 has its own ordered flow. Keep this state here because the bottom
  // navigation lives outside StepView.
  const [step2AssetTab, setStep2AssetTab] = useState('characters');
  const [step2AssetOverview, setStep2AssetOverview] = useState(null);
  const updateStep2AssetOverview = useCallback((next) => {
    setStep2AssetOverview(previous => {
      const same = previous && Object.keys(next).every(key =>
        ['total', 'completed', 'generating', 'failed'].every(field => previous[key]?.[field] === next[key]?.[field])
      );
      return same ? previous : next;
    });
  }, []);
  const [maxShotsPerScene, setMaxShotsPerScene] = useState(() => {
    try { const s = localStorage.getItem('pipelineSettings'); return s ? JSON.parse(s).maxShotsPerScene ?? 1 : 1; } catch { return 1; }
  });
  const [totalShots, setTotalShots] = useState(() => {
    try { const s = localStorage.getItem('pipelineSettings'); return s ? JSON.parse(s).totalShots ?? 1 : 1; } catch { return 1; }
  });
  const [totalDuration, setTotalDuration] = useState(() => {
    try { const s = localStorage.getItem('pipelineSettings'); return s ? JSON.parse(s).totalDuration ?? 1 : 1; } catch { return 1; }
  });

  useEffect(() => {
    try { localStorage.setItem('pipelineSettings', JSON.stringify({ maxShotsPerScene, totalShots, totalDuration })); } catch {}
  }, [maxShotsPerScene, totalShots, totalDuration]);

  useEffect(() => {
    setSummary(null);
    setSummaryLoading(false);
  }, [pipeline.pipeline_id]);

  useEffect(() => {
    api('/models').then(res => res.ok ? res.json() : null).then(data => { if (data) setModels(data); }).catch(() => {});
  }, []);

  useEffect(() => {
    setVisualAssetsCompleted(false);
    setStep2AssetTab('characters');
    setStep2AssetOverview(null);
  }, [pipeline.pipeline_id]);

  const assetSectionComplete = section => Boolean(section) &&
    section.total === section.completed && section.generating === 0 && section.failed === 0;
  const step2AssetsCompleted = Boolean(step2AssetOverview) &&
    Object.values(step2AssetOverview).every(assetSectionComplete);
  // Prefer the fresh Step 2 inventory while it is on screen. The callback
  // remains necessary for direct visits to later steps, before this inventory
  // has been loaded in the parent.
  const visualAssetsReady = visualAssetsCompleted || step2AssetsCompleted;

  const getCurrentStep = () => {
    if (pipeline.status === 'done') return WORKFLOW_STEP_COUNT;
    if (pipeline.status === 'running') return Math.max(0, workflowStep(pipeline.step || 1) - 1);
    if (pipeline.status?.startsWith('step_')) {
      return workflowStep(parseInt(pipeline.status.split('_')[1]));
    }
    if (pipeline.status === 'failed' || pipeline.status === 'canceled') return Math.max(0, workflowStep(pipeline.step || 1) - 1);
    return workflowStep(pipeline.step);
  };
  const pipelineCurrentStep = getCurrentStep();
  // Step 2 is complete in the UI only when all reusable asset categories report
  // that their totals have been completed. This supports hand-generated and
  // uploaded assets before the backend status has refreshed.
  const currentStep = pipelineCurrentStep === 1 && visualAssetsReady
    ? 2
    : pipelineCurrentStep === 2 && !visualAssetsReady
      ? 1
      : pipelineCurrentStep;
  const pid = pipeline.pipeline_id;
  const imageModel = pipeline.image_model || models.image_models[0];
  const videoModel = pipeline.video_model || models.video_models[0];
  const stepCredits = step => step === 1 ? 6 : step === 2 ? (imageModel?.credits_per_call || 0) * 10 : step === 3 ? (videoModel?.credits_per_call || 0) * 5 : 0;

  const updateModel = async (field, value) => {
    setModelSaving(true);
    try {
      const response = await api(`/pipelines/${pid}`, { method: 'PATCH', body: JSON.stringify({ [field]: value }) });
      if (!response.ok) throw new Error(await response.text());
      toast('模型已更新，后续生成将使用新模型');
      await onRefresh();
    } catch (error) { toast.error(`模型更新失败：${error?.message || '请稍后重试'}`); } finally { setModelSaving(false); }
  };

  const generateSummary = async () => {
    setSummaryLoading(true);
    try {
      const response = await api(`/pipelines/${pid}/summarize`);
      if (!response.ok) throw new Error(await response.text());
      const data = await response.json();
      setSummary(data);
      if (data.usage?.credits) toast(`已记录 ${data.usage.credits} 积分，本次暂不扣费`);
    } catch (error) { toast.error(`摘要生成失败：${error?.message || '请稍后重试'}`); } finally { setSummaryLoading(false); }
  };

  const openMetadataEditor = () => {
    setMetadataDraft({
      name: pipeline.name || '',
      description: pipeline.description || summary?.summary || '',
    });
    setEditingMetadata(true);
  };

  const saveMetadata = async event => {
    event.preventDefault();
    const name = metadataDraft.name.trim();
    if (!name) {
      toast.error('项目标题不能为空');
      return;
    }
    setMetadataSaving(true);
    try {
      const response = await api(`/pipelines/${pid}`, {
        method: 'PATCH',
        body: JSON.stringify({ name, description: metadataDraft.description.trim() }),
      });
      if (!response.ok) throw new Error(await response.text());
      setEditingMetadata(false);
      toast('项目标题和简介已保存');
      await onRefresh();
    } catch (error) {
      toast.error(`保存失败：${error?.message || '请稍后重试'}`);
    } finally {
      setMetadataSaving(false);
    }
  };
  // Same availability check as StepTabs: a step is available if completed or isNext
  const stepAvailable = (n) => {
    if (pipeline.status === 'done') return n <= WORKFLOW_STEP_COUNT;
    // Step 3 may only be entered when every visual-asset category is complete.
    // This also handles adding a new, still-empty asset after Step 2 was done.
    if (n === 3 && !visualAssetsReady) return false;
    return n <= currentStep || n === currentStep + 1;
  };

  // Step tab routing via hash
  const getDefaultStep = () => {
    if (pipeline.status === 'done') return WORKFLOW_STEP_COUNT;
    return Math.min(currentStep + 1, WORKFLOW_STEP_COUNT);
  };
  const getStepFromHash = () => {
    const m = window.location.hash.match(/\/step\/(\d)/);
    if (m) { const s = parseInt(m[1]); if (s >= 1 && s <= WORKFLOW_STEP_COUNT) return s; }
    return getDefaultStep();
  };
  const [activeStep, setActiveStep] = useState(getDefaultStep);
  const navigateToStep = (n) => {
    window.location.hash = `#/pipelines/${pid}/step/${n}`;
    setActiveStep(n);
  };
  useEffect(() => {
    const s = getStepFromHash();
    if (s !== activeStep) setActiveStep(s);
    const onHash = () => { const s = getStepFromHash(); if (s !== activeStep) setActiveStep(s); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [pipeline, activeStep]);

  const runStep = async (step) => {
    setActionLoading(true);
    try {
      const body = step === 1 ? { max_shots_per_scene: maxShotsPerScene, total_shots: totalShots, total_duration: totalDuration } : {};
      const response = await api(`/pipelines/${pid}/steps/${step}`, { method: 'POST', body: JSON.stringify(body) });
      if (!response.ok) throw new Error(await response.text());
      const data = await response.json();
      if (data.usage?.credits) toast(`已记录 ${data.usage.credits} 积分，本阶段暂不扣费`);
      setTimeout(onRefresh, 1000);
    } catch (error) { toast.error(`启动失败：${error?.message || '请稍后重试'}`); } finally { setActionLoading(false); }
  };

  const cancelStep = async () => {
    try {
      await api(`/pipelines/${pid}/cancel`, { method: 'POST' });
      setTimeout(onRefresh, 1000);
    } catch (_) {}
  };

  const del = async () => {
    if (!confirm('确定删除此 pipeline 及其所有产物?')) return;
    try {
      const res = await api(`/pipelines/${pid}`, { method: 'DELETE' });
      if (!res.ok) { toast.error(`删除失败: HTTP ${res.status}`); return; }
      onBack();
    } catch (e) { toast.error(`删除失败: ${e.message}`); }
  };

  const handleDownloadFinalVideo = async () => {
    try {
      const url = artifactUrl(pid, 'final.mp4');
      const res = await fetch(url);
      if (!res.ok) {
        toast.error('最终视频尚未生成，请先完成全部步骤');
        return;
      }
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `pipeline_${pid}_final.mp4`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
      toast('下载开始');
    } catch (e) {
      toast.error(`下载失败: ${e.message}`);
    }
  };

  const handleNextStep = () => {
    const next = activeStep + 1;
    if (next > WORKFLOW_STEP_COUNT) return;
    if (actionLoading || pipeline.status === 'running') {
      toast('当前步骤正在运行中，请等待完成后进入下一步');
      return;
    }
    if (activeStep === 2) {
      const currentAsset = step2AssetOverview?.[step2AssetTab];
      if (!assetSectionComplete(currentAsset)) {
        const label = step2AssetTab === 'characters' ? '角色肖像' : step2AssetTab === 'props' ? '道具' : '场景';
        toast(`请先完成「${label}」，再进入下一项`);
        return;
      }
      if (step2AssetTab === 'characters') {
        setStep2AssetTab('props');
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      if (step2AssetTab === 'props') {
        setStep2AssetTab('scenes');
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
    }
    if (!stepAvailable(next)) {
      if (next === 3 && !visualAssetsReady) {
        toast('请先完成「视觉素材」，再进入下一步');
        return;
      }
      const cs = getCurrentStep();
      toast(`请先完成「${STEP_NAMES[cs + 1]}」，再进入下一步`);
      return;
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
    navigateToStep(next);
  };

  const nextDisabled = actionLoading || pipeline.status === 'running' ||
    (activeStep === 2
      ? !assetSectionComplete(step2AssetOverview?.[step2AssetTab])
      : !stepAvailable(activeStep + 1));

  return (
    <div className="bg-ink-900 rounded-2xl p-4 sm:p-6 border border-ink-700 shadow-sm">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div className="flex-1 min-w-0">
          <p className="mb-1 text-[11px] font-medium tracking-wide text-brass-500">AI VIDEO PROJECT</p>
          {editingMetadata ? <form onSubmit={saveMetadata} className="space-y-2">
            <label className="sr-only" htmlFor="project-title">项目标题</label>
            <input id="project-title" autoFocus value={metadataDraft.name} maxLength={100} onChange={event => setMetadataDraft(draft => ({ ...draft, name: event.target.value }))} className="w-full rounded-md border border-brass-500 bg-ink-950 px-2.5 py-1.5 font-heading text-xl font-semibold text-stone-100 outline-none" />
            <label className="sr-only" htmlFor="project-description">项目简介</label>
            <textarea id="project-description" value={metadataDraft.description} maxLength={500} rows={3} onChange={event => setMetadataDraft(draft => ({ ...draft, description: event.target.value }))} placeholder="用一句话描述本项目的故事、风格或创作目标" className="w-full resize-y rounded-md border border-ink-600 bg-ink-950 px-2.5 py-2 text-sm leading-relaxed text-stone-100 outline-none focus:border-brass-500" />
            <div className="flex items-center gap-2"><button type="submit" disabled={metadataSaving} className="rounded-md bg-brass-500 px-3 py-1.5 text-xs font-semibold text-ink-950 hover:bg-brass-400 disabled:opacity-50">{metadataSaving ? '保存中…' : '保存'}</button><button type="button" onClick={() => setEditingMetadata(false)} className="rounded-md px-3 py-1.5 text-xs text-stone-400 hover:bg-ink-800 hover:text-stone-200">取消</button></div>
          </form> : <>
            <div className="flex min-w-0 items-center gap-1"><h2 className="min-w-0 truncate font-heading text-xl font-semibold text-stone-100" title={pipeline.name}>{pipeline.name || 'Untitled Pipeline'}</h2>{activeStep === 1 && <button type="button" onClick={openMetadataEditor} title="编辑项目标题和简介" aria-label="编辑项目标题和简介" className="shrink-0 rounded px-1.5 py-1 text-sm text-stone-500 hover:bg-ink-800 hover:text-brass-400">✎</button>}</div>
            {summaryLoading && !pipeline.description && <p className="mt-1 text-xs text-stone-400">正在生成摘要...</p>}
            {(pipeline.description || summary?.summary) && <p className="mt-1 text-sm leading-relaxed text-stone-300">{pipeline.description || summary.summary}</p>}
            {!pipeline.description && !summary && !summaryLoading && <button type="button" onClick={generateSummary} className="mt-2 text-xs font-medium text-brass-500 hover:text-brass-400">生成项目摘要 · 1 积分</button>}
          </>}
          <div className="flex items-center gap-3 mt-2">
            <StatusBadge status={pipeline.status} />
            <span className="text-stone-400 text-sm">{pipeline.status === 'running' ? `运行中 - 步骤 ${workflowStep(pipeline.step)}/${WORKFLOW_STEP_COUNT}` : currentStep > 0 ? `已完成 ${currentStep}/${WORKFLOW_STEP_COUNT}` : '未开始'}</span>
            {pipeline.duration && <span className="text-stone-500 text-xs">运行时长: {formatDuration(pipeline.duration)}</span>}
          </div>
          <div className="mt-3 grid max-w-2xl gap-2 sm:grid-cols-2">
            <label className="text-xs text-stone-500">图片模型<select disabled={modelSaving} value={imageModel?.id || ''} onChange={event => updateModel('image_model_id', event.target.value)} className="style-input mt-1 text-xs">{models.image_models.map(model => <option key={model.id} value={model.id}>{model.name} · {model.credits_per_call} 积分/次</option>)}</select></label>
            <label className="text-xs text-stone-500">视频模型<select disabled={modelSaving} value={videoModel?.id || ''} onChange={event => updateModel('video_model_id', event.target.value)} className="style-input mt-1 text-xs">{models.video_models.map(model => <option key={model.id} value={model.id}>{model.name} · {model.credits_per_call} 积分/镜头</option>)}</select></label>
          </div>
        </div>
      </div>

      <StepTabs currentStep={currentStep} pipelineStatus={pipeline.status} activeStep={activeStep} onNavigate={navigateToStep} />

      {pipeline.error && pipeline.status === 'failed' && activeStep === pipeline.step && (
        <div className="bg-clay-500/10 border border-clay-500/30 text-clay-400 p-3 rounded text-sm mb-6">
          {pipeline.error}
        </div>
      )}

      <StepView step={activeStep} pipeline={pipeline} onRun={runStep} onCancel={cancelStep} onRefresh={onRefresh} visualAssetsCompletionKnown={visualAssetsReady} onVisualAssetsCompletionChange={setVisualAssetsCompleted} assetTab={step2AssetTab} onAssetTabChange={setStep2AssetTab} onAssetOverviewChange={updateStep2AssetOverview} actionLoading={actionLoading} pipelineId={pid} stepCredits={stepCredits(activeStep)} imageCredits={imageModel?.credits_per_call || 0} videoCredits={videoModel?.credits_per_call || 0}
  maxShotsPerScene={maxShotsPerScene} setMaxShotsPerScene={setMaxShotsPerScene}
  totalShots={totalShots} setTotalShots={setTotalShots}
  totalDuration={totalDuration} setTotalDuration={setTotalDuration} />

      <div className="flex justify-end">
        {activeStep >= WORKFLOW_STEP_COUNT && pipeline.status === 'done' ? (
          <button onClick={handleDownloadFinalVideo} className="nav-btn volc-primary text-xs px-3 py-2 text-ink-950 rounded-lg transition-colors font-medium">
            ↓ 下载最终视频
          </button>
        ) : activeStep < WORKFLOW_STEP_COUNT ? (
          <button onClick={handleNextStep} disabled={nextDisabled}
            className={`nav-btn text-xs px-2.5 py-1.5 rounded transition-colors font-medium ${
              nextDisabled
                ? 'bg-ink-800/60 text-stone-600 cursor-not-allowed'
                : 'volc-primary text-ink-950'
            }`}>
            {activeStep === 2
              ? step2AssetTab === 'characters' ? '下一步：道具 →' : step2AssetTab === 'props' ? '下一步：场景 →' : '下一步：视频生成 →'
              : '下一步 →'}
          </button>
        ) : null}
      </div>
      <LogViewer pipelineId={pid} />
      <ArtifactList pipelineId={pid} />

      <div className="mt-8 flex flex-wrap items-center justify-between gap-x-5 gap-y-1 text-xs text-stone-500">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1"><span>创建时间: {formatDateTime(pipeline.created_at)}</span><span>更新时间: {formatDateTime(pipeline.updated_at)}</span></div>
        <div className="relative"><button type="button" onClick={() => setProjectMenuOpen(open => !open)} aria-label="项目选项" aria-expanded={projectMenuOpen} title="项目选项" className="flex h-7 w-7 items-center justify-center rounded-md text-base leading-none text-stone-500 hover:bg-ink-800 hover:text-stone-200">…</button>
          {projectMenuOpen && <div className="absolute bottom-full right-0 z-30 mb-2 min-w-28 overflow-hidden rounded-lg border border-ink-600 bg-ink-900 p-1 shadow-xl"><button type="button" onClick={del} className="w-full rounded-md px-2.5 py-2 text-left text-xs text-clay-400 hover:bg-clay-500/10">删除项目</button></div>}
        </div>
      </div>
    </div>
  );
}
