const { useState, useEffect, useRef, useCallback, useMemo } = React;

const promptPathFromImage = (name) => {
  if (name.startsWith('characters/')) {
    const refId = name.split('/')[1]?.replace(/_(front|profile|fullbody)\.(jpg|jpeg|png)$/, '');
    return refId ? `characters/${refId}.md` : null;
  }
  if (name.startsWith('scenes/')) {
    const sid = name.split('/')[1]?.replace(/_(wide|detail)\.(jpg|jpeg|png)$/, '');
    return sid ? `scenes/${sid}.md` : null;
  }
  if (name.startsWith('props/')) {
    const refId = name.split('/')[1]?.replace(/_reference\.(jpg|jpeg|png|webp)$/, '');
    return refId ? `props/${refId}.md` : null;
  }
  if (name.startsWith('shots/')) {
    const m = name.match(/shots\/([^/]+)\/\1_startframe\./);
    return m ? `shots/${m[1]}/${m[1]}_startframe.md` : null;
  }
  return null;
};

function AssetPreview({ file, pipelineId, cacheBust, aspectClass, onOpen, label }) {
  const isPlaceholder = file?.placeholder;
  return (
    <div className={`relative overflow-hidden bg-ink-950 ${aspectClass}`}>
      {isPlaceholder ? (
        <button
          type="button"
          onClick={() => onOpen(file.name)}
          className="w-full h-full flex flex-col items-center justify-center gap-2 bg-ink-800/70 text-stone-600 hover:bg-ink-700/70 transition-colors"
        >
          <span className="w-9 h-9 rounded-full border border-dashed border-ink-500 flex items-center justify-center text-lg">+</span>
          <span className="text-xs">等待生成</span>
        </button>
      ) : (
        <img
          src={artifactUrl(pipelineId, file.name, cacheBust[file.name])}
          alt={label || file.name.split('/').pop()}
          className="w-full h-full object-cover cursor-pointer transition-transform duration-300 group-hover:scale-[1.03]"
          onError={e => { e.currentTarget.style.display = 'none'; }}
          onClick={() => onOpen(file.name)}
        />
      )}
    </div>
  );
}

