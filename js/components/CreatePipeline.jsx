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
    <div className="bg-ink-900 rounded-lg p-8 border border-ink-700">
      <h2 className="font-heading text-lg font-semibold text-stone-100 mb-6">创建新 Pipeline</h2>
      {error && <div className="bg-clay-500/10 border border-clay-500/30 text-clay-400 p-3 rounded text-sm mb-4">{error}</div>}
      <div className="space-y-5">
        <div>
          <label className="block text-sm text-stone-300 mb-1.5 font-medium">上传剧本文件</label>
          <input ref={fileRef} type="file" accept=".txt,.md" onChange={handleFile}
            className="block w-full text-sm text-stone-400 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-medium file:bg-ink-700 file:text-stone-200 hover:file:bg-ink-600 file:transition-colors file:cursor-pointer cursor-pointer" />
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
            className="w-full bg-ink-950 border border-ink-700 rounded p-3 text-stone-200 text-sm focus:outline-none focus:border-brass-500/50 transition-colors placeholder:text-stone-500"
            placeholder="在此粘贴剧本内容..."
          />
        </div>
        <button onClick={submit} disabled={submitting}
          className="step-btn w-full py-2.5 bg-brass-500 hover:bg-brass-400 disabled:bg-ink-700 text-ink-950 rounded font-medium transition-all disabled:text-stone-400">
          {submitting ? '创建中...' : '创建 Pipeline'}
        </button>
      </div>
    </div>
  );
}
