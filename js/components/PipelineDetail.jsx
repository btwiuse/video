const { useState, useEffect, useRef, useCallback, useMemo } = React;

function PipelineDetail({ pipeline, onRefresh, onBack }) {
  const [actionLoading, setActionLoading] = useState(false);
  const [summary, setSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [visualAssetsCompleted, setVisualAssetsCompleted] = useState(false);
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
    let cancelled = false;
    setSummary(null);
    setSummaryLoading(true);
    api(`/pipelines/${pipeline.pipeline_id}/summarize`)
      .then(res => res.ok ? res.json() : Promise.resolve(null))
      .then(data => {
        if (!cancelled && data) setSummary(data);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setSummaryLoading(false); });
    return () => { cancelled = true; };
  }, [pipeline.pipeline_id]);

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
      await api(`/pipelines/${pid}/steps/${step}`, { method: 'POST', body: JSON.stringify(body) });
      setTimeout(onRefresh, 1000);
    } finally { setActionLoading(false); }
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
          <h2 className="font-heading text-xl font-semibold text-stone-100 truncate" title={pipeline.name}>{pipeline.name || 'Untitled Pipeline'}</h2>
          {summaryLoading && <p className="text-stone-400 text-xs mt-1">正在生成摘要...</p>}
          {summary && summary.summary && (
            <p className="text-stone-300 text-sm mt-1 leading-relaxed">{summary.summary}</p>
          )}
          <div className="flex items-center gap-3 mt-2">
            <StatusBadge status={pipeline.status} />
            <span className="text-stone-400 text-sm">{pipeline.status === 'running' ? `运行中 - 步骤 ${workflowStep(pipeline.step)}/${WORKFLOW_STEP_COUNT}` : currentStep > 0 ? `已完成 ${currentStep}/${WORKFLOW_STEP_COUNT}` : '未开始'}</span>
            {pipeline.duration && <span className="text-stone-500 text-xs">运行时长: {formatDuration(pipeline.duration)}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={del} className="text-xs px-3 py-2 bg-ink-800 hover:bg-ink-700 text-clay-500 rounded-lg border border-ink-700 transition-colors">删除</button>
        </div>
      </div>

      <StepTabs currentStep={currentStep} pipelineStatus={pipeline.status} activeStep={activeStep} onNavigate={navigateToStep} />

      {pipeline.error && pipeline.status === 'failed' && activeStep === pipeline.step && (
        <div className="bg-clay-500/10 border border-clay-500/30 text-clay-400 p-3 rounded text-sm mb-6">
          {pipeline.error}
        </div>
      )}

      <StepView step={activeStep} pipeline={pipeline} onRun={runStep} onCancel={cancelStep} onRefresh={onRefresh} visualAssetsCompletionKnown={visualAssetsReady} onVisualAssetsCompletionChange={setVisualAssetsCompleted} assetTab={step2AssetTab} onAssetTabChange={setStep2AssetTab} onAssetOverviewChange={updateStep2AssetOverview} actionLoading={actionLoading} pipelineId={pid}
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

      <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-stone-500">
        <span>创建时间: {formatDateTime(pipeline.created_at)}</span>
        <span>更新时间: {formatDateTime(pipeline.updated_at)}</span>
      </div>
    </div>
  );
}
