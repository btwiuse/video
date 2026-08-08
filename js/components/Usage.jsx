function Usage({ onBack }) {
  const [report, setReport] = useState(null);
  const [organizations, setOrganizations] = useState([]);
  const [days, setDays] = useState(30);
  const [scope, setScope] = useState(getActiveOrganizationId());
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const query = new URLSearchParams({ days: String(days) });
      if (scope) query.set('organization_id', scope);
      const response = await api(`/usage?${query}`);
      if (!response.ok) throw new Error(await response.text());
      setReport(await response.json());
    } catch (requestError) { setError(requestError.message || '用量加载失败'); }
  }, [days, scope]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api('/organizations').then(response => response.ok ? response.json() : null)
      .then(data => setOrganizations(data?.organizations || [])).catch(() => {});
  }, []);

  const selectScope = value => {
    setScope(value);
    setActiveOrganizationId(value);
  };
  const operationRows = Object.entries(report?.by_operation || {}).sort((a, b) => b[1] - a[1]);
  const modelRows = Object.entries(report?.by_model || {}).sort((a, b) => b[1] - a[1]);

  return <div className="mx-auto max-w-6xl">
    <button type="button" onClick={onBack} className="nav-btn mb-4 text-sm text-stone-400 hover:text-brass-500">← 返回项目</button>
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div><p className="text-[11px] font-medium tracking-wide text-brass-500">USAGE</p><h2 className="mt-1 font-heading text-2xl font-semibold text-stone-100">积分用量</h2><p className="mt-2 text-sm text-stone-400">当前仅记录用量，不扣减积分。失败调用不会计入汇总，为后续额度与充值保留接口。</p></div>
      <div className="flex items-center gap-2"><label className="text-xs text-stone-500">范围<select value={scope} onChange={event => selectScope(event.target.value)} className="style-input ml-1.5 py-1.5 text-xs"><option value="">个人工作区</option>{organizations.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}</select></label><label className="text-xs text-stone-500">周期<select value={days} onChange={event => setDays(Number(event.target.value))} className="style-input ml-1.5 py-1.5 text-xs"><option value={1}>近 1 天</option><option value={7}>近 7 天</option><option value={30}>近 30 天</option></select></label></div>
    </div>
    {error && <p className="mb-4 rounded-md border border-clay-500/30 bg-clay-500/10 px-3 py-2 text-sm text-clay-400">{error}</p>}
    <section className="border-y border-ink-700 bg-ink-900/70 px-5 py-5"><p className="text-xs text-stone-500">已记录积分</p><p className="mt-1 font-heading text-3xl font-semibold text-brass-500">{report?.total_credits ?? '-'}</p><p className="mt-1 text-xs text-stone-500">{scope ? '组织工作区' : '个人工作区'} · {days} 天</p></section>
    <div className="mt-5 grid gap-5 lg:grid-cols-2">
      <section className="overflow-hidden rounded-lg border border-ink-700 bg-ink-900"><h3 className="border-b border-ink-700 px-4 py-3 text-sm font-semibold text-stone-200">按操作</h3><div className="divide-y divide-ink-700">{operationRows.length ? operationRows.map(([name, credits]) => <div key={name} className="flex justify-between px-4 py-3 text-sm"><span className="text-stone-300">{name}</span><span className="font-medium text-brass-500">{credits} 积分</span></div>) : <p className="px-4 py-7 text-center text-sm text-stone-500">暂无记录</p>}</div></section>
      <section className="overflow-hidden rounded-lg border border-ink-700 bg-ink-900"><h3 className="border-b border-ink-700 px-4 py-3 text-sm font-semibold text-stone-200">按模型</h3><div className="divide-y divide-ink-700">{modelRows.length ? modelRows.map(([name, credits]) => <div key={name} className="flex justify-between px-4 py-3 text-sm"><span className="text-stone-300">{name}</span><span className="font-medium text-brass-500">{credits} 积分</span></div>) : <p className="px-4 py-7 text-center text-sm text-stone-500">暂无记录</p>}</div></section>
    </div>
    <section className="mt-5 overflow-hidden rounded-lg border border-ink-700 bg-ink-900"><h3 className="border-b border-ink-700 px-4 py-3 text-sm font-semibold text-stone-200">调用明细</h3><div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm"><thead className="border-b border-ink-700 text-xs text-stone-500"><tr><th className="px-4 py-3 font-medium">时间</th><th className="px-4 py-3 font-medium">操作</th><th className="px-4 py-3 font-medium">模型</th><th className="px-4 py-3 font-medium">状态</th><th className="px-4 py-3 text-right font-medium">积分</th></tr></thead><tbody className="divide-y divide-ink-700">{(report?.entries || []).length ? report.entries.map(entry => <tr key={entry.id}><td className="whitespace-nowrap px-4 py-3 text-xs text-stone-500">{formatDateTime(entry.created_at)}</td><td className="px-4 py-3 text-stone-300">{entry.operation ? ({ storyboard: '剧本分镜', script_summary: '剧本摘要', shot_optimize: '镜头优化', image_batch: '批量视觉素材', image_regenerate: '视觉素材生成', video_batch: '批量视频生成', video_shot: '镜头视频生成' }[entry.operation] || entry.operation) : '-'}</td><td className="px-4 py-3 text-stone-400">{entry.model_name || '-'}</td><td className={'px-4 py-3 text-xs ' + (entry.status === 'failed' ? 'text-clay-400' : entry.status === 'completed' ? 'text-leaf-500' : 'text-brass-500')}>{entry.status === 'failed' ? '失败' : entry.status === 'completed' ? '已完成' : '处理中'}</td><td className="px-4 py-3 text-right font-medium text-brass-500">{entry.credits}</td></tr>) : <tr><td colSpan="5" className="px-4 py-8 text-center text-sm text-stone-500">暂无调用记录</td></tr>}</tbody></table></div></section>
  </div>;
}
