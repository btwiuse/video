const STYLE_OPTIONS = [
  '电影级写实', '赛博朋克', '东方奇幻', '日系动画', '像素风', '复古胶片', '定格动画', '低多边形', '黑白悬疑',
];

const emptyStylePreset = () => ({
  name: '', description: '', image_style: '电影级写实', video_style: '电影级写实',
  image_prompt: '', video_prompt: '', aspect_ratio: '16:9', image_resolution: '1024x1024', video_resolution: '720p',
  is_default: false,
});

const presetTone = preset => {
  const source = `${preset.id || ''} ${preset.name || ''}`;
  if (source.includes('赛博')) return 'style-tone-cyber';
  if (source.includes('东方')) return 'style-tone-eastern';
  if (source.includes('动画')) return 'style-tone-anime';
  if (source.includes('像素')) return 'style-tone-pixel';
  return 'style-tone-cinematic';
};

function StyleChoiceGroup({ label, value, onChange }) {
  return <div>
    <label className="mb-2 block text-xs font-medium text-stone-300">{label}</label>
    <div className="flex flex-wrap gap-1.5">
      {STYLE_OPTIONS.map(option => <button key={option} type="button" onClick={() => onChange(option)}
        className={'rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ' + (value === option
          ? 'border-brass-500 bg-brass-500/10 text-brass-600'
          : 'border-ink-700 bg-ink-800 text-stone-400 hover:border-ink-600 hover:text-stone-200')}>
        {option}
      </button>)}
    </div>
  </div>;
}

