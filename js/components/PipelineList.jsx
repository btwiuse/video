const { useState, useEffect, useRef, useCallback, useMemo } = React;

const PROJECT_PREVIEW_LABELS = ['角色', '道具', '场景', '起始帧'];
const projectPreviewColumns = count => {
  if (count <= 1) return 1;
  if (count <= 4) return 2;
  if (count <= 9) return 3;
  return 4;
};
const projectPreviewCellCount = count => count <= 1 ? 1 : count <= 4 ? 4 : count <= 9 ? 9 : 16;
const pipelineProgressStep = pipeline => workflowStep(pipeline.status === 'done' ? WORKFLOW_STEP_COUNT : pipeline.step);
const pipelineProgressLabel = pipeline => {
  const step = pipelineProgressStep(pipeline);
  return step > 0 ? `步骤 ${step}/${WORKFLOW_STEP_COUNT} · ${STEP_NAMES[step]}` : '未开始';
};
const PROJECT_TABLE_GRID = 'minmax(180px, 3fr) minmax(110px, 2fr) minmax(220px, 3fr) minmax(140px, 2fr) minmax(140px, 2fr) minmax(88px, 1fr)';
const PROJECT_TABLE_MIN_WIDTHS = [180, 110, 220, 140, 140, 88];
const PROJECT_VIEW_STORAGE_KEY = 'film-pipeline-project-view';
const getSavedProjectView = () => {
  try { return localStorage.getItem(PROJECT_VIEW_STORAGE_KEY) === 'list' ? 'list' : 'grid'; }
  catch { return 'grid'; }
};



