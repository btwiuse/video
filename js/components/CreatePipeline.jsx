const { useState, useEffect, useRef, useCallback, useMemo } = React;

function CreatePipeline({ onCreated }) {
  const [scriptFile, setScriptFile] = useState(null);
  const [scriptText, setScriptText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef();

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
      const res = await fetch(`${API_BASE}/pipelines`, { method: 'POST', body: fd });
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
