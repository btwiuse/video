const { useState, useEffect, useRef, useCallback, useMemo } = React;

function PipelineDetail({ pipeline, onRefresh, onBack }) {
  const [actionLoading, setActionLoading] = useState(false);
  const [summary, setSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
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

  const getCurrentStep = () => {
    if (pipeline.status === 'done') return 5;
    if (pipeline.status === 'running') return Math.max(0, (pipeline.step || 1) - 1);
    if (pipeline.status?.startsWith('step_')) {
      return parseInt(pipeline.status.split('_')[1]);
    }
    if (pipeline.status === 'failed' || pipeline.status === 'canceled') return Math.max(0, (pipeline.step || 1) - 1);
    return pipeline.step || 0;
  };
  const currentStep = getCurrentStep();
  const pid = pipeline.pipeline_id;

  // Step tab routing via hash
  const getDefaultStep = () => {
    if (pipeline.status === 'done') return 5;
    return Math.min(currentStep + 1, 5);
  };
  const getStepFromHash = () => {
    const m = window.location.hash.match(/\/step\/(\d)/);
    if (m) { const s = parseInt(m[1]); if (s >= 1 && s <= 5) return s; }
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

  const runAll = async () => {
    setActionLoading(true);
    try {
      const startStep = currentStep === 5 ? 1 : currentStep + 1;
      for (let s = startStep; s <= 5; s++) {
        navigateToStep(s);
        const body = s === 1 ? { max_shots_per_scene: maxShotsPerScene, total_shots: totalShots, total_duration: totalDuration } : {};
        await api(`/pipelines/${pid}/steps/${s}`, { method: 'POST', body: JSON.stringify(body) });
        const startTime = Date.now();
        const timeout = 30 * 60 * 1000;
        while (true) {
          await new Promise(r => setTimeout(r, 3000));
          if (Date.now() - startTime > timeout) {
            toast.error(`步骤 ${s} 超时 (30分钟)，请检查后端状态`);
            break;
          }
          const res = await api(`/pipelines/${pid}`);
          if (!res.ok) break;
          const data = await res.json();
          const status = data.status;
          if (status === 'failed' || status === 'canceled') {
            if (status === 'canceled') {
              toast(`步骤 ${s} 已取消`);
            } else {
              toast.error(`步骤 ${s} 失败: ${data.error || status}`);
            }
            return; // 停止全部流程
          }
          const currentStep = status?.startsWith('step_') ? parseInt(status.split('_')[1]) : (status === 'done' ? 5 : 0);
          if (currentStep > s || status === 'done') break;
        }
      }
      onRefresh();
    } finally { setActionLoading(false); }
  };

  const del = async () => {
    if (!confirm('确定删除此 pipeline 及其所有产物?')) return;
    try {
      const res = await api(`/pipelines/${pid}`, { method: 'DELETE' });
      if (!res.ok) { toast.error(`删除失败: HTTP ${res.status}`); return; }
      onBack();
    } catch (e) { toast.error(`删除失败: ${e.message}`); }
  };

  return (
    <div className="bg-ink-900 rounded-lg p-6 border border-ink-700">
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1 min-w-0">
          <h2 className="font-heading text-xl font-semibold text-stone-100 truncate" title={pipeline.name}>{pipeline.name || 'Untitled Pipeline'}</h2>
          {summaryLoading && <p className="text-stone-400 text-xs mt-1">正在生成摘要...</p>}
          {summary && summary.summary && (
            <p className="text-stone-300 text-sm mt-1 leading-relaxed">{summary.summary}</p>
          )}
          <div className="flex items-center gap-3 mt-2">
            <StatusBadge status={pipeline.status} />
            <span className="text-stone-400 text-sm">{pipeline.status === 'running' ? `运行中 - 步骤 ${pipeline.step}/5` : currentStep > 0 ? `已完成 ${currentStep}/5` : '未开始'}</span>
            {pipeline.duration && <span className="text-stone-500 text-xs">运行时长: {formatDuration(pipeline.duration)}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={runAll} disabled={actionLoading || pipeline.status === 'done'} className="nav-btn text-xs px-2.5 py-1.5 bg-brass-500 hover:bg-brass-400 disabled:bg-ink-700 text-ink-950 rounded transition-colors disabled:text-stone-400 font-medium">
            运行全部步骤
          </button>
          <button onClick={del} className="text-xs px-2.5 py-1.5 bg-ink-700 hover:bg-ink-600 text-clay-400 rounded transition-colors">删除</button>
        </div>
      </div>

      <StepTabs currentStep={currentStep} pipelineStatus={pipeline.status} activeStep={activeStep} onNavigate={navigateToStep} />

      {pipeline.error && (
        <div className="bg-clay-500/10 border border-clay-500/30 text-clay-400 p-3 rounded text-sm mb-6">
          {pipeline.error}
        </div>
      )}

      <StepView step={activeStep} pipeline={pipeline} onRun={runStep} onCancel={cancelStep} actionLoading={actionLoading} pipelineId={pid}
  maxShotsPerScene={maxShotsPerScene} setMaxShotsPerScene={setMaxShotsPerScene}
  totalShots={totalShots} setTotalShots={setTotalShots}
  totalDuration={totalDuration} setTotalDuration={setTotalDuration} />

      <div className="flex justify-end">
        <button onClick={() => navigateToStep(Math.min(currentStep + 1, 5))} disabled={currentStep >= 5 || actionLoading} className="nav-btn text-xs px-2.5 py-1.5 bg-ink-700 hover:bg-ink-600 disabled:bg-ink-800/60 text-stone-300 hover:text-stone-100 disabled:text-stone-600 rounded transition-colors">
          下一步 →
        </button>
      </div>
      <LogViewer pipelineId={pid} />
      <ArtifactList pipelineId={pid} />

      <div className="mt-8 text-xs text-stone-500 leading-relaxed">
        创建时间: {new Date(pipeline.created_at).toLocaleString()}<br/>
        更新时间: {new Date(pipeline.updated_at).toLocaleString()}
      </div>
    </div>
  );
}