function PipelineList({ onSelect, onCreateNew }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState(getSavedProjectView);
  const [sortBy, setSortBy] = useState('updated_at');
  const [sortDirection, setSortDirection] = useState('desc');
  const [deletingId, setDeletingId] = useState(null);
  const [columnWidths, setColumnWidths] = useState(null);
  const [resizing, setResizing] = useState(null);
  const tableHeaderRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api('/pipelines');
      if (res.ok) {
        const data = await res.json();
        setItems(data.pipelines || []);
      }
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); const t = setInterval(() => { if (!document.hidden) load(); }, 10000); return () => clearInterval(t); }, []);

  const selectViewMode = mode => {
    setViewMode(mode);
    try { localStorage.setItem(PROJECT_VIEW_STORAGE_KEY, mode); } catch {}
  };

  useEffect(() => {
    if (!resizing) return undefined;
    const handlePointerMove = event => {
      const delta = event.clientX - resizing.startX;
      const minimumDelta = PROJECT_TABLE_MIN_WIDTHS[resizing.index] - resizing.widths[resizing.index];
      const maximumDelta = resizing.widths[resizing.index + 1] - PROJECT_TABLE_MIN_WIDTHS[resizing.index + 1];
      const constrainedDelta = Math.min(maximumDelta, Math.max(minimumDelta, delta));
      setColumnWidths(resizing.widths.map((width, index) => {
        if (index === resizing.index) return width + constrainedDelta;
        if (index === resizing.index + 1) return width - constrainedDelta;
        return width;
      }));
    };
    const stopResizing = () => setResizing(null);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopResizing, { once: true });
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopResizing);
    };
  }, [resizing]);

  const sorted = items.toSorted((a, b) => {
    const aValue = sortBy === 'progress'
      ? pipelineProgressStep(a)
      : sortBy === 'status'
      ? String(a.status || '')
      : new Date(a[sortBy] || 0).getTime();
    const bValue = sortBy === 'progress'
      ? pipelineProgressStep(b)
      : sortBy === 'status'
      ? String(b.status || '')
      : new Date(b[sortBy] || 0).getTime();
    const comparison = typeof aValue === 'string'
      ? aValue.localeCompare(bValue, 'zh-CN')
      : aValue - bValue;
    if (comparison !== 0) return sortDirection === 'desc' ? -comparison : comparison;
    return String(b.pipeline_id || '').localeCompare(String(a.pipeline_id || ''));
  });

  const toggleSort = field => {
    if (sortBy === field) {
      setSortDirection(direction => direction === 'desc' ? 'asc' : 'desc');
      return;
    }
    setSortBy(field);
    setSortDirection(field === 'status' ? 'asc' : 'desc');
  };

  const sortableHeading = (label, field) => <button type="button" onClick={() => toggleSort(field)}
    className={'group inline-flex items-center gap-1 font-semibold transition-colors ' + (sortBy === field ? 'text-brass-600' : 'text-stone-300 hover:text-stone-100')}
    title={sortBy === field ? `当前按${label}${sortDirection === 'desc' ? '降序' : '升序'}，点击切换` : `按${label}排序`}>
    <span>{label}</span><span className={'text-[10px] ' + (sortBy === field ? 'opacity-100' : 'opacity-0 group-hover:opacity-60')}>{sortBy === field ? (sortDirection === 'desc' ? '↓' : '↑') : '↕'}</span>
  </button>;

  const startColumnResize = (event, index) => {
    event.preventDefault();
    event.stopPropagation();
    const measuredWidths = getComputedStyle(tableHeaderRef.current).gridTemplateColumns
      .split(' ')
      .map(value => parseFloat(value));
    if (measuredWidths.length !== PROJECT_TABLE_MIN_WIDTHS.length) return;
    setColumnWidths(measuredWidths);
    setResizing({ index, startX: event.clientX, widths: measuredWidths });
  };

  const tableHeading = (label, index, field) => <div className="relative min-w-0">
    {field ? sortableHeading(label, field) : label}
    {index < PROJECT_TABLE_MIN_WIDTHS.length - 1 && <button type="button" aria-label={`调整${label}列宽`} title="拖动调整列宽" onPointerDown={event => startColumnResize(event, index)}
      className="group absolute -right-2 top-1/2 z-10 flex h-7 w-4 -translate-y-1/2 cursor-col-resize items-center justify-center touch-none">
      <span className="h-5 w-px bg-ink-600 transition-colors group-hover:bg-brass-500" />
    </button>}
  </div>;

  const tableGridStyle = columnWidths
    ? { gridTemplateColumns: columnWidths.map(width => `${width}px`).join(' ') }
    : { gridTemplateColumns: PROJECT_TABLE_GRID };

  const viewSwitcher = <div role="radiogroup" aria-label="项目视图" className="inline-flex items-center rounded-lg border border-ink-700 bg-ink-800/70 p-1">
    <button type="button" role="radio" aria-checked={viewMode === 'grid'} onClick={() => selectViewMode('grid')} title="卡片视图" aria-label="卡片视图"
      className={'flex h-8 w-8 items-center justify-center rounded-md text-base transition-colors ' + (viewMode === 'grid' ? 'bg-ink-900 text-brass-500 shadow-sm' : 'text-stone-500 hover:text-stone-300')}>
      ▦
    </button>
    <button type="button" role="radio" aria-checked={viewMode === 'list'} onClick={() => selectViewMode('list')} title="列表视图" aria-label="列表视图"
      className={'flex h-8 w-8 items-center justify-center rounded-md text-base transition-colors ' + (viewMode === 'list' ? 'bg-ink-900 text-brass-500 shadow-sm' : 'text-stone-500 hover:text-stone-300')}>
      ☷
    </button>
  </div>;

  const deletePipeline = async (event, pipeline) => {
    event.stopPropagation();
    const name = pipeline.name || pipeline.pipeline_id;
    if (!window.confirm(`确定删除项目「${name}」及其所有产物吗？\n此操作不可撤销。`)) return;
    setDeletingId(pipeline.pipeline_id);
    try {
      const response = await api(`/pipelines/${pipeline.pipeline_id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error(await response.text());
      setItems(current => current.filter(item => item.pipeline_id !== pipeline.pipeline_id));
      toast('项目已删除');
    } catch (error) {
      toast.error(`删除失败：${error?.message || '请稍后重试'}`);
    } finally {
      setDeletingId(null);
    }
  };

  if (viewMode === 'grid') {
    return (
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div><p className="text-[11px] font-medium tracking-wide text-brass-500">PROJECTS</p><h2 className="mt-1 font-heading text-2xl font-semibold text-stone-100">我的项目</h2></div>
          {viewSwitcher}
        </div>
        {loading && items.length === 0 && <p className="text-stone-500">加载中...</p>}
        {items.length === 0 && !loading && (
          <div className="text-center py-20">
            <p className="text-stone-400 mb-4">暂无 Pipeline</p>
            <button onClick={onCreateNew} className="nav-btn volc-primary px-4 py-2.5 text-ink-950 rounded-lg font-medium transition-all">创建项目</button>
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sorted.map(p => {
            const previewGroups = PROJECT_PREVIEW_LABELS.map((_, index) =>
              p.preview_groups?.[index] || (p.preview_images?.[index] ? [p.preview_images[index]] : [])
            );
            const hasAnyPreview = previewGroups.some(images => images.length > 0);
            return (
            <div key={p.pipeline_id} onClick={() => onSelect(p.pipeline_id)}
              className="pipeline-card bg-ink-900 p-5 rounded-2xl border border-ink-700 cursor-pointer hover:border-brass-400/50 transition-all">
              <div className="flex items-center justify-between mb-2">
                <span className="text-stone-100 text-sm font-medium truncate" title={p.name}>{p.name || p.pipeline_id.slice(-8)}</span>
                <div className="ml-3 flex shrink-0 items-center gap-1.5">
                  <StatusBadge status={p.status} />
                  <button type="button" onClick={event => deletePipeline(event, p)} disabled={deletingId === p.pipeline_id}
                    title="删除项目" aria-label={`删除项目 ${p.name || p.pipeline_id}`}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-sm text-stone-500 hover:bg-clay-500/10 hover:text-clay-500 disabled:cursor-wait disabled:opacity-50">
                    {deletingId === p.pipeline_id ? '…' : '⌫'}
                  </button>
                </div>
              </div>
              {!hasAnyPreview ? (
                <div title="暂无图片资源" className="mt-4 flex aspect-[16/5] min-h-28 flex-col items-center justify-center rounded-xl border border-dashed border-ink-600 bg-ink-800/50 text-stone-500">
                  <span className="text-xl leading-none">＋</span>
                  <span className="mt-1 text-xs">暂无图片资源</span>
                </div>
              ) : (
                <div className="mt-4 grid w-full max-w-full grid-cols-4 overflow-hidden rounded-xl border border-ink-700 bg-ink-700">
                  {PROJECT_PREVIEW_LABELS.map((label, index) => {
                    const images = previewGroups[index];
                    const assetCount = p.preview_counts?.[index] ?? images.length;
                    const cellCount = projectPreviewCellCount(images.length);
                    const cells = [...images, ...Array(Math.max(0, cellCount - images.length)).fill(null)];
                    const columns = projectPreviewColumns(images.length);
                    const rows = Math.ceil(cellCount / columns);
                    return <div key={label} title={`${label} · ${assetCount} 个素材`} className="flex min-w-0 flex-col border-r border-ink-700 last:border-r-0 bg-ink-800">
                      {images.length ? <div className="grid aspect-square min-h-0 w-full overflow-hidden bg-ink-700" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}>{cells.map((imageName, cellIndex) => imageName ? <img key={imageName} loading="lazy" src={artifactUrl(p.pipeline_id, imageName)} alt={`${p.name || '项目'} · ${label}`} className="block h-full min-h-0 w-full min-w-0 object-cover object-center"/> : <span key={`empty-${cellIndex}`} className="block min-h-0 bg-ink-800"/>)}</div> : <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 text-stone-500"><span className="text-sm leading-none">＋</span><span className="text-[10px]">暂无图片资源</span></div>}
                      <div className="flex h-7 shrink-0 items-center justify-between border-t border-ink-600 bg-ink-700/70 px-2 text-[11px] font-semibold leading-none text-stone-200"><span>{label}</span><span className="text-brass-600">{assetCount}</span></div>
                    </div>;
                  })}
                </div>
              )}
              <div className="mt-3 text-stone-400 text-xs">步骤 {workflowStep(p.step)}/{WORKFLOW_STEP_COUNT}</div>
              <div className="mt-4 w-full bg-ink-700 rounded-full h-1.5 overflow-hidden">
                <div className="volc-primary h-full rounded-full transition-all duration-500" style={{ width: `${(workflowStep(p.step) / WORKFLOW_STEP_COUNT) * 100}%` }} />
              </div>
              <div className="mt-3 text-xs text-stone-500">更新于 {formatDateTime(p.updated_at)}</div>
              {p.duration && <div className="mt-0.5 text-xs text-stone-500">运行时长: {formatDuration(p.duration)}</div>}
            </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div><p className="text-[11px] font-medium tracking-wide text-brass-500">PROJECTS</p><h2 className="mt-1 font-heading text-2xl font-semibold text-stone-100">我的项目</h2></div>
        {viewSwitcher}
      </div>
      {loading && items.length === 0 && <p className="text-stone-500">加载中...</p>}
      {items.length === 0 && !loading && (
        <div className="text-center py-20">
          <p className="text-stone-400 mb-4">暂无 Pipeline</p>
          <button onClick={onCreateNew} className="nav-btn volc-primary px-4 py-2.5 text-ink-950 rounded-lg font-medium transition-all">创建项目</button>
        </div>
      )}
      <div className="overflow-x-auto rounded-2xl border border-ink-700 bg-ink-900 shadow-sm">
        <div ref={tableHeaderRef} style={tableGridStyle} className="grid min-w-[1050px] gap-4 bg-ink-800 p-3 text-xs font-semibold text-stone-300">
          {tableHeading('名称', 0)}
          {tableHeading('状态', 1, 'status')}
          {tableHeading('步骤进度', 2, 'progress')}
          {tableHeading('创建时间', 3, 'created_at')}
          {tableHeading('更新时间', 4, 'updated_at')}
          {tableHeading('时长', 5)}
        </div>
        {sorted.map(p => (
          <div key={p.pipeline_id} onClick={() => onSelect(p.pipeline_id)}
            style={tableGridStyle} className="grid min-w-[1050px] gap-4 border-t border-ink-700 p-3 transition-colors hover:bg-ink-800/50 cursor-pointer">
            <div className="min-w-0 truncate text-sm font-medium text-stone-100" title={p.name}>{p.name || p.pipeline_id.slice(-8)}</div>
            <div><StatusBadge status={p.status} /></div>
            <div className="min-w-0" title={pipelineProgressLabel(p)}>
              <div className="flex items-center gap-2">
                <div className="h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-ink-700">
                  <div className="volc-primary h-full rounded-full transition-all duration-500" style={{ width: `${(pipelineProgressStep(p) / WORKFLOW_STEP_COUNT) * 100}%` }} />
                </div>
                <span className="shrink-0 whitespace-nowrap text-xs text-stone-400">{pipelineProgressLabel(p)}</span>
              </div>
            </div>
            <div className="whitespace-nowrap text-xs text-stone-400">{formatDateTime(p.created_at)}</div>
            <div className="whitespace-nowrap text-xs text-stone-400">{formatDateTime(p.updated_at)}</div>
            <div className="whitespace-nowrap text-xs text-stone-400">{formatDuration(p.duration) || '-'}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