function AssetToolbar({ onGenerate, onUpload, onDelete, disabled }) {
  const uploadRef = useRef(null);
  return (
    <div className="absolute top-2 right-2 z-10 flex items-center gap-1 rounded-lg border border-ink-600/80 bg-ink-950/85 p-1 shadow-lg opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
      <button type="button" title="AI 生成" onClick={onGenerate} disabled={disabled} className="w-7 h-7 rounded-md text-brass-400 hover:bg-brass-500 hover:text-ink-950 disabled:opacity-40">✦</button>
      <button type="button" title="本地上传" onClick={() => uploadRef.current?.click()} disabled={disabled} className="w-7 h-7 rounded-md text-stone-300 hover:bg-ink-700 disabled:opacity-40">⇧</button>
      {onDelete && <button type="button" title="删除" onClick={onDelete} disabled={disabled} className="w-7 h-7 rounded-md text-clay-400 hover:bg-clay-500 hover:text-white disabled:opacity-40">⌫</button>}
      <input ref={uploadRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={event => { const file = event.target.files?.[0]; if (file) onUpload(file); event.target.value = ''; }} />
    </div>
  );
}

function ReferenceSelectionCard({ entity, kind, selected, pipelineId, cacheBust, onChange }) {
  const refId = entity.ref_id;
  const name = entity.name || refId;
  const imageNames = kind === 'character'
    ? [`characters/${refId}_front.jpg`, `characters/${refId}_front.png`, `characters/${refId}_front.webp`]
    : [`props/${refId}_reference.jpg`, `props/${refId}_reference.png`, `props/${refId}_reference.webp`];
  return <label title={name} className={'group relative block cursor-pointer overflow-hidden rounded-lg border transition-colors ' + (selected ? 'border-brass-500 bg-brass-500/10 shadow-[0_0_0_1px_rgba(207,174,84,.25)]' : 'border-ink-600 bg-ink-900 hover:border-ink-500')}>
    <input type="checkbox" className="sr-only" checked={selected} onChange={onChange}/>
    <span className="relative block aspect-square overflow-hidden border-b border-ink-700 bg-ink-800"><span className="absolute inset-0 flex items-center justify-center text-lg font-medium text-stone-500">{(name || '?').slice(0, 1)}</span><img src={artifactUrl(pipelineId, imageNames[0], cacheBust?.[imageNames[0]])} alt="" data-image-index="0" className="absolute inset-0 h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.04]" onError={event => { const image = event.currentTarget; const nextIndex = Number(image.dataset.imageIndex || 0) + 1; if (nextIndex < imageNames.length) { image.dataset.imageIndex = String(nextIndex); const nextName = imageNames[nextIndex]; image.src = artifactUrl(pipelineId, nextName, cacheBust?.[nextName]); return; } image.style.display = 'none'; }}/>{selected && <span className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-brass-500 text-[10px] font-bold text-ink-950">✓</span>}</span>
    <span className={'block truncate px-1.5 py-1.5 text-center text-[11px] font-medium ' + (selected ? 'text-brass-400' : 'text-stone-300')}>{name}</span>
  </label>;
}

function StartFramePanel({ shot, frame, video, pipelineId, cacheBust, onOpen, onGenerate, onUpload, generating, generatingVideo, onGenerateVideo }) {
  const startFrame = frame || { name: shot.startframe_file || `shots/${shot.full_shot_id}/${shot.full_shot_id}_startframe.jpg`, placeholder: true, shot_id: shot.full_shot_id };
  return <section className="border-t border-ink-700 bg-ink-950/35 px-4 py-4"><div className="mb-3 flex items-center justify-between gap-3"><div><h5 className="text-xs font-semibold text-stone-200">镜头起始帧</h5><p className="mt-1 text-xs text-stone-500">此帧仅服务当前分镜，可用 AI 生成或本地上传。</p></div><button type="button" onClick={() => onGenerate(shot, startFrame)} disabled={generating} className="rounded-md bg-ink-800 px-2.5 py-1.5 text-xs font-medium text-stone-300 hover:bg-brass-500 hover:text-ink-950 disabled:opacity-50">{generating ? '生成中…' : startFrame.placeholder ? '生成起始帧' : '重新生成起始帧'}</button></div><div className="group relative max-w-md overflow-hidden rounded-lg border border-ink-700"><AssetPreview file={startFrame} pipelineId={pipelineId} cacheBust={cacheBust} aspectClass="aspect-video" onOpen={onOpen} label={shot.title || shot.full_shot_id} /><AssetToolbar onGenerate={() => onGenerate(shot, startFrame)} onUpload={file => onUpload(shot, file)} disabled={generating} /></div><div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-ink-700 bg-ink-900/70 px-3 py-2.5"><div className="min-w-0 flex-1"><p className="text-xs font-medium text-stone-200">分镜视频</p><p className="mt-0.5 text-xs text-stone-500">{video ? '该分镜视频已生成，可单独重新生成。' : '使用当前分镜信息与视觉参考生成视频。'}</p></div><button type="button" onClick={() => onGenerateVideo(shot)} disabled={generatingVideo} className="rounded-md bg-brass-500 px-3 py-1.5 text-xs font-semibold text-ink-950 hover:bg-brass-400 disabled:opacity-50">{generatingVideo ? '视频生成中…' : video ? '重新生成分镜视频' : '生成分镜视频'}</button></div></section>;
}

const SHOT_SKILL_GROUPS = [
  { label: '镜头语言', skills: [
    ['cinematic-audiovisual-language', '电影视听语言', '强化镜头功能、空间与运镜逻辑'],
    ['high-tension-shot-design', '高张力镜头设计', '强化危险感、压迫感与冲击画面'],
  ] },
  { label: '动作设计', skills: [
    ['action-choreography-reference', '动作编排参考', '让动作具有重心、受力与反应'],
    ['action-rhythm-editing', '动作节奏剪辑', '按时长安排铺垫、高潮与收束'],
    ['action-showcase-direction', '动作展示导演', '设计武器、能力或角色动作展示'],
    ['seedance-fight-director', 'Seedance 格斗导演', '面向格斗、追逐和武器动作优化'],
  ] },
  { label: '视觉与声音', skills: [
    ['ai-material-realism', 'AI 材质真实感', '强化材质、光影与接触关系'],
    ['cinematic-music-sound-design', '电影音乐与声音设计', '补充节奏、音效与声画提示'],
  ] },
];

function ShotSkillPanel({ shot, onOptimize, optimizing, disabled }) {
  const serializedSkills = JSON.stringify(shot.skill_ids || []);
  const [selectedSkills, setSelectedSkills] = useState(shot.skill_ids || []);
  const savedInstruction = shot.skill_optimization?.custom_instruction || '';
  const [customInstruction, setCustomInstruction] = useState(savedInstruction);
  const [skillMenuOpen, setSkillMenuOpen] = useState(false);
  const skillPanelRef = useRef(null);
  useEffect(() => { setSelectedSkills(shot.skill_ids || []); }, [shot.full_shot_id, serializedSkills]);
  useEffect(() => { setCustomInstruction(shot.skill_optimization?.custom_instruction || ''); }, [shot.full_shot_id, savedInstruction]);
  useEffect(() => { setSkillMenuOpen(false); }, [shot.full_shot_id]);
  useEffect(() => {
    if (!skillMenuOpen) return undefined;
    const closeOnOutside = event => {
      if (!skillPanelRef.current?.contains(event.target)) setSkillMenuOpen(false);
    };
    const closeOnEscape = event => {
      if (event.key === 'Escape') setSkillMenuOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutside);
    document.addEventListener('focusin', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutside);
      document.removeEventListener('focusin', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [skillMenuOpen]);
  const selectedLabels = SHOT_SKILL_GROUPS.flatMap(group => group.skills)
    .filter(([id]) => selectedSkills.includes(id)).map(([, label]) => label);
  const optimization = shot.skill_optimization || {};
  const toggleSkill = skillId => {
    setSelectedSkills(current => {
      if (current.includes(skillId)) return current.filter(id => id !== skillId);
      return [...current, skillId];
    });
  };
  const canOptimize = selectedSkills.length > 0 || customInstruction.trim().length > 0;
  return <section ref={skillPanelRef} className="space-y-2 rounded-lg border border-ink-700 bg-ink-900/70 p-3">
    <div className="flex items-center justify-between gap-2"><span className="text-xs font-medium text-stone-300">Skill 精调</span><span className="text-[10px] text-stone-600">默认：专业分镜导演</span></div>
    <div className="relative"><textarea value={customInstruction} maxLength={2000} disabled={disabled || optimizing} onChange={event => setCustomInstruction(event.target.value)} placeholder="输入本镜头的精调要求，例如：动作更克制，人物先短暂停顿再缓慢转头。" className="min-h-24 w-full resize-y rounded-md border border-ink-600 bg-ink-950 px-2.5 pb-6 pt-2 text-xs leading-relaxed text-stone-100 placeholder:text-stone-600 focus:border-brass-500 focus:outline-none disabled:opacity-50"/>
      <span className="pointer-events-none absolute bottom-2 left-2 text-[10px] text-stone-600">{customInstruction.length}/2000</span>
    </div>
    <div className="relative flex items-center justify-between gap-2"><span className="min-w-0 truncate text-[11px] text-stone-500">{selectedLabels.length ? `已加载：${selectedLabels.join('、')}` : '可选：为本镜头加载额外 Skill'}</span><button type="button" title="选择要加载的 Skill" aria-label="选择要加载的 Skill" aria-expanded={skillMenuOpen} onClick={() => setSkillMenuOpen(current => !current)} disabled={disabled || optimizing} className={'shrink-0 flex h-6 items-center gap-1 rounded border px-1.5 text-[10px] transition-colors disabled:opacity-50 ' + (selectedSkills.length ? 'border-brass-500/70 bg-brass-500/10 text-brass-400' : 'border-ink-600 bg-ink-900 text-stone-400 hover:border-ink-500 hover:text-stone-200')}><span className="text-sm leading-none">⋯</span><span>{selectedSkills.length ? `已选 ${selectedSkills.length}` : '选择 Skill'}</span></button>
      {skillMenuOpen && <div className="absolute right-0 top-full z-20 mt-2 max-h-96 w-80 max-w-[calc(100vw-3rem)] overflow-y-auto rounded-lg border border-ink-600 bg-ink-900 p-2.5 shadow-2xl shadow-black/40"><div className="mb-3"><p className="text-xs font-medium text-stone-100">加载可选 Skill</p><p className="mt-0.5 text-[10px] text-stone-500">可自由组合；默认 Skill 始终参与。</p></div>{SHOT_SKILL_GROUPS.map((group, groupIndex) => <div key={group.label} className={groupIndex ? 'mt-3' : ''}><div className="flex items-center gap-2"><p className="text-[10px] font-semibold text-stone-400">{group.label}</p><span className="h-px flex-1 bg-ink-700"/></div><div className="mt-1 overflow-hidden rounded-md border border-ink-700 divide-y divide-ink-700">{group.skills.map(([id, label, description]) => <label key={id} className={'flex cursor-pointer items-center gap-2 px-2 py-1.5 transition-colors ' + (selectedSkills.includes(id) ? 'bg-brass-500/10' : 'hover:bg-ink-800/70')}><span className="min-w-0 flex-1"><span className={selectedSkills.includes(id) ? 'text-xs font-medium text-brass-400' : 'text-xs font-medium text-stone-300'}>{label}</span><span className="ml-1 text-[10px] leading-relaxed text-stone-500">· {description}</span></span><input type="checkbox" className="shrink-0 accent-brass-500" checked={selectedSkills.includes(id)} disabled={disabled || optimizing} onChange={() => toggleSkill(id)}/></label>)}</div></div>)}</div>}
    </div>
    {optimization.summary && <p className="rounded-md bg-leaf-500/10 px-2.5 py-2 text-xs leading-relaxed text-leaf-400">已应用：{optimization.summary}</p>}
    <button type="button" onClick={() => onOptimize(shot, selectedSkills, customInstruction)} disabled={disabled || optimizing || !canOptimize} className="w-full rounded-md bg-brass-500 px-3 py-2 text-xs font-semibold text-ink-950 hover:bg-brass-400 disabled:cursor-not-allowed disabled:opacity-40">{optimizing ? '正在应用 Skill…' : '应用并优化分镜'}</button>
  </section>;
}

function StoryboardEditor({ storyboard, onChange, onSave, saving, onOptimizeSkills, optimizingSkills, startFrames, videos, pipelineId, cacheBust, onOpenStartFrame, onGenerateStartFrame, onUploadStartFrame, onGenerateShotVideo, regenerating, generatingVideos }) {
  const shots = storyboard?.shots || [];
  const characters = storyboard?.characters || [];
  const scenes = storyboard?.scenes || [];
  const props = storyboard?.props || [];
  const update = (id, patch) => onChange({ ...storyboard, shots: shots.map(shot => shot.full_shot_id === id ? { ...shot, ...patch } : shot) });
  const toggle = (shot, field, id) => update(shot.full_shot_id, { [field]: (shot[field] || []).includes(id) ? (shot[field] || []).filter(value => value !== id) : [...(shot[field] || []), id] });
  const nextId = (source = 'SHOT_MANUAL') => { let n = 1; while (shots.some(shot => shot.full_shot_id === `${source}_${String(n).padStart(2, '0')}`)) n++; return `${source}_${String(n).padStart(2, '0')}`; };
  // Creating a shot is a structural change, so save it immediately. Ordinary
  // text edits can still be saved in one batch with the explicit save action.
  const commitStructure = (nextStoryboard, successMessage) => { onChange(nextStoryboard); onSave(nextStoryboard, successMessage); };
  const add = () => { const id = nextId(); commitStructure({ ...storyboard, shots: [...shots, { full_shot_id: id, title: '新建分镜', description: '', positive_prompt: '', action_description: '', character_refs: [], prop_refs: [], scene_id: '', duration_sec: 5, transition_type: 'B', generation_mode: 'reference' }] }, `已创建新建分镜 ${id}`); };
  const copy = shot => { const id = nextId('SHOT_COPY'); commitStructure({ ...storyboard, shots: [...shots, { ...shot, full_shot_id: id, title: `${shot.title || shot.full_shot_id}（副本）`, startframe_file: '' }] }, `已复制分镜为 ${id}`); };
  const remove = shot => { if (window.confirm(`确定删除分镜「${shot.title || shot.full_shot_id}」吗？`)) commitStructure({ ...storyboard, shots: shots.filter(item => item.full_shot_id !== shot.full_shot_id) }, `已删除分镜 ${shot.full_shot_id}`); };
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ink-700 bg-ink-950/45 px-4 py-3"><div><h4 className="text-sm font-semibold text-stone-100">分镜表</h4><p className="mt-1 text-xs text-stone-500">{shots.length} 个分镜 · {shots.reduce((total, shot) => total + Number(shot.duration_sec || 0), 0).toFixed(1)} 秒。编辑后保存，视频生成会使用最新内容。</p></div><div className="flex gap-2"><button type="button" disabled={saving} onClick={add} className="rounded-lg border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-stone-200 hover:border-brass-500 hover:text-brass-400 disabled:opacity-50">+ 添加分镜</button><button type="button" disabled={saving} onClick={() => onSave()} className="rounded-lg bg-brass-500 px-3 py-2 text-sm font-medium text-ink-950 hover:bg-brass-400 disabled:opacity-50">{saving ? '保存中…' : '保存分镜'}</button></div></div>
    {shots.map((shot, index) => <article key={shot.full_shot_id} className="rounded-xl border border-ink-700 bg-ink-900/80 overflow-hidden"><header className="flex flex-wrap items-center gap-3 border-b border-ink-700 px-4 py-3"><span className="flex h-6 w-6 items-center justify-center rounded bg-brass-500 text-xs font-bold text-ink-950">{index + 1}</span><input value={shot.title || ''} onChange={event => update(shot.full_shot_id, { title: event.target.value })} placeholder="分镜标题" className="min-w-32 flex-1 bg-transparent text-sm font-semibold text-stone-100 outline-none placeholder:text-stone-600"/><span className="font-mono text-xs text-stone-600">{shot.full_shot_id}</span><button type="button" onClick={() => copy(shot)} className="rounded px-2 py-1 text-xs text-stone-400 hover:bg-ink-800 hover:text-stone-100">复制</button><button type="button" onClick={() => remove(shot)} className="rounded px-2 py-1 text-xs text-clay-400 hover:bg-clay-500/15">删除</button></header>
      <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_280px]"><div className="flex h-full min-h-0 flex-col gap-4"><label className="block"><span className="text-xs font-medium text-stone-300">分镜描述</span><textarea value={shot.description || ''} onChange={event => update(shot.full_shot_id, { description: event.target.value })} placeholder="描述这一段剧情、人物和情绪" className="mt-1.5 min-h-20 w-full rounded-lg border border-ink-600 bg-ink-950 px-3 py-2 text-sm text-stone-100 placeholder:text-stone-600 focus:border-brass-500 focus:outline-none"/></label><label className="flex min-h-32 flex-1 flex-col"><span className="text-xs font-medium text-stone-300">视频提示词 / 镜头动作</span><textarea value={shot.positive_prompt || shot.action_description || ''} onChange={event => update(shot.full_shot_id, { positive_prompt: event.target.value, action_description: event.target.value })} placeholder="景别、机位、人物动作、光影和镜头运动…" className="mt-1.5 min-h-32 w-full grow resize-y rounded-lg border border-ink-600 bg-ink-950 px-3 py-2 text-sm leading-relaxed text-stone-100 placeholder:text-stone-600 focus:border-brass-500 focus:outline-none"/></label></div>
        <aside className="space-y-3 rounded-lg bg-ink-950/60 p-3">
          <div><span className="text-xs font-medium text-stone-300">视频生成模式</span><div className="mt-2 flex gap-2"><label className={'cursor-pointer rounded-md border px-2 py-1.5 text-xs ' + ((shot.generation_mode || 'reference') === 'reference' ? 'border-brass-500 bg-brass-500/10 text-brass-400' : 'border-ink-600 text-stone-400')}><input type="radio" className="sr-only" checked={(shot.generation_mode || 'reference') === 'reference'} onChange={() => update(shot.full_shot_id, { generation_mode: 'reference' })}/>全能参考</label><label className={'cursor-pointer rounded-md border px-2 py-1.5 text-xs ' + (shot.generation_mode === 'first_last' ? 'border-brass-500 bg-brass-500/10 text-brass-400' : 'border-ink-600 text-stone-400')}><input type="radio" className="sr-only" checked={shot.generation_mode === 'first_last'} onChange={() => update(shot.full_shot_id, { generation_mode: 'first_last' })}/>首尾帧</label></div></div>
          <label className="block"><span className="text-xs text-stone-400">时长（秒）</span><input type="number" min="1" max="15" step="0.5" value={shot.duration_sec || 5} onChange={event => update(shot.full_shot_id, { duration_sec: Number(event.target.value) })} className="mt-1 w-full rounded-md border border-ink-600 bg-ink-900 px-2 py-1.5 text-sm text-stone-100 focus:border-brass-500 focus:outline-none"/></label>
          <label className="block"><span className="text-xs text-stone-400">分镜场景</span><select value={shot.scene_id || ''} onChange={event => update(shot.full_shot_id, { scene_id: event.target.value })} className="mt-1 w-full rounded-md border border-ink-600 bg-ink-900 px-2 py-1.5 text-sm text-stone-100 focus:border-brass-500 focus:outline-none"><option value="">请选择场景</option>{scenes.map(scene => <option key={scene.scene_id} value={scene.scene_id}>{scene.name || scene.scene_id}</option>)}</select></label>
          <div><span className="text-xs text-stone-400">出镜角色</span><div className="mt-1.5 grid gap-1.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))' }}>{characters.map(character => <ReferenceSelectionCard key={character.ref_id} entity={character} kind="character" selected={(shot.character_refs || []).includes(character.ref_id)} pipelineId={pipelineId} cacheBust={cacheBust} onChange={() => toggle(shot, 'character_refs', character.ref_id)}/>)}</div></div>
          <div><span className="text-xs text-stone-400">场景道具</span><div className="mt-1.5 grid gap-1.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))' }}>{props.map(prop => <ReferenceSelectionCard key={prop.ref_id} entity={prop} kind="prop" selected={(shot.prop_refs || []).includes(prop.ref_id)} pipelineId={pipelineId} cacheBust={cacheBust} onChange={() => toggle(shot, 'prop_refs', prop.ref_id)}/>)}</div></div>
          <ShotSkillPanel shot={shot} onOptimize={onOptimizeSkills} optimizing={Boolean(optimizingSkills[shot.full_shot_id])} disabled={saving}/>
        </aside></div>
      <StartFramePanel shot={shot} frame={startFrames[shot.full_shot_id]} video={videos[shot.full_shot_id]} pipelineId={pipelineId} cacheBust={cacheBust} onOpen={onOpenStartFrame} onGenerate={onGenerateStartFrame} onUpload={onUploadStartFrame} onGenerateVideo={onGenerateShotVideo} generating={regenerating['shot_' + shot.full_shot_id]} generatingVideo={generatingVideos[shot.full_shot_id]} />
    </article>)}
  </div>;
}

const STEP1_PROGRESS_STAGES = [
  { phase: 1, key: 'overview', label: '剧本概览', description: '分析剧本并提取基础要素' },
  { phase: 2, key: 'characters', label: '角色设定', description: '完善角色外观与人物设定' },
  { phase: 3, key: 'props', label: '道具设定', description: '完善关键道具与视觉特征' },
  { phase: 4, key: 'scenes', label: '场景设定', description: '完善场景氛围与空间信息' },
  { phase: 5, key: 'storyboard', label: '分镜生成', description: '为每个场景生成镜头分镜' },
];

const countLogMatches = (text, pattern) => (text.match(pattern) || []).length;

// pipeline.log is appended to when a user regenerates a step. Restrict parsing
// to the last Step 1 run so a previous finished run never masks live progress.
function parseStep1Progress(logText) {
  const text = String(logText || '').replace(/\r/g, '');
  const runStart = Math.max(text.lastIndexOf('-> Chat: Phase 1'), text.lastIndexOf('Phase 1 done:'));
  const currentRun = runStart >= 0 ? text.slice(runStart) : text;
  const phaseOne = currentRun.match(/Phase 1 done:\s*(\d+) characters,\s*(\d+) scenes,\s*(\d+) props/);
  const totals = {
    characters: Number(currentRun.match(/Phase 2: defining\s+(\d+)\s+characters/)?.[1] || phaseOne?.[1] || 0),
    props: Number(currentRun.match(/Phase 3: defining\s+(\d+)\s+props/)?.[1] || phaseOne?.[3] || 0),
    scenes: Number(currentRun.match(/Phase 4: defining\s+(\d+)\s+scenes/)?.[1] || phaseOne?.[2] || 0),
    storyboard: Number(currentRun.match(/Phase 5: generating shots for\s+(\d+)\s+scenes/)?.[1] || phaseOne?.[2] || 0),
  };
  const completed = {
    overview: phaseOne ? 1 : 0,
    characters: countLogMatches(currentRun, /Phase 2:\s+.+?\s+\([^)]+\) done/g),
    props: countLogMatches(currentRun, /Phase 3:\s+.+?\s+\([^)]+\) done/g),
    scenes: countLogMatches(currentRun, /Phase 4:\s+.+?\s+\([^)]+\) done/g),
    storyboard: countLogMatches(currentRun, /Phase 5:\s+.+?\s+done\s+\(\d+ shots\)/g),
  };
  const phaseStarts = [
    currentRun.search(/Phase 2: defining/),
    currentRun.search(/Phase 3: defining/),
    currentRun.search(/Phase 4: defining/),
    currentRun.search(/Phase 5: generating shots/),
  ];
  const currentPhase = phaseStarts.reduce((phase, start, index) => start >= 0 ? index + 2 : phase, 1);
  const stages = STEP1_PROGRESS_STAGES.map(stage => {
    const total = stage.key === 'overview' ? 1 : totals[stage.key];
    const done = Math.min(completed[stage.key], total || completed[stage.key]);
    // Empty collections are intentionally skipped by the Python pipeline.
    const skipped = stage.phase < currentPhase && total === 0;
    return { ...stage, total, done, skipped, complete: skipped || (total > 0 && done >= total) };
  });
  const active = stages.find(stage => stage.phase === currentPhase) || stages[0];
  // Python writes the final storyboard files after its last "Phase 5 done"
  // line. Do not present that short persistence window as generation work.
  const complete = stages.every(stage => stage.complete);
  return { active, stages, complete, hasLog: Boolean(currentRun.trim()) };
}

