const { useState, useEffect, useRef, useCallback, useMemo } = React;

function LogViewer({ pipelineId }) {
  const [logs, setLogs] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const logContainerRef = useRef(null);
  const [done, setDone] = useState(false);

  const checkDone = useCallback(async () => {
    try {
      const res = await api(`/pipelines/${pipelineId}`);
      if (res.ok) { const d = await res.json(); setDone(d.status === 'done' || d.status === 'failed'); }
    } catch (_) {}
  }, [pipelineId]);

  useEffect(() => { checkDone(); }, [checkDone]);

  const loadLogs = useCallback(async () => {
    try {
      const res = await api(`/pipelines/${pipelineId}/logs`);
      if (res.ok) {
        const text = await res.text();
        // Normalize line endings and strip tqdm artifacts
        const cleaned = text
          .replace(/\r\n/g, '\n')
          .replace(/\r/g, '\n')
          .split('\n')
          .filter(l => l.trim() || l === '')
          .map(l => l.trimEnd())
          .join('\n');
        setLogs(cleaned);
      }
    } catch (e) { /* ignore */ }
  }, [pipelineId]);

  useEffect(() => { loadLogs(); }, [loadLogs]);

  useEffect(() => {
    if (done) return;
    const t = setInterval(() => { if (!document.hidden) loadLogs(); }, 15000);
    return () => clearInterval(t);
  }, [loadLogs, done]);

  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const handleScroll = () => {
    if (!logContainerRef.current) return;
    const el = logContainerRef.current;
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    setAutoScroll(isAtBottom);
  };

  return (
    <div className="mt-10">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-heading text-lg font-semibold text-stone-100">运行日志</h3>
        <label className="flex items-center gap-1.5 text-xs text-stone-400 cursor-pointer">
          <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} className="accent-brass-500" />
          自动滚动
        </label>
      </div>
      <div
        ref={logContainerRef}
        onScroll={handleScroll}
        className="log-viewer bg-ink-950 border border-ink-700 rounded p-4 h-96 overflow-auto font-mono text-xs text-stone-300 whitespace-pre-wrap"
      >
        {logs || <span className="text-stone-500">暂无日志</span>}
      </div>
    </div>
  );
}