function StylePresets({ onCreateNew }) {
  const [presets, setPresets] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState(emptyStylePreset);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api('/style-presets');
      if (!response.ok) throw new Error(await response.text());
      const data = await response.json();
      const next = data.presets || [];
      setPresets(next);
      setSelectedId(current => {
        const currentPreset = next.find(preset => preset.id === current);
        const selected = currentPreset || next.find(preset => preset.is_default) || next[0];
        if (selected) setDraft({ ...selected });
        return selected?.id || null;
      });
    } catch (requestError) {
      setError(requestError?.message || '风格预设加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const select = preset => {
    setSelectedId(preset.id);
    setDraft({ ...preset });
    setError('');
  };

  const beginCreate = () => {
    setSelectedId(null);
    setDraft(emptyStylePreset());
    setError('');
  };

  const updateDraft = (key, value) => setDraft(current => ({ ...current, [key]: value }));

  const save = async () => {
    const name = draft.name.trim();
    if (!name) {
      setError('请填写预设名称');
      return;
    }
    setSaving(true);
    setError('');
    const payload = { ...draft, name, organization_id: selectedId ? draft.organization_id : getActiveOrganizationId() };
    try {
      const response = await api(selectedId ? `/style-presets/${selectedId}` : '/style-presets', {
        method: selectedId ? 'PATCH' : 'POST', body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error(await response.text());
      const saved = await response.json();
      setSelectedId(saved.id);
      setDraft(saved);
      await load();
      toast(selectedId ? '风格预设已保存' : '风格预设已创建');
    } catch (requestError) {
      setError(requestError?.message || '保存失败，请稍后重试');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!selectedId || !window.confirm(`确定删除风格预设「${draft.name}」吗？`)) return;
    setDeleting(true);
    setError('');
    try {
      const response = await api(`/style-presets/${selectedId}`, { method: 'DELETE' });
      if (!response.ok) throw new Error(await response.text());
      setSelectedId(null);
      setDraft(emptyStylePreset());
      await load();
      toast('风格预设已删除');
    } catch (requestError) {
      setError(requestError?.message || '删除失败，请稍后重试');
    } finally {
      setDeleting(false);
    }
  };

  return <div>
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <button type="button" onClick={onCreateNew} className="nav-btn mb-3 text-sm text-stone-400 hover:text-brass-500">← 创建项目</button>
        <p className="text-[11px] font-medium tracking-wide text-brass-500">GLOBAL SETTINGS</p>
        <h2 className="mt-1 font-heading text-2xl font-semibold text-stone-100">风格预设</h2>
        <p className="mt-2 text-sm text-stone-400">统一项目的图像与视频视觉方向。</p>
      </div>
      <button type="button" onClick={beginCreate} className="volc-primary rounded-lg px-3.5 py-2 text-sm font-medium text-ink-950">+ 新建预设</button>
    </div>

    {error && <div className="mb-4 rounded-lg border border-clay-500/30 bg-clay-500/10 px-3 py-2.5 text-sm text-clay-400">{error}</div>}

    <div className="grid gap-5 lg:grid-cols-[minmax(230px,0.8fr)_minmax(0,1.8fr)]">
      <aside className="overflow-hidden rounded-xl border border-ink-700 bg-ink-900">
        <div className="border-b border-ink-700 px-4 py-3">
          <p className="text-xs font-medium text-stone-300">全部预设</p>
        </div>
        <div className="max-h-[640px] space-y-1 overflow-y-auto p-2">
          {loading && <p className="px-3 py-4 text-sm text-stone-500">加载中...</p>}
          {presets.map(preset => <button key={preset.id} type="button" onClick={() => select(preset)}
            className={'group flex w-full items-center gap-3 rounded-lg p-2.5 text-left transition-colors ' + (selectedId === preset.id ? 'bg-brass-500/10' : 'hover:bg-ink-800')}>
            <span className={`style-swatch ${presetTone(preset)}`} aria-hidden="true" />
            <span className="min-w-0 flex-1"><span className="flex items-center gap-1.5"><span className={'truncate text-sm font-medium ' + (selectedId === preset.id ? 'text-brass-600' : 'text-stone-200')}>{preset.name}</span>{preset.is_default && <span className="rounded bg-leaf-500/10 px-1.5 py-0.5 text-[10px] font-medium text-leaf-500">默认</span>}</span><span className="mt-0.5 block truncate text-xs text-stone-500">{preset.description || preset.image_style}</span></span>
          </button>)}
        </div>
      </aside>

      <section className="rounded-xl border border-ink-700 bg-ink-900 p-5 sm:p-6">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-ink-700 pb-4">
          <div className="flex min-w-0 items-center gap-3"><span className={`style-swatch h-10 w-10 ${presetTone(draft)}`} aria-hidden="true" /><div className="min-w-0"><h3 className="truncate font-heading text-lg font-semibold text-stone-100">{selectedId ? draft.name || '编辑预设' : '新建风格预设'}</h3><p className="mt-0.5 text-xs text-stone-500">图像与视频提示词会随预设保存。</p></div></div>
          {selectedId && <button type="button" onClick={remove} disabled={deleting} className="rounded-md px-2.5 py-1.5 text-xs font-medium text-clay-400 hover:bg-clay-500/10 disabled:opacity-50">{deleting ? '删除中…' : '删除'}</button>}
        </div>

        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div><label className="mb-1.5 block text-xs font-medium text-stone-300">预设名称</label><input value={draft.name} maxLength={60} onChange={event => updateDraft('name', event.target.value)} placeholder="例如：都市悬疑" className="style-input" /></div>
            <div><label className="mb-1.5 block text-xs font-medium text-stone-300">简短说明</label><input value={draft.description} maxLength={160} onChange={event => updateDraft('description', event.target.value)} placeholder="一句话说明它的视觉气质" className="style-input" /></div>
          </div>

          <div className="grid gap-5 border-y border-ink-700 py-5 lg:grid-cols-2">
            <div className="space-y-4"><StyleChoiceGroup label="图像风格" value={draft.image_style} onChange={value => updateDraft('image_style', value)} /><div><label className="mb-1.5 block text-xs font-medium text-stone-300">图像提示词</label><textarea value={draft.image_prompt} maxLength={1000} rows={5} onChange={event => updateDraft('image_prompt', event.target.value)} placeholder="补充画面质感、光影、构图和材质方向" className="style-input resize-y" /></div></div>
            <div className="space-y-4"><StyleChoiceGroup label="视频风格" value={draft.video_style} onChange={value => updateDraft('video_style', value)} /><div><label className="mb-1.5 block text-xs font-medium text-stone-300">视频提示词</label><textarea value={draft.video_prompt} maxLength={1000} rows={5} onChange={event => updateDraft('video_prompt', event.target.value)} placeholder="补充镜头运动、节奏和动态效果" className="style-input resize-y" /></div></div>
          </div>

          <div>
            <h4 className="mb-3 text-sm font-semibold text-stone-200">输出配置</h4>
            <div className="grid gap-4 sm:grid-cols-3">
              <div><label className="mb-1.5 block text-xs font-medium text-stone-400">画幅</label><select value={draft.aspect_ratio} onChange={event => updateDraft('aspect_ratio', event.target.value)} className="style-input"><option>16:9</option><option>9:16</option><option>1:1</option><option>21:9</option></select></div>
              <div><label className="mb-1.5 block text-xs font-medium text-stone-400">图像尺寸</label><select value={draft.image_resolution} onChange={event => updateDraft('image_resolution', event.target.value)} className="style-input"><option>1024x1024</option><option>1536x1024</option><option>1024x1536</option></select></div>
              <div><label className="mb-1.5 block text-xs font-medium text-stone-400">视频分辨率</label><select value={draft.video_resolution} onChange={event => updateDraft('video_resolution', event.target.value)} className="style-input"><option>720p</option><option>1080p</option><option>4K</option></select></div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-700 pt-5">
            <button type="button" onClick={() => updateDraft('is_default', !draft.is_default)} className={'rounded-lg border px-3 py-2 text-sm font-medium transition-colors ' + (draft.is_default ? 'border-leaf-500/50 bg-leaf-500/10 text-leaf-500' : 'border-ink-700 text-stone-400 hover:text-stone-200')}>
              {draft.is_default ? '✓ 默认预设' : '设为默认'}
            </button>
            <button type="button" onClick={save} disabled={saving} className="volc-primary rounded-lg px-4 py-2 text-sm font-medium text-ink-950 disabled:opacity-50">{saving ? '保存中…' : '保存预设'}</button>
          </div>
        </div>
      </section>
    </div>
  </div>;
}