function Step1Progress({ progress }) {
  const active = progress?.active || STEP1_PROGRESS_STAGES[0];
  const stages = progress?.stages || STEP1_PROGRESS_STAGES.map(stage => ({ ...stage, total: stage.phase === 1 ? 1 : 0, done: 0, complete: false, skipped: false }));
  const activeStage = stages.find(stage => stage.phase === active.phase) || active;
  const isFinalizing = Boolean(progress?.complete);
  const countText = isFinalizing
    ? '全部阶段已完成，正在保存结果'
    : activeStage.phase === 1
    ? (activeStage.done ? '基础要素已提取' : '正在分析剧本内容')
    : activeStage.total > 0
      ? `已完成 ${activeStage.done}/${activeStage.total}`
      : '正在准备内容';
  return <section className="mb-6 rounded-xl border border-brass-500/30 bg-brass-500/[0.06] px-4 py-3.5" aria-live="polite">
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
      <div className="flex items-center gap-2.5"><span className={'h-2 w-2 rounded-full ' + (isFinalizing ? 'bg-leaf-400' : 'animate-pulse bg-brass-400')}/><div><p className="text-sm font-semibold text-stone-100">{isFinalizing ? '5/5 阶段已完成 · 正在保存分镜结果' : `第 ${active.phase}/5 阶段 · ${active.label}`}</p><p className="mt-0.5 text-xs text-stone-500">{isFinalizing ? '所有场景的分镜已生成，正在写入分镜文件。' : active.description}</p></div></div>
      <span className="rounded-full border border-brass-500/25 bg-ink-950/50 px-2.5 py-1 text-xs font-medium text-brass-400">{countText}</span>
    </div>
    <div className="mt-4 grid grid-cols-2 gap-x-2 gap-y-2 sm:grid-cols-5">
      {stages.map(stage => {
        const isActive = !isFinalizing && stage.phase === active.phase;
        const isDone = stage.complete && !isActive;
        return <div key={stage.key} className={'flex min-w-0 items-center gap-2 rounded-lg border px-2.5 py-2 transition-colors ' + (isActive ? 'border-brass-500/60 bg-brass-500/10' : isDone ? 'border-leaf-500/25 bg-leaf-500/[0.06]' : 'border-ink-700 bg-ink-950/35')}>
          <span className={'flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ' + (isActive ? 'bg-brass-500 text-ink-950' : isDone ? 'bg-leaf-500 text-ink-950' : 'bg-ink-700 text-stone-500')}>{isDone ? '✓' : isActive ? stage.phase : stage.phase}</span>
          <span className={'truncate text-xs font-medium ' + (isActive ? 'text-brass-400' : isDone ? 'text-leaf-400' : 'text-stone-500')}>{stage.label}</span>
        </div>;
      })}
    </div>
  </section>;
}

