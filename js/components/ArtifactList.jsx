const { useState, useEffect, useRef, useCallback, useMemo } = React;

function FileRow({ file, level, pipelineId, expanded, onView, onDownload, onCopy, onToggle }) {
    const paddingLeft = 16 + level * 20;
    const isOpen = !!expanded[file.name];
    return (
      <div className="border-b border-ink-800 last:border-b-0">
        <div
          className="flex items-center justify-between py-1.5 pr-3 cursor-pointer hover:bg-ink-800/30 transition-colors select-none"
          style={{ paddingLeft }}
          onClick={() => onView(file.name)}
        >
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className="text-stone-500 flex-shrink-0 text-xs w-3 text-center transition-transform" style={{ transform: isOpen ? 'rotate(90deg)' : 'none' }}>▶</span>
            <span className="text-stone-500 flex-shrink-0 text-xs">📄</span>
            <span className="text-stone-100 text-sm truncate">{file.name.split('/').pop()}</span>
            <span className="text-stone-500 text-xs flex-shrink-0">{(file.size / 1024).toFixed(1)} KB</span>
          </div>
        </div>
        {isOpen && (
          <div className="bg-ink-950 p-3 border-t border-ink-700 relative" style={{ paddingLeft: paddingLeft + 8 }}>
            <div className="absolute top-2 right-2 flex gap-2">
              <button onClick={() => onDownload(file.name)} className="text-stone-400 hover:text-stone-200 transition-colors text-xs" title="下载">⬇</button>
              {(fileCategory(file.name) === 'text') && <button onClick={() => onCopy(expanded[file.name], file.name)} className="text-stone-400 hover:text-stone-200 transition-colors text-xs" title="复制">📋</button>}
              <button onClick={() => onToggle(file.name)} className="text-stone-400 hover:text-stone-200 transition-colors text-xs">✕</button>
            </div>
            <h4 className="text-xs font-semibold text-stone-400 mb-1.5">{file.name}</h4>
            {fileCategory(file.name) === 'image' ? (
              <img src={expanded[file.name]} alt={file.name} className="max-w-full rounded" />
            ) : fileCategory(file.name) === 'video' ? (
              <video src={expanded[file.name]} controls className="max-w-full rounded" />
            ) : fileCategory(file.name) === 'audio' ? (
              <audio src={expanded[file.name]} controls className="w-full" />
            ) : (
              <pre className="text-xs text-stone-300 overflow-auto max-h-96 whitespace-pre-wrap">{expanded[file.name]}</pre>
            )}
          </div>
        )}
      </div>
    );
}

function DirNode({ name, node, level, path, pipelineId, treeOpen, onToggleDir, expanded, onView, onDownload, onCopy, onToggle }) {
    const fullPath = path ? `${path}/${name}` : name;
    const isOpen = treeOpen[fullPath] !== undefined ? treeOpen[fullPath] : level < 2;
    const paddingLeft = 16 + level * 20;

    const childDirs = Object.keys(node.__children || {}).sort();
    const childFiles = (node.__files || []).sort((a, b) => a.name.localeCompare(b.name));

    return (
      <div>
        <div
          className="flex items-center gap-1.5 py-1.5 pr-3 cursor-pointer hover:bg-ink-800/50 transition-colors select-none"
          style={{ paddingLeft }}
          onClick={() => onToggleDir(fullPath)}
        >
          <span className="text-stone-400 flex-shrink-0 text-xs w-3 text-center transition-transform" style={{ transform: isOpen ? 'rotate(90deg)' : 'none' }}>
            ▶
          </span>
          <span className="text-stone-500 flex-shrink-0 text-xs">📁</span>
          <span className="text-stone-200 text-sm font-medium">{name}</span>
          <span className="text-stone-600 text-xs ml-1">
            {childDirs.length + childFiles.length}项
          </span>
        </div>
        {isOpen && (
          <div>
            {childDirs.map(d => (
              <DirNode key={d} name={d} node={node.__children[d]} level={level + 1} path={fullPath}
                treeOpen={treeOpen} onToggleDir={onToggleDir}
                expanded={expanded} onView={onView} onDownload={onDownload} onCopy={onCopy} onToggle={onToggle} pipelineId={pipelineId} />
            ))}
            {childFiles.map(f => (
              <FileRow key={f.name} file={f} level={level + 1}
                pipelineId={pipelineId} expanded={expanded}
                onView={onView} onDownload={onDownload} onCopy={onCopy} onToggle={onToggle} />
            ))}
          </div>
        )}
      </div>
    );
}