function StepView({ step, pipeline, onRun, actionLoading, pipelineId, onCancel, onRefresh, visualAssetsCompletionKnown, onVisualAssetsCompletionChange,
                    assetTab: controlledAssetTab, onAssetTabChange, onAssetOverviewChange,
                    maxShotsPerScene, setMaxShotsPerScene, totalShots, setTotalShots, totalDuration, setTotalDuration }) {
  const getCS = () => {
    if (pipeline.status === 'done') return WORKFLOW_STEP_COUNT;
    // A running step is in progress, not completed.  Keep this aligned with
    // PipelineDetail so its header never says "已完成" beside "生成中".
    if (pipeline.status === 'running') return Math.max(0, workflowStep(pipeline.step || 1) - 1);
    if (pipeline.status === 'failed' || pipeline.status === 'canceled') return Math.max(0, workflowStep(pipeline.step || 1) - 1);
    const pipelineStep = workflowStep(pipeline.step);
    if (pipelineStep === 1 && visualAssetsCompletionKnown) return 2;
    if (pipelineStep === 2 && !visualAssetsCompletionKnown) return 1;
    return pipelineStep;
  };
  const currentStep = getCS();
  const isStepDone = step <= currentStep || pipeline.status === 'done';
  const isStepRunning = pipeline.status === 'running' && pipeline.step === step;
  const canGenerate = (step === currentStep + 1 || step <= currentStep) && !actionLoading;
  const [artifacts, setArtifacts] = useState([]);
  const [artLoading, setArtLoading] = useState(false);
  const [artifactsLoadedFor, setArtifactsLoadedFor] = useState(null);
  const [previews, setPreviews] = useState({});
  const [regenerating, setRegenerating] = useState({});
  const [generatingVideos, setGeneratingVideos] = useState({});
  const [cacheBust, setCacheBust] = useState({});
  const [lightboxName, setLightboxName] = useState(null);
  const [promptText, setPromptText] = useState(null);
  const [editPrompt, setEditPrompt] = useState('');
  const [promptLoading, setPromptLoading] = useState(false);
  const [promptSaving, setPromptSaving] = useState(false);
  const [editingLightbox, setEditingLightbox] = useState(false);
  const [regeneratingLightbox, setRegeneratingLightbox] = useState(false);
  const [stepReloadKey, setStepReloadKey] = useState(0);
  const [storyboardData, setStoryboardData] = useState(null);
  const [scriptText, setScriptText] = useState(null);
  const [editingScript, setEditingScript] = useState(false);
  const [savingScript, setSavingScript] = useState(false);
  const [savingStoryboard, setSavingStoryboard] = useState(false);
  const [optimizingSkills, setOptimizingSkills] = useState({});
  const [step1Progress, setStep1Progress] = useState(null);
  const [localAssetTab, setLocalAssetTab] = useState('characters');
  const assetTab = controlledAssetTab || localAssetTab;
  const setAssetTab = useCallback((tab) => {
    setLocalAssetTab(tab);
    onAssetTabChange?.(tab);
  }, [onAssetTabChange]);
  const [assetDialog, setAssetDialog] = useState(null);
  const [showAddCharacter, setShowAddCharacter] = useState(false);
  const [newCharacter, setNewCharacter] = useState({ name: '', identity: '', appearance: '', prompt: '', gender: '', age: '', generationMode: 'ai', characterRefs: [], propRefs: [], sceneId: '' });
  const [newEntityFile, setNewEntityFile] = useState(null);
  const [addingCharacter, setAddingCharacter] = useState(false);
  const [assetErrors, setAssetErrors] = useState({});
  const prevPipelineRef = useRef(pipeline);
  // Step 2 only gates reusable reference assets. Keep its result stable while
  // editing a Step 3 draft so a new shot never hides the editor.
  const visualCompletionAtStep3Ref = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    const prev = prevPipelineRef.current;
    prevPipelineRef.current = pipeline;
    if (prev && prev.status !== pipeline.status) {
      setStepReloadKey(k => k + 1);
    }
  }, [pipeline, pipeline.status]);

  useEffect(() => {
    setArtifactsLoadedFor(null);
    visualCompletionAtStep3Ref.current = null;
  }, [pipelineId]);

  // Step 1 emits detailed phase logs before storyboard.json exists. Poll that
  // existing source while it runs so the user can see what the model is doing.
  useEffect(() => {
    if (step !== 1 || !isStepRunning) {
      setStep1Progress(null);
      return undefined;
    }
    let cancelled = false;
    const loadProgress = async () => {
      try {
        const response = await api(`/pipelines/${pipelineId}/logs`);
        if (response.ok && !cancelled) setStep1Progress(parseStep1Progress(await response.text()));
      } catch (_) { /* keep the last known progress visible */ }
    };
    loadProgress();
    const timer = setInterval(() => { if (!document.hidden) loadProgress(); }, 2500);
    return () => { cancelled = true; clearInterval(timer); };
  }, [pipelineId, step, isStepRunning]);

  useEffect(() => {
    // Step 3 also needs the Step 2 asset inventory when opened directly from
    // a URL, otherwise the completion gate cannot be evaluated.
    if (!isStepDone && !isStepRunning && step !== 2 && step !== 3 && step !== 4) { setArtifacts([]); return; }
    let cancelled = false;
    let t;
    const doFetch = async () => {
      try {
        const res = await api(`/pipelines/${pipelineId}/artifacts`);
        if (res.ok && !cancelled) setArtifacts((await res.json()).files || []);
      } catch (e) { /* ignore */ }
      finally { if (!cancelled) setArtifactsLoadedFor(pipelineId); }
    };
    doFetch();
    if (isStepRunning) {
      // Asset generation is sequential. Poll Step 2 more frequently so the
      // visible category follows the backend as it moves through the queue.
      t = setInterval(() => { if (!document.hidden) doFetch(); }, step === 2 ? 3000 : 15000);
    }
    return () => { cancelled = true; if (t) clearInterval(t); };
  }, [pipelineId, isStepDone, isStepRunning, step, canGenerate, pipeline.status, stepReloadKey]);
  const refreshArtifacts = useCallback(async () => {
    try {
      setStepReloadKey(k => k + 1);
      const res = await api(`/pipelines/${pipelineId}/artifacts`);
      if (res.ok) setArtifacts((await res.json()).files || []);
    } catch (e) { /* ignore */ }
  }, [pipelineId]);

  // Load storyboard data for step 2 placeholders (independent of actionLoading)
  useEffect(() => {
    if ((step !== 2 && step !== 3 && step !== 4) || storyboardData || artLoading) return;
    let cancelled = false;
    let retries = 0;
    const tryFetch = () => {
      if (cancelled) return;
      api(`/pipelines/${pipelineId}/artifacts/storyboard.json`).then(r => {
        if (r.ok) { r.json().then(d => setStoryboardData(d)); }
        else if (retries++ < 20) { setTimeout(tryFetch, 1500); }
      });
    };
    tryFetch();
    return () => { cancelled = true; };
  }, [step, pipelineId, storyboardData, artLoading]);

  // Load script text
  useEffect(() => {
    if (!pipelineId || step !== 1) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await api(`/pipelines/${pipelineId}/artifacts/script.txt`);
        if (res.ok && !cancelled) setScriptText(await res.text());
      } catch (_) {}
    })();
    return () => { cancelled = true; };
  }, [pipelineId, step]);

  const previewUrl = async (name) => {
    if (previews[name]) { setPreviews(p => { const n = {...p}; delete n[name]; return n; }); return; }
    try {
      const res = await api(`/pipelines/${pipelineId}/artifacts/${encodeURIComponent(name)}`);
      if (!res.ok) return;
      const blob = await res.blob();
      setPreviews(p => ({ ...p, [name]: URL.createObjectURL(blob) }));
    } catch (e) { /* ignore */ }
  };

  const charImages = artifacts.filter(f => f.name.startsWith('characters/') && /\.(jpg|jpeg|png|webp)$/i.test(f.name));
  const sceneImages = artifacts.filter(f => f.name.startsWith('scenes/') && /\.(jpg|jpeg|png|webp)$/i.test(f.name));
  const propImages = artifacts.filter(f => f.name.startsWith('props/') && /_reference\.(jpg|jpeg|png|webp)$/i.test(f.name));
  const charPlaceholders = React.useMemo(() => {
    if (!storyboardData) return [];
    const charImageNames = new Set(charImages.map(f => f.name));
    const expected = [];
    for (const c of storyboardData.characters || []) {
      for (const suffix of ['front', 'profile', 'fullbody']) {
        const name = `characters/${c.ref_id}_${suffix}.jpg`;
        if (!charImageNames.has(name)) expected.push({ name, placeholder: true, ref_id: c.ref_id, angle: suffix });
      }
    }
    return expected;
  }, [storyboardData, charImages]);
  const scenePlaceholders = React.useMemo(() => {
    if (!storyboardData) return [];
    const sceneImageNames = new Set(sceneImages.map(f => f.name));
    const expected = [];
    for (const s of storyboardData.scenes || []) {
      for (const suffix of ['wide', 'detail']) {
        const name = `scenes/${s.scene_id}_${suffix}.jpg`;
        if (!sceneImageNames.has(name)) expected.push({ name, placeholder: true, scene_id: s.scene_id, suffix });
      }
    }
    return expected;
  }, [storyboardData, sceneImages]);
  const propPlaceholders = React.useMemo(() => {
    if (!storyboardData) return [];
    const propImageNames = new Set(propImages.map(f => f.name));
    const expected = [];
    for (const p of storyboardData.props || []) {
      const name = `props/${p.ref_id}_reference.jpg`;
      if (!propImageNames.has(name)) expected.push({ name, placeholder: true, prop_id: p.ref_id, prop_name: p.name });
    }
    return expected;
  }, [storyboardData, propImages]);
  const allCharImages = [...charImages, ...charPlaceholders];
  const allSceneImages = [...sceneImages, ...scenePlaceholders];
  const allPropImages = [...propImages, ...propPlaceholders];
  const shotImages = artifacts.filter(f => f.name.startsWith('shots/') && /_startframe\.(jpg|jpeg|png|webp)$/i.test(f.name));
  const startFramesByShot = useMemo(() => Object.fromEntries((storyboardData?.shots || []).map(shot => {
    const id = shot.full_shot_id;
    const frame = shotImages.find(file => file.name.startsWith(`shots/${id}/${id}_startframe.`));
    return [id, frame || { name: shot.startframe_file || `shots/${id}/${id}_startframe.jpg`, placeholder: true, shot_id: id }];
  })), [storyboardData, shotImages]);
  const videoFiles = artifacts.filter(f => f.name.startsWith('shots/') && /\.(mp4|webm|mov)$/i.test(f.name));
  const videosByShot = useMemo(() => Object.fromEntries(videoFiles.map(file => [file.name.split('/')[1], file])), [videoFiles]);
  const finalVideo = artifacts.find(f => f.name === 'final.mp4');
  const characterCards = useMemo(() => (storyboardData?.characters || []).map(character => {
    const images = ['front', 'profile', 'fullbody'].map(angle => {
      const prefix = `characters/${character.ref_id}_${angle}.`;
      return charImages.find(file => file.name.startsWith(prefix)) || {
        name: `characters/${character.ref_id}_${angle}.jpg`, placeholder: true, ref_id: character.ref_id, angle,
      };
    });
    return { ...character, images };
  }), [storyboardData, charImages]);
  const sceneCards = useMemo(() => (storyboardData?.scenes || []).map(scene => {
    const images = ['wide', 'detail'].map(suffix => {
      const prefix = `scenes/${scene.scene_id}_${suffix}.`;
      return sceneImages.find(file => file.name.startsWith(prefix)) || {
        name: `scenes/${scene.scene_id}_${suffix}.jpg`, placeholder: true, scene_id: scene.scene_id, suffix,
      };
    });
    return { ...scene, images };
  }), [storyboardData, sceneImages]);
  const assetOverview = useMemo(() => {
    const count = (items, isComplete, keyFor) => ({
      total: items.length,
      completed: items.filter(isComplete).length,
      generating: items.filter(item => regenerating[keyFor(item)]).length,
      failed: items.filter(item => assetErrors[keyFor(item)]).length,
    });
    return {
      characters: count(characterCards, card => card.images.every(image => !image.placeholder), card => 'char_' + card.ref_id),
      props: count(allPropImages, prop => !prop.placeholder, prop => 'prop_' + (prop.prop_id || prop.name.split('/').pop()?.replace(/_reference\.(jpg|jpeg|png|webp)$/, ''))),
      scenes: count(sceneCards, scene => scene.images.some(image => !image.placeholder), scene => 'scene_' + scene.scene_id),
    };
  }, [characterCards, allPropImages, sceneCards, regenerating, assetErrors]);
  const visualAssetsCompleted = useMemo(() => Boolean(storyboardData) && Object.values(assetOverview).every(section =>
    section.total === section.completed && section.generating === 0 && section.failed === 0
  ), [storyboardData, assetOverview]);

  const activeAssetStage = useMemo(() => ['characters', 'props', 'scenes'].find(key => {
    const section = assetOverview[key];
    return section.total > 0 && (section.completed < section.total || section.generating > 0 || section.failed > 0);
  }), [assetOverview]);
  const step1RunningLabel = step1Progress?.complete
    ? '正在保存分镜结果...'
    : step1Progress?.active
    ? `正在${step1Progress.active.label}...`
    : '正在启动分镜生成...';

  useEffect(() => {
    if (step !== 2 || !isStepRunning || !activeAssetStage) return;
    setAssetTab(activeAssetStage);
  }, [step, isStepRunning, activeAssetStage, setAssetTab]);

  useEffect(() => {
    if (step === 2 && storyboardData && artifactsLoadedFor === pipelineId) {
      onAssetOverviewChange?.(assetOverview);
    }
  }, [step, storyboardData, artifactsLoadedFor, pipelineId, assetOverview, onAssetOverviewChange]);

  useEffect(() => {
    if (!storyboardData || artifactsLoadedFor !== pipelineId) return;
    if (step === 2) {
      // Step 2 is the source of truth for the live asset checklist.
      visualCompletionAtStep3Ref.current = visualAssetsCompleted;
      onVisualAssetsCompletionChange?.(visualAssetsCompleted);
      return;
    }
    if ((step === 3 || step === 4) && visualCompletionAtStep3Ref.current === null) {
      // On a direct URL visit, report the loaded Step 2 state once. Do not
      // recompute it from Step 3 drafts: start-frame work belongs to Step 3.
      visualCompletionAtStep3Ref.current = visualAssetsCompleted;
      onVisualAssetsCompletionChange?.(visualAssetsCompleted);
    }
  }, [step, storyboardData, artifactsLoadedFor, pipelineId, visualAssetsCompleted, onVisualAssetsCompletionChange]);

  const openLightbox = async (name) => {
    setLightboxName(name);
    setPromptText(null);
    setEditPrompt('');
    setPromptLoading(true);
    const pp = promptPathFromImage(name);
    if (pp) {
      try {
        const cb = cacheBust[name];
        const enc = pp.split('/').map(s => encodeURIComponent(s)).join('/');
        const res = await api(`/pipelines/${pipelineId}/artifacts/${enc}${cb ? '?ck=' + cb : ''}`);
        if (res.ok) { const t = await res.text(); setPromptText(t); setEditPrompt(t); }
      } catch (_) {}
    }
    setPromptLoading(false);
  };
  const isPlaceholderInLb = lightboxName && storyboardData && !artifacts.some(a => a.name === lightboxName);

  const closeLightbox = () => { setLightboxName(null); setPromptText(null); setEditPrompt(''); };
  const regenerateFromLightbox = async () => {
    const name = lightboxName;
    if (!name) return;
    setRegeneratingLightbox(true);
    let body = {};
    let regenKey = null;
    if (name.startsWith('characters/')) {
      const label = name.split('/')[1]?.replace(/\.(jpg|jpeg|png)$/, '');
      body = { character_images: [label] };
      regenKey = 'char_' + label;
    } else if (name.startsWith('scenes/')) {
      const label = name.split('/')[1]?.replace(/\.(jpg|jpeg|png)$/, '');
      body = { scene_images: [label] };
      regenKey = 'scene_' + label;
    } else if (name.startsWith('props/')) {
      const label = name.split('/')[1]?.replace(/_reference\.(jpg|jpeg|png|webp)$/, '');
      body = { prop_images: [label] };
      regenKey = 'prop_' + label;
    } else if (name.startsWith('shots/')) {
      const shotId = name.match(/shots\/([^/]+)\//)?.[1];
      if (shotId) body = { shots: [shotId] };
      regenKey = 'shot_' + shotId;
    }
    if (!Object.keys(body).length) { setRegeneratingLightbox(false); return; }
    if (regenKey) setRegenerating(r => ({ ...r, [regenKey]: true }));
    try {
      await api(`/pipelines/${pipelineId}/regenerate`, { method: 'POST', body: JSON.stringify(body) });
      setCacheBust(c => ({ ...c, [name]: Date.now() }));
      await refreshArtifacts();
      onRefresh?.();
    } catch (_) {}
    setRegeneratingLightbox(false);
    if (regenKey) setRegenerating(r => { const n = {...r}; delete n[regenKey]; return n; });
  };

  const regenerateAsset = async (key, body, files = []) => {
    if (regenerating[key]) return;
    setRegenerating(current => ({ ...current, [key]: true }));
    setAssetErrors(current => { const next = { ...current }; delete next[key]; return next; });
    try {
      const response = await api(`/pipelines/${pipelineId}/regenerate`, {
        method: 'POST', body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(await response.text());
      setCacheBust(current => ({
        ...current,
        ...Object.fromEntries(files.filter(file => !file.placeholder).map(file => [file.name, Date.now()])),
      }));
      await refreshArtifacts();
      onRefresh?.();
    } catch (_) {
      setAssetErrors(current => ({ ...current, [key]: true }));
      toast.error('生成失败，请检查服务日志后重试');
    } finally {
      setRegenerating(current => { const next = { ...current }; delete next[key]; return next; });
    }
  };

  const addCharacter = async (event) => {
    event.preventDefault();
    const name = newCharacter.name.trim();
    const appearance = newCharacter.appearance.trim();
    const kind = assetDialog || 'characters';
    if (!name || !appearance) return;
    setAddingCharacter(true);
    try {
      const response = await api(`/pipelines/${pipelineId}/entities`, {
        method: 'POST', body: JSON.stringify({
          kind, name, identity: newCharacter.identity.trim(), appearance,
          prompt: newCharacter.prompt.trim(), gender: newCharacter.gender, age: newCharacter.age,
          character_refs: newCharacter.characterRefs, prop_refs: newCharacter.propRefs, scene_id: newCharacter.sceneId,
          generation_mode: newCharacter.generationMode,
        }),
      });
      if (!response.ok) throw new Error(await response.text());
      const result = await response.json();
      setStoryboardData(current => ({
        ...(current || { scenes: [], props: [], shots: [] }),
        [kind]: [...(current?.[kind] || []), result.entity],
      }));
      const entityId = kind === 'scenes' ? result.entity.scene_id : kind === 'shots' ? result.entity.full_shot_id : result.entity.ref_id;
      if (newCharacter.generationMode === 'upload' && newEntityFile && entityId) {
        await uploadAsset(kind, entityId, newEntityFile);
      }
      setNewCharacter({ name: '', identity: '', appearance: '', prompt: '', gender: '', age: '', generationMode: 'ai', characterRefs: [], propRefs: [], sceneId: '' });
      setNewEntityFile(null);
      setShowAddCharacter(false);
      setAssetDialog(null);
      setAssetTab(kind);
      toast((kind === 'characters' ? '角色' : kind === 'props' ? '道具' : '场景') + '已添加，可使用卡片上的 AI 生成或本地上传。');
    } catch (_) {
      toast.error('添加失败，请稍后重试');
    } finally {
      setAddingCharacter(false);
    }
  };

  const toggleEntityReference = (field, id) => {
    setNewCharacter(current => ({
      ...current,
      [field]: current[field].includes(id)
        ? current[field].filter(value => value !== id)
        : [...current[field], id],
    }));
  };

  const uploadAsset = async (kind, entityId, file) => {
    const form = new FormData();
    form.append('file', file);
    try {
      const response = await fetch(`/pipelines/${pipelineId}/entities/${kind}/${encodeURIComponent(entityId)}/upload`, { method: 'POST', body: form });
      if (!response.ok) throw new Error(await response.text());
      await refreshArtifacts();
      onRefresh?.();
      toast('素材已上传');
    } catch (_) {
      toast.error('上传失败，请确认文件格式后重试');
    }
  };

  const deleteEntity = async (kind, entityId) => {
    const label = kind === 'characters' ? '角色' : kind === 'props' ? '道具' : kind === 'scenes' ? '场景' : '镜头起始帧';
    if (!window.confirm(`确定删除此${label}及其素材吗？此操作不可撤销。`)) return;
    try {
      const response = await api(`/pipelines/${pipelineId}/entities/${kind}/${encodeURIComponent(entityId)}`, { method: 'DELETE' });
      if (!response.ok) throw new Error(await response.text());
      const result = await response.json();
      if (result.status !== 'deleted' || result.entity_id !== entityId) throw new Error('服务端未确认删除');
      const collection = kind === 'characters' ? 'characters' : kind === 'props' ? 'props' : kind === 'scenes' ? 'scenes' : 'shots';
      const idKey = kind === 'characters' || kind === 'props' ? 'ref_id' : kind === 'scenes' ? 'scene_id' : 'full_shot_id';
      setStoryboardData(current => current ? { ...current, [collection]: (current[collection] || []).filter(item => item[idKey] !== entityId) } : current);
      await refreshArtifacts();
      onRefresh?.();
      toast(`${label}已删除`);
    } catch (error) {
      toast.error(`删除失败：${error?.message || '请稍后重试'}`);
    }
  };

  const saveStoryboard = async (draft = storyboardData, successMessage = '分镜已保存，视频生成将使用最新内容') => {
    if (!draft || savingStoryboard) return false;
    setSavingStoryboard(true);
    try {
      const nextStoryboard = { ...draft, shots: (draft.shots || []).map(shot => ({ ...shot, user_edited: true })) };
      const response = await api(`/pipelines/${pipelineId}/artifacts/storyboard.json`, { method: 'PUT', body: JSON.stringify(nextStoryboard, null, 2) });
      if (!response.ok) throw new Error(await response.text());
      setStoryboardData(nextStoryboard);
      if (successMessage) toast(successMessage);
      onRefresh?.();
      return true;
    } catch (error) {
      toast.error(`保存分镜失败：${error?.message || '请稍后重试'}`);
      return false;
    } finally { setSavingStoryboard(false); }
  };

  const optimizeShotSkills = async (shot, skillIds, customInstruction = '') => {
    const shotId = shot.full_shot_id;
    if (!shotId || (!skillIds.length && !customInstruction.trim()) || optimizingSkills[shotId]) return;
    // Persist ordinary card edits first, so Skill optimization always starts
    // from exactly the storyboard text the user sees.
    if (!(await saveStoryboard(storyboardData, ''))) return;
    setOptimizingSkills(current => ({ ...current, [shotId]: true }));
    try {
      const response = await api(`/pipelines/${pipelineId}/shots/${encodeURIComponent(shotId)}/skills/optimize`, {
        method: 'POST', body: JSON.stringify({ skills: skillIds, custom_instruction: customInstruction }),
      });
      if (!response.ok) throw new Error(await response.text());
      const result = await response.json();
      if (!result.shot?.full_shot_id) throw new Error('服务端未返回优化后的分镜');
      setStoryboardData(current => current ? {
        ...current,
        shots: (current.shots || []).map(item => item.full_shot_id === shotId ? result.shot : item),
      } : current);
      toast(`已应用 ${skillIds.length} 个技能并优化分镜 ${shotId}`);
      onRefresh?.();
    } catch (error) {
      toast.error(`应用技能失败：${error?.message || '请稍后重试'}`);
    } finally {
      setOptimizingSkills(current => { const next = { ...current }; delete next[shotId]; return next; });
    }
  };

  const generateStartFrame = async (shot, frame) => {
    const prompt = (shot.start_frame_prompt || shot.positive_prompt || shot.action_description || shot.description || '').trim();
    if (!prompt) {
      toast.error('请先填写分镜描述或视频提示词，再生成起始帧');
      return;
    }
    const draft = { ...storyboardData, shots: (storyboardData?.shots || []).map(item => item.full_shot_id === shot.full_shot_id ? { ...item, start_frame_prompt: prompt } : item) };
    if (!(await saveStoryboard(draft))) return;
    await regenerateAsset('shot_' + shot.full_shot_id, { shots: [shot.full_shot_id] }, [frame]);
  };

  const generateShotVideo = async shot => {
    const shotId = shot.full_shot_id;
    if (!shotId || generatingVideos[shotId]) return;
    setGeneratingVideos(current => ({ ...current, [shotId]: true }));
    try {
      const response = await api(`/pipelines/${pipelineId}/videos/${encodeURIComponent(shotId)}/generate`, { method: 'POST' });
      if (!response.ok) throw new Error(await response.text());
      toast(`已开始生成分镜视频 ${shotId}`);
      const checkProgress = async () => {
        let pipelineStatus = null;
        try {
          const statusResponse = await api(`/pipelines/${pipelineId}`);
          pipelineStatus = statusResponse.ok ? await statusResponse.json() : null;
          if (pipelineStatus?.status === 'running') { setTimeout(checkProgress, 2000); return; }
          await refreshArtifacts();
          onRefresh?.();
        } finally {
          if (pipelineStatus?.status !== 'running') setGeneratingVideos(current => { const next = { ...current }; delete next[shotId]; return next; });
        }
      };
      setTimeout(checkProgress, 1200);
    } catch (error) {
      setGeneratingVideos(current => { const next = { ...current }; delete next[shotId]; return next; });
      toast.error(`生成分镜视频失败：${error?.message || '请稍后重试'}`);
    }
  };

  return (
    <div className="mb-6 rounded-2xl border border-ink-700 bg-ink-900 p-4 shadow-sm sm:p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="font-heading text-lg font-semibold text-stone-100">
            步骤 {step}: {STEP_NAMES[step]}
          </h3>
          <p className="text-xs text-stone-500 mt-1">
            {isStepDone ? '已完成' : isStepRunning ? (step === 1 ? step1RunningLabel : step === 2 && activeAssetStage ? `正在生成${activeAssetStage === 'characters' ? '角色肖像' : activeAssetStage === 'props' ? '道具' : '场景'}...` : step === 4 ? '正在合成最终影片...' : '正在生成...') : canGenerate ? '准备就绪' : '前置步骤尚未完成'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isStepRunning && (
            <button
              onClick={() => onCancel && onCancel()}
              className="px-4 py-2.5 rounded text-sm font-medium bg-clay-500/20 text-clay-400 hover:bg-clay-500/30 transition-all"
            >
              停止
            </button>
          )}
          <button
            onClick={() => onRun(step)}
            disabled={!canGenerate || isStepRunning}
            className={`px-5 py-2.5 rounded text-sm font-medium transition-all ${
              isStepRunning
                ? 'bg-brass-500 text-ink-950 animate-pulse-brass'
                : canGenerate
                  ? 'bg-brass-500 hover:bg-brass-400 text-ink-950 cursor-pointer'
                  : 'bg-ink-700 text-stone-500 cursor-not-allowed'
            }`}
          >
            {isStepRunning ? (step === 4 ? '⏳ 合成中...' : step === 1 ? `⏳ ${step1Progress?.complete ? '正在保存...' : step1Progress?.active?.label || '生成中'}...` : step === 2 && activeAssetStage ? `⏳ 正在生成${activeAssetStage === 'characters' ? '角色肖像' : activeAssetStage === 'props' ? '道具' : '场景'}...` : '⏳ 生成中...') : isStepDone ? (step === 4 ? '重新合成' : step === 3 ? '生成全部分镜' : step === 2 ? '重新生成全部素材' : '重新生成') : (step === 4 ? '开始合成' : step === 3 ? '生成全部分镜' : step === 2 ? '生成全部素材' : '开始生成')}
          </button>
        </div>
      </div>

      {step === 1 && canGenerate && !isStepRunning && (
        <>
          {scriptText !== null && (
            <div className="mb-6 p-4 bg-ink-900/50 rounded border border-ink-700">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-stone-400 font-medium">剧本</p>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => navigator.clipboard.writeText(scriptText).then(() => toast('剧本已复制')).catch(() => toast.error('复制失败'))}
                    className="text-xs text-stone-500 hover:text-stone-200 transition-colors px-1.5 py-0.5 rounded cursor-pointer" title="复制剧本">📋</button>
                  <button
                    onClick={async () => {
                      if (editingScript) {
                        setEditingScript(false);
                      } else {
                        setEditingScript(true);
                      }
                    }}
                    className="text-xs text-stone-500 hover:text-brass-400 transition-colors px-1.5 py-0.5 rounded cursor-pointer" title="编辑剧本"
                  >{editingScript ? '✓' : '✎'}</button>
                </div>
              </div>
              {editingScript ? (
                <div className="space-y-2">
                  <textarea
                    className="w-full h-64 bg-ink-950 text-stone-300 text-xs p-3 rounded border border-ink-700 font-mono resize-y"
                    value={scriptText}
                    onChange={e => setScriptText(e.target.value)}
                  />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={async () => {
                        setSavingScript(true);
                        try {
                          const res = await api(`/pipelines/${pipelineId}/artifacts/script.txt`, {
                            method: 'PUT', body: scriptText,
                          });
                          if (res.ok) setEditingScript(false);
                        } catch (_) {}
                        setSavingScript(false);
                      }}
                      disabled={savingScript}
                      className="px-3 py-1.5 text-xs font-medium bg-leaf-500/20 text-leaf-400 rounded hover:bg-leaf-500/30 transition-colors cursor-pointer disabled:opacity-40"
                    >{savingScript ? '保存中...' : '保存'}</button>
                    <button onClick={() => { setEditingScript(false); setScriptText(scriptText); }}
                      className="px-3 py-1.5 text-xs text-stone-500 hover:text-stone-300 transition-colors cursor-pointer">取消</button>
                  </div>
                </div>
              ) : (
                <pre className="text-xs text-stone-400 whitespace-pre-wrap max-h-48 overflow-y-auto">{scriptText}</pre>
              )}
            </div>
          )}
          <div className="mb-6 p-4 bg-ink-900/50 rounded border border-ink-700 space-y-3">
            <p className="text-xs text-stone-400 font-medium">分镜参数</p>
          <div className="flex items-center gap-4">
            <label className="text-xs text-stone-400 w-28 flex-shrink-0">每场景最多镜头</label>
            <input type="range" min="1" max="20" value={maxShotsPerScene}
              onChange={e => setMaxShotsPerScene(parseInt(e.target.value))}
              className="flex-1 accent-brass-500 h-1.5" />
            <span className="text-xs text-stone-200 w-6 text-right">{maxShotsPerScene}</span>
          </div>
          <div className="flex items-center gap-4">
            <label className="text-xs text-stone-400 w-28 flex-shrink-0">总镜头数上限</label>
            <input type="range" min="1" max="60" value={totalShots}
              onChange={e => setTotalShots(parseInt(e.target.value))}
              className="flex-1 accent-brass-500 h-1.5" />
            <span className="text-xs text-stone-200 w-6 text-right">{totalShots}</span>
          </div>
          <div className="flex items-center gap-4">
            <label className="text-xs text-stone-400 w-28 flex-shrink-0">总时长（秒）</label>
            <input type="range" min="1" max="60" value={totalDuration}
              onChange={e => setTotalDuration(parseInt(e.target.value))}
              className="flex-1 accent-brass-500 h-1.5" />
            <span className="text-xs text-stone-200 w-6 text-right">{totalDuration}s</span>
          </div>
        </div>
      </>
      )}

      {step === 1 && isStepRunning && <Step1Progress progress={step1Progress} />}
      {step === 1 && (isStepDone || isStepRunning) && <StoryboardViewer pipelineId={pipelineId} poll={isStepRunning} reloadKey={stepReloadKey} />}

      {step === 2 && (isStepDone || isStepRunning || canGenerate) && (
        <div className="space-y-5">
          <div className="rounded-xl border border-ink-700 bg-ink-950/45 overflow-hidden">
            <div className="px-4 pt-4 pb-3 border-b border-ink-700/80">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <p className="text-xs text-stone-500 leading-relaxed">按「角色肖像 → 道具 → 场景」完成素材。角色需生成正面、侧面和全身三个视角后才视为完成。</p>
                {isStepRunning && activeAssetStage && <span className="inline-flex items-center gap-1.5 rounded-full border border-brass-500/35 bg-brass-500/10 px-2 py-0.5 text-xs font-medium text-brass-400"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brass-400"/>全部生成中：{activeAssetStage === 'characters' ? '角色肖像' : activeAssetStage === 'props' ? '道具' : '场景'}</span>}
              </div>
            </div>
            <div className="flex flex-col gap-4 p-4">
              <div className="flex flex-wrap items-center gap-x-1 gap-y-2" role="tablist" aria-label="视觉素材分类">
                {[
                  ['characters', '角色肖像', characterCards.length],
                  ['props', '道具', allPropImages.length],
                  ['scenes', '场景', sceneCards.length],
                ].map(([key, label, count]) => (
                  <button key={key} type="button" role="tab" aria-selected={assetTab === key} onClick={() => setAssetTab(key)}
                    className={'px-3 py-2 text-sm rounded-lg transition-colors ' + (assetTab === key ? 'bg-brass-500 text-ink-950 font-semibold shadow-sm' : 'text-stone-400 hover:text-stone-100 hover:bg-ink-800')}>
                    {label}<span className={'ml-1.5 text-xs ' + (assetTab === key ? 'text-ink-950/70' : 'text-stone-600')}>{count}</span>
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
                {[
                  [assetTab === 'characters' ? '角色总计' : assetTab === 'props' ? '道具总计' : '场景总计', assetOverview[assetTab].total, 'text-stone-100'],
                  ['已完成', assetOverview[assetTab].completed, 'text-leaf-400'],
                  ['生成中', assetOverview[assetTab].generating, 'text-brass-400'],
                  ['失败', assetOverview[assetTab].failed, 'text-clay-400'],
                ].map(([label, value, color]) => (
                  <div key={label} className="flex items-baseline gap-1.5"><span className="text-xs text-stone-500">{label}</span><span className={'text-lg leading-none font-semibold ' + color}>{value}</span></div>
                ))}
                <div className="flex-1" />
                <button type="button" onClick={() => { setAssetDialog(assetTab); setNewEntityFile(null); setNewCharacter({ name: '', identity: '', appearance: '', prompt: '', gender: '', age: '', generationMode: 'ai', characterRefs: [], propRefs: [], sceneId: '' }); setShowAddCharacter(true); }} disabled={pipeline.status === 'running'}
                  className="px-3.5 py-2 rounded-lg text-sm font-medium bg-ink-800 border border-ink-600 text-stone-200 hover:border-brass-500 hover:text-brass-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">+ 添加{assetTab === 'characters' ? '角色' : assetTab === 'props' ? '道具' : '场景'}</button>
              </div>
            </div>
          </div>

          {assetTab === 'characters' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {characterCards.map(character => {
                const regenKey = 'char_' + character.ref_id;
                const isGenerating = regenerating[regenKey];
                const complete = character.images.every(image => !image.placeholder);
                return (
                  <article key={character.ref_id} className="group overflow-hidden rounded-xl border border-ink-700 bg-ink-900/80 hover:border-ink-600 transition-colors">
                    <div className="relative grid grid-cols-3 gap-px bg-ink-700">
                      {character.images.map((image, index) => (
                        <div key={image.name} className="relative">
                          <AssetPreview file={image} pipelineId={pipelineId} cacheBust={cacheBust} aspectClass="aspect-[3/4]" onOpen={openLightbox} label={(character.name || character.ref_id) + ' ' + ['正面', '侧面', '全身'][index]} />
                          <span className="absolute left-2 bottom-2 px-1.5 py-0.5 rounded bg-ink-950/75 text-[10px] text-stone-300 pointer-events-none">{['正面', '侧面', '全身'][index]}</span>
                        </div>
                      ))}
                      <AssetToolbar onGenerate={() => regenerateAsset(regenKey, { characters: [character.ref_id] }, character.images)} onUpload={file => uploadAsset('characters', character.ref_id, file)} onDelete={() => deleteEntity('characters', character.ref_id)} disabled={isGenerating} />
                    </div>
                    <div className="p-3.5">
                      <div className="flex items-start gap-3">
                        <div className="min-w-0 flex-1"><h4 className="text-sm font-semibold text-stone-100 truncate">{character.name || character.ref_id}</h4><p className="mt-1 text-xs text-stone-500 line-clamp-2">{character.description || character.identity || (complete ? '3 个视角 · 素材已完成' : '等待生成 · 需 3 个视角')}</p></div>
                        <span className={'mt-0.5 w-2 h-2 rounded-full ' + (isGenerating ? 'bg-brass-400 animate-pulse' : assetErrors[regenKey] ? 'bg-clay-400' : complete ? 'bg-leaf-400' : 'bg-stone-600')} />
                      </div>
                      {assetErrors[regenKey] && <p className="mt-2 text-xs text-clay-400">上次生成失败，请重试。</p>}
                      <div className="flex items-center gap-2 mt-3">
                        <button type="button" onClick={() => openLightbox(character.images[0].name)} className="text-xs text-stone-400 hover:text-stone-100 transition-colors">查看提示词</button>
                        <button type="button" onClick={() => regenerateAsset(regenKey, { characters: [character.ref_id] }, character.images)} disabled={isGenerating}
                          className="ml-auto px-2.5 py-1.5 rounded-md text-xs font-medium bg-brass-500/15 text-brass-400 hover:bg-brass-500 hover:text-ink-950 disabled:opacity-50 transition-colors">{isGenerating ? '生成中…' : complete ? '重新生成' : '生成角色'}</button>
                      </div>
                    </div>
                  </article>
                );
              })}
              {characterCards.length === 0 && <div className="sm:col-span-2 xl:col-span-3 py-12 text-center rounded-xl border border-dashed border-ink-700 text-sm text-stone-500">暂无角色。可手动添加一个角色，或先运行步骤 1。</div>}
            </div>
          )}

          {assetTab === 'props' && (
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
              {allPropImages.map(prop => {
                const label = prop.prop_id || prop.name.split('/').pop()?.replace(/_reference\.(jpg|jpeg|png|webp)$/, '');
                const regenKey = 'prop_' + label;
                return (
                  <article key={prop.name} className="group overflow-hidden rounded-xl border border-ink-700 bg-ink-900/80 hover:border-ink-600 transition-colors">
                    <div className="relative"><AssetPreview file={prop} pipelineId={pipelineId} cacheBust={cacheBust} aspectClass="aspect-square" onOpen={openLightbox} label={prop.prop_name || label} /><AssetToolbar onGenerate={() => regenerateAsset(regenKey, { prop_images: [label] }, [prop])} onUpload={file => uploadAsset('props', label, file)} onDelete={() => deleteEntity('props', label)} disabled={regenerating[regenKey]} /></div>
                    <div className="p-3"><div className="flex items-center gap-2"><h4 className="min-w-0 flex-1 text-sm font-medium text-stone-200 truncate">{prop.prop_name || label}</h4><span className={'w-2 h-2 rounded-full ' + (regenerating[regenKey] ? 'bg-brass-400 animate-pulse' : prop.placeholder ? 'bg-stone-600' : assetErrors[regenKey] ? 'bg-clay-400' : 'bg-leaf-400')} /></div><p className="mt-1 text-xs text-stone-500 line-clamp-2">{prop.description || prop.narrative_function || prop.category || '道具设定'}</p>
                      <div className="flex items-center mt-3"><button type="button" onClick={() => regenerateAsset(regenKey, { prop_images: [label] }, [prop])} disabled={regenerating[regenKey]} className="ml-auto px-2.5 py-1.5 rounded-md text-xs font-medium bg-brass-500/15 text-brass-400 hover:bg-brass-500 hover:text-ink-950 disabled:opacity-50 transition-colors">{regenerating[regenKey] ? '生成中…' : prop.placeholder ? '生成道具' : '重新生成'}</button></div>
                    </div>
                  </article>
                );
              })}
              {allPropImages.length === 0 && <div className="col-span-full py-12 text-center rounded-xl border border-dashed border-ink-700 text-sm text-stone-500">剧本中暂无道具设定。</div>}
            </div>
          )}

          {assetTab === 'scenes' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {sceneCards.map(scene => {
                const regenKey = 'scene_' + scene.scene_id;
                const complete = scene.images.some(image => !image.placeholder);
                return (
                  <article key={scene.scene_id} className="group overflow-hidden rounded-xl border border-ink-700 bg-ink-900/80 hover:border-ink-600 transition-colors">
                    <div className="relative grid grid-cols-2 gap-px bg-ink-700">
                      {scene.images.map((image, index) => <div key={image.name} className="relative"><AssetPreview file={image} pipelineId={pipelineId} cacheBust={cacheBust} aspectClass="aspect-video" onOpen={openLightbox} label={scene.scene_id + ' ' + (index === 0 ? '全景' : '细节')} /><span className="absolute left-2 bottom-2 px-1.5 py-0.5 rounded bg-ink-950/75 text-[10px] text-stone-300 pointer-events-none">{index === 0 ? '全景' : '细节'}</span></div>)}
                      <AssetToolbar onGenerate={() => regenerateAsset(regenKey, { scenes: [scene.scene_id] }, scene.images)} onUpload={file => uploadAsset('scenes', scene.scene_id, file)} onDelete={() => deleteEntity('scenes', scene.scene_id)} disabled={regenerating[regenKey]} />
                    </div>
                    <div className="p-3.5 flex items-center gap-3"><div className="min-w-0 flex-1"><h4 className="text-sm font-semibold text-stone-100">{scene.name || scene.scene_id}</h4><p className="mt-1 text-xs text-stone-500 line-clamp-2">{scene.description || (complete ? '场景参考已生成' : '等待生成')}</p></div>
                      <button type="button" onClick={() => regenerateAsset(regenKey, { scenes: [scene.scene_id] }, scene.images)} disabled={regenerating[regenKey]} className="px-2.5 py-1.5 rounded-md text-xs font-medium bg-ink-800 text-stone-300 hover:bg-brass-500 hover:text-ink-950 disabled:opacity-50 transition-colors">{regenerating[regenKey] ? '生成中…' : complete ? '重新生成' : '生成场景'}</button>
                    </div>
                  </article>
                );
              })}
              {sceneCards.length === 0 && <div className="col-span-full py-12 text-center rounded-xl border border-dashed border-ink-700 text-sm text-stone-500">剧本中暂无场景设定。</div>}
            </div>
          )}

          {showAddCharacter && (
            <div className="fixed inset-0 z-50 bg-ink-950/80 backdrop-blur-sm flex items-center justify-center p-4" onMouseDown={() => !addingCharacter && setShowAddCharacter(false)}>
              <form onSubmit={addCharacter} onMouseDown={event => event.stopPropagation()} className="w-full max-w-2xl rounded-xl border border-ink-600 bg-ink-900 shadow-2xl">
                <div className="flex items-center justify-between px-5 py-4 border-b border-ink-700"><div><h4 className="text-base font-semibold text-stone-100">新增{assetDialog === 'characters' ? '角色' : assetDialog === 'props' ? '道具' : assetDialog === 'scenes' ? '场景' : '镜头起始帧'}</h4><p className="mt-1 text-xs text-stone-500">参考火山引擎设定页：先创建实体，再选择 AI 生成或本地上传素材。</p></div><button type="button" onClick={() => { setShowAddCharacter(false); setAssetDialog(null); }} disabled={addingCharacter} className="w-7 h-7 rounded-md text-stone-500 hover:bg-ink-800 hover:text-stone-200">×</button></div>
                <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[70vh] overflow-y-auto">
                  <label className="block"><span className="text-xs font-medium text-stone-300">{assetDialog === 'characters' ? '名称' : assetDialog === 'props' ? '道具名称' : assetDialog === 'scenes' ? '场景名称' : '起始帧名称'} <span className="text-clay-400">*</span></span><input autoFocus required maxLength="80" value={newCharacter.name} onChange={event => setNewCharacter(current => ({ ...current, name: event.target.value }))} placeholder="请输入" className="mt-1.5 w-full rounded-lg border border-ink-600 bg-ink-950 px-3 py-2.5 text-sm text-stone-100 placeholder:text-stone-600 focus:border-brass-500 focus:outline-none" /></label>
                  {assetDialog === 'characters' && <><label className="block"><span className="text-xs font-medium text-stone-300">性别</span><select value={newCharacter.gender} onChange={event => setNewCharacter(current => ({ ...current, gender: event.target.value }))} className="mt-1.5 w-full rounded-lg border border-ink-600 bg-ink-950 px-3 py-2.5 text-sm text-stone-100 focus:border-brass-500 focus:outline-none"><option value="">请选择</option><option>男</option><option>女</option><option>未知</option></select></label><label className="block"><span className="text-xs font-medium text-stone-300">年龄</span><input value={newCharacter.age} onChange={event => setNewCharacter(current => ({ ...current, age: event.target.value }))} placeholder="例如：28 岁" className="mt-1.5 w-full rounded-lg border border-ink-600 bg-ink-950 px-3 py-2.5 text-sm text-stone-100 placeholder:text-stone-600 focus:border-brass-500 focus:outline-none" /></label><label className="block"><span className="text-xs font-medium text-stone-300">身份 / 关系</span><input maxLength="160" value={newCharacter.identity} onChange={event => setNewCharacter(current => ({ ...current, identity: event.target.value }))} placeholder="例如：刑警队长，主角的姐姐" className="mt-1.5 w-full rounded-lg border border-ink-600 bg-ink-950 px-3 py-2.5 text-sm text-stone-100 placeholder:text-stone-600 focus:border-brass-500 focus:outline-none" /></label></>}
                  <div className="md:col-span-2"><span className="text-xs font-medium text-stone-300">形象生成方式</span><div className="mt-2 flex flex-wrap gap-2">{[['ai', 'AI 生成'], ['upload', '本地上传']].map(([value, label]) => <label key={value} className={'cursor-pointer rounded-lg border px-3 py-2 text-sm ' + (newCharacter.generationMode === value ? 'border-brass-500 bg-brass-500/10 text-brass-400' : 'border-ink-600 text-stone-400')}><input type="radio" className="sr-only" checked={newCharacter.generationMode === value} onChange={() => setNewCharacter(current => ({ ...current, generationMode: value }))} />{label}</label>)}</div></div>
                  {newCharacter.generationMode === 'ai' && <label className="block md:col-span-2"><span className="text-xs font-medium text-stone-300">提示词</span><textarea maxLength="3000" value={newCharacter.prompt} onChange={event => setNewCharacter(current => ({ ...current, prompt: event.target.value }))} placeholder="描述希望生成的视觉效果；为空时将使用下方描述生成提示词。" className="mt-1.5 min-h-24 w-full rounded-lg border border-ink-600 bg-ink-950 px-3 py-2.5 text-sm leading-relaxed text-stone-100 placeholder:text-stone-600 focus:border-brass-500 focus:outline-none resize-y" /></label>}
                  {newCharacter.generationMode === 'upload' && <label className="block md:col-span-2"><span className="text-xs font-medium text-stone-300">上传图片 <span className="text-clay-400">*</span></span><input required type="file" accept="image/png,image/jpeg,image/webp" onChange={event => setNewEntityFile(event.target.files?.[0] || null)} className="mt-1.5 block w-full rounded-lg border border-dashed border-ink-600 bg-ink-950 px-3 py-2 text-sm text-stone-400 file:mr-3 file:rounded-md file:border-0 file:bg-ink-700 file:px-3 file:py-1.5 file:text-sm file:text-stone-200 hover:file:bg-ink-600" /><span className="mt-1 block text-xs text-stone-600">支持 JPG、PNG、WebP，上传后会成为首张参考图。</span></label>}
                  {(assetDialog === 'scenes' || assetDialog === 'shots') && <div className="md:col-span-2 rounded-lg border border-ink-700 bg-ink-950/60 p-3.5"><div><span className="text-xs font-medium text-stone-300">关联素材（可选）</span><p className="mt-1 text-xs text-stone-600">选中的已完成素材会作为图片生成参考，帮助保持角色与道具的一致性。</p></div>
                    {assetDialog === 'shots' && <label className="mt-3 block"><span className="text-xs text-stone-400">关联场景</span><select value={newCharacter.sceneId} onChange={event => setNewCharacter(current => ({ ...current, sceneId: event.target.value }))} className="mt-1.5 w-full rounded-md border border-ink-600 bg-ink-900 px-2.5 py-2 text-sm text-stone-200 focus:border-brass-500 focus:outline-none"><option value="">不指定场景</option>{(storyboardData?.scenes || []).map(scene => <option key={scene.scene_id} value={scene.scene_id}>{scene.name || scene.scene_id}</option>)}</select></label>}
                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3"><div><span className="text-xs text-stone-400">角色</span><div className="mt-1.5 flex flex-wrap gap-1.5">{(storyboardData?.characters || []).length ? (storyboardData.characters || []).map(character => <label key={character.ref_id} className={'cursor-pointer rounded-md border px-2 py-1 text-xs transition-colors ' + (newCharacter.characterRefs.includes(character.ref_id) ? 'border-brass-500 bg-brass-500/10 text-brass-400' : 'border-ink-600 text-stone-400 hover:text-stone-200')}><input type="checkbox" className="sr-only" checked={newCharacter.characterRefs.includes(character.ref_id)} onChange={() => toggleEntityReference('characterRefs', character.ref_id)} />{character.name || character.ref_id}</label>) : <span className="text-xs text-stone-600">暂无可选角色</span>}</div></div><div><span className="text-xs text-stone-400">道具</span><div className="mt-1.5 flex flex-wrap gap-1.5">{(storyboardData?.props || []).length ? (storyboardData.props || []).map(prop => <label key={prop.ref_id} className={'cursor-pointer rounded-md border px-2 py-1 text-xs transition-colors ' + (newCharacter.propRefs.includes(prop.ref_id) ? 'border-brass-500 bg-brass-500/10 text-brass-400' : 'border-ink-600 text-stone-400 hover:text-stone-200')}><input type="checkbox" className="sr-only" checked={newCharacter.propRefs.includes(prop.ref_id)} onChange={() => toggleEntityReference('propRefs', prop.ref_id)} />{prop.name || prop.ref_id}</label>) : <span className="text-xs text-stone-600">暂无可选道具</span>}</div></div></div>
                  </div>}
                  <label className="block md:col-span-2"><span className="text-xs font-medium text-stone-300">{assetDialog === 'characters' ? '角色描述' : assetDialog === 'shots' ? '画面描述' : '设定描述'} <span className="text-clay-400">*</span></span><textarea required maxLength="2000" value={newCharacter.appearance} onChange={event => setNewCharacter(current => ({ ...current, appearance: event.target.value }))} placeholder={assetDialog === 'characters' ? '描述外貌、服装、性格与标志性特征…' : assetDialog === 'shots' ? '描述构图、景别、人物动作、空间与光影…' : '描述用途、外观、材质、空间、氛围等…'} className="mt-1.5 min-h-32 w-full rounded-lg border border-ink-600 bg-ink-950 px-3 py-2.5 text-sm leading-relaxed text-stone-100 placeholder:text-stone-600 focus:border-brass-500 focus:outline-none resize-y" /></label>
                  {assetDialog === 'characters' && <div className="md:col-span-2 flex items-center gap-3 rounded-lg bg-ink-950/70 px-3 py-2.5 text-xs text-stone-500"><span>音色</span><select className="bg-transparent text-stone-300 focus:outline-none"><option>暂不配置</option><option>成熟男声</option><option>温柔女声</option></select><span className="ml-auto">模型：Doubao-Seedream-5.0-Pro · 3:4</span></div>}
                </div>
                <div className="flex justify-end gap-2 px-5 py-4 border-t border-ink-700"><button type="button" onClick={() => { setShowAddCharacter(false); setAssetDialog(null); }} disabled={addingCharacter} className="px-3 py-2 text-sm text-stone-400 hover:text-stone-200 disabled:opacity-50">取消</button><button type="submit" disabled={addingCharacter || !newCharacter.name.trim() || !newCharacter.appearance.trim()} className="px-4 py-2 rounded-lg bg-brass-500 text-sm font-medium text-ink-950 hover:bg-brass-400 disabled:opacity-50 disabled:cursor-not-allowed">{addingCharacter ? '添加中…' : '确认添加'}</button></div>
              </form>
            </div>
          )}
        </div>
      )}

      {step === 3 && (storyboardData || isStepDone || isStepRunning || canGenerate) && (
        <div className="space-y-5">
          {storyboardData && <StoryboardEditor storyboard={storyboardData} onChange={setStoryboardData} onSave={saveStoryboard} saving={savingStoryboard} onOptimizeSkills={optimizeShotSkills} optimizingSkills={optimizingSkills}
            startFrames={startFramesByShot} videos={videosByShot} pipelineId={pipelineId} cacheBust={cacheBust} onOpenStartFrame={openLightbox} regenerating={regenerating} generatingVideos={generatingVideos}
            onGenerateStartFrame={generateStartFrame}
            onUploadStartFrame={(shot, file) => uploadAsset('shots', shot.full_shot_id, file)} onGenerateShotVideo={generateShotVideo} />}
          {videoFiles.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {videoFiles.map(f => (
                <div key={f.name}>
                  <p className="text-xs text-stone-400 mb-1.5 truncate">{f.name.split('/').slice(0,2).join('/')}</p>
                  <video
                    src={`/pipelines/${pipelineId}/artifacts/${encodeURIComponent(f.name)}`}
                    controls
                    className="w-full rounded bg-ink-950"
                    preload="metadata"
                  />
                </div>
              ))}
            </div>
          ) : (
            <p className="text-stone-500 text-sm">暂无视频片段</p>
          )}
        </div>
      )}

      {step === 4 && (isStepDone || isStepRunning || canGenerate) && (
        <div className="space-y-5">
          <div className="rounded-xl border border-ink-700 bg-gradient-to-br from-ink-950 to-ink-900 p-5">
            <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm font-semibold text-stone-100">最终影片合成</p><p className="mt-1 text-xs leading-relaxed text-stone-500">按分镜顺序拼接已生成的视频片段，输出最终成片。音频生成已从默认工作流移除，可在后续版本作为可选轨道接入。</p></div><div className="flex gap-5 text-xs"><span className="text-stone-500">视频片段 <b className="ml-1 text-stone-200">{videoFiles.length}</b></span><span className="text-stone-500">输出 <b className={'ml-1 ' + (finalVideo ? 'text-leaf-400' : 'text-stone-400')}>{finalVideo ? '已生成' : '等待合成'}</b></span></div></div>
          </div>
          {finalVideo ? (
            <div>
              <video
                src={`/pipelines/${pipelineId}/artifacts/final.mp4`}
                controls
                className="w-full rounded bg-ink-950 max-h-[500px]"
              />
              <p className="text-xs text-stone-500 mt-2">{(finalVideo.size / 1024 / 1024).toFixed(1)} MB</p>
            </div>
          ) : (
            <p className="text-stone-500 text-sm">尚未生成最终影片。确认视频片段后点击“开始合成”。</p>
          )}
        </div>
      )}

      {!isStepDone && !isStepRunning && !(step === 2 && canGenerate) && (
        <div className="text-center py-8 text-stone-500 text-sm border border-dashed border-ink-700 rounded">
          此步骤尚未执行
        </div>
      )}
      {lightboxName && (
        <div
          className="fixed inset-0 z-50 bg-ink-950/90 flex items-center justify-center p-4 cursor-pointer"
          onClick={closeLightbox}
          onKeyDown={e => { if (e.key === 'Escape') closeLightbox(); }}
          tabIndex={-1}
          ref={el => { if (el) el.focus(); }}
        >
          <button
            onClick={closeLightbox}
            className="absolute top-4 right-4 w-8 h-8 rounded-full bg-ink-900/80 hover:bg-clay-500/80 text-stone-400 hover:text-white flex items-center justify-center text-sm transition-all cursor-pointer z-10"
          >✕</button>
          <div className="flex flex-col lg:flex-row gap-4 max-w-full max-h-full items-start cursor-default" onClick={e => e.stopPropagation()}>
            <div className="relative">
              {isPlaceholderInLb ? (
                <div className="max-h-[70vh] max-w-full lg:max-w-[50vw] min-w-[280px] flex flex-col items-center justify-center rounded bg-ink-800 border border-dashed border-ink-600" style={{ aspectRatio: '16/9' }}>
                  <span className="text-stone-600 text-2xl">?</span>
                  <span className="text-stone-600 text-xs mt-1">待生成</span>
                </div>
              ) : (
                <img
                  key={cacheBust[lightboxName] || ''}
                  src={artifactUrl(pipelineId, lightboxName, cacheBust[lightboxName])}
                  className="max-h-[70vh] max-w-full lg:max-w-[50vw] object-contain rounded"
                  alt="放大预览"
                  onError={e => { e.target.style.display = 'none'; }}
                />
              )}
              {regeneratingLightbox && (
                <div className="absolute inset-0 bg-ink-950/70 rounded flex items-center justify-center">
                  <div className="w-8 h-8 border-2 border-brass-400 border-t-transparent rounded-full animate-spin" />
                </div>
              )}
              {lightboxName && (
                <button
                  onClick={regenerateFromLightbox}
                  disabled={regeneratingLightbox}
                  className="absolute top-2 right-2 w-8 h-8 rounded bg-ink-900/80 hover:bg-brass-500/80 text-stone-400 hover:text-ink-950 flex items-center justify-center text-sm transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  title="重新生成"
                >⟳</button>
              )}
            </div>
            {promptText !== null && (
              <div className="bg-ink-900/95 border border-ink-700 rounded p-4 self-stretch max-h-[70vh] overflow-y-auto min-w-[280px] max-w-full lg:max-w-[40vw] flex flex-col gap-3 min-h-0">
                <div className="flex items-center justify-between flex-shrink-0">
                  <h4 className="text-xs text-stone-400 font-medium">生成提示词</h4>
                  {editingLightbox ? (
                    <div className="flex items-center gap-2">
                      <button onClick={async () => {
                        const pp = promptPathFromImage(lightboxName);
                        if (!pp) return;
                        setPromptSaving(true);
                        const val = textareaRef.current?.value ?? editPrompt;
                        const enc = pp.split('/').map(s => encodeURIComponent(s)).join('/');
                        const res = await api(`/pipelines/${pipelineId}/artifacts/${enc}`, { method: 'PUT', body: val });
                        if (res.ok) { setPromptText(val); setEditPrompt(val); }
                        setPromptSaving(false);
                        setEditingLightbox(false);
                      }} disabled={promptSaving} className="text-xs px-2 py-1 bg-leaf-500/20 text-leaf-400 rounded hover:bg-leaf-500/30 transition-colors disabled:opacity-40 cursor-pointer">
                        {promptSaving ? '保存中...' : '保存'}
                      </button>
                      <button onClick={() => { setEditingLightbox(false); }}
                        className="text-xs px-2 py-1 bg-ink-700 text-stone-400 rounded hover:bg-ink-600 transition-colors cursor-pointer">取消</button>
                    </div>
                  ) : (
                    <button onClick={() => { setEditingLightbox(true); }}
                      className="w-6 h-6 rounded bg-ink-700 hover:bg-brass-500/30 text-stone-400 hover:text-brass-400 flex items-center justify-center text-sm transition-all cursor-pointer"
                      title="编辑 .md">✎</button>
                  )}
                </div>
                {editingLightbox ? (
                  <div className="flex-1 min-h-0 overflow-y-auto">
                    <textarea
                      ref={textareaRef}
                      key={lightboxName}
                      defaultValue={editPrompt}
                      className="w-full h-full bg-ink-950 text-stone-300 text-xs p-3 rounded border border-ink-700 font-mono resize-y"
                    />
                  </div>
                ) : (
                  <div className="markdown-body flex-1 min-h-0 overflow-y-auto">
                    <div dangerouslySetInnerHTML={{__html: DOMPurify.sanitize(marked.parse(promptText))}} />
                  </div>
                )}
              </div>
            )}
            {promptLoading && (
              <div className="bg-ink-900/95 border border-ink-700 rounded p-4 min-w-[280px]">
                <p className="text-xs text-stone-500">加载提示词中...</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