function ArtifactList({ pipelineId }) {
  const [artifacts, setArtifacts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState({});
  const [treeOpen, setTreeOpen] = useState({});
  const expandedRef = useRef({});
  useEffect(() => { expandedRef.current = expanded; }, [expanded]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api(`/pipelines/${pipelineId}/artifacts`);
      if (res.ok) {
        const data = await res.json();
        setArtifacts(data.files || []);
      }
    } finally { setLoading(false); }
  }, [pipelineId]);

  useEffect(() => {
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, 10000);
    return () => clearInterval(t);
  }, [load]);

  const download = useCallback(async (name) => {
    try {
      const res = await api(`/pipelines/${pipelineId}/artifacts/${encodeURIComponent(name)}`);
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) { console.error(e); }
  }, [pipelineId]);

  const viewJson = useCallback(async (name) => {
    if (expandedRef.current[name]) {
      setExpanded(prev => { const next = { ...prev }; delete next[name]; return next; });
      return;
    }
    const cat = fileCategory(name);
    if (cat === 'text') {
      try {
        const res = await api(`/pipelines/${pipelineId}/artifacts/${encodeURIComponent(name)}`);
        if (!res.ok) throw new Error('Fetch failed');
        const text = await res.text();
        const MAX_PREVIEW = 50000;
        if (text.length > MAX_PREVIEW) {
          setExpanded(prev => ({ ...prev, [name]: text.substring(0, MAX_PREVIEW) + '\n\n... (文件过大，仅显示前 50KB，请下载查看完整内容)' }));
        } else {
          setExpanded(prev => ({ ...prev, [name]: text }));
        }
      } catch (e) { console.error(e); }
    } else {
      try {
        const res = await api(`/pipelines/${pipelineId}/artifacts/${encodeURIComponent(name)}`);
        if (!res.ok) throw new Error('Fetch failed');
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        setExpanded(prev => ({ ...prev, [name]: url }));
      } catch (e) { console.error(e); }
    }
  }, [pipelineId]);

  const toggleExpand = useCallback((name) => {
    setExpanded(prev => { const next = { ...prev }; if (next[name]) delete next[name]; return next; });
  }, []);

  const copyToClipboard = useCallback((text, name) => {
    navigator.clipboard.writeText(text).then(() => toast('已复制: ' + name)).catch(() => toast.error('复制失败'));
  }, []);

  function buildTree(files) {
    const root = {};
    for (const f of files) {
      const parts = f.name.split('/');
      let node = root;
      for (let i = 0; i < parts.length - 1; i++) {
        const dir = parts[i];
        if (!node.__children) node.__children = {};
        if (!node.__children[dir]) node.__children[dir] = {};
        node = node.__children[dir];
      }
      if (!node.__files) node.__files = [];
      node.__files.push(f);
    }
    return root;
  }

  const tree = React.useMemo(() => buildTree(artifacts), [artifacts]);
  const topDirs = React.useMemo(() => Object.keys(tree.__children || {}).sort(), [tree]);
  const rootFiles = React.useMemo(() => (tree.__files || []).sort((a, b) => a.name.localeCompare(b.name)), [tree]);

  const toggleDir = useCallback((path) => {
    setTreeOpen(prev => ({ ...prev, [path]: !(prev[path] !== undefined ? prev[path] : true) }));
  }, []);

  return (
    <div className="mt-10">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-heading text-lg font-semibold text-stone-100">产物文件</h3>
      </div>
      {artifacts.length === 0 && <p className="text-stone-500 text-sm">暂无产物文件</p>}
      <div className="bg-ink-900 rounded border border-ink-700 overflow-hidden">
        {rootFiles.map(f => (
          <FileRow key={f.name} file={f} level={0}
            pipelineId={pipelineId} expanded={expanded}
            onView={viewJson} onDownload={download} onCopy={copyToClipboard} onToggle={toggleExpand} />
        ))}
        {topDirs.map(d => (
          <DirNode key={d} name={d} node={tree.__children[d]} level={0} path=""
            treeOpen={treeOpen} onToggleDir={toggleDir}
            expanded={expanded} onView={viewJson} onDownload={download} onCopy={copyToClipboard} onToggle={toggleExpand} pipelineId={pipelineId} />
        ))}
      </div>
    </div>
  );
}
