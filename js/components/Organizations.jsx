function Organizations({ onBack, onOrganizationsChanged }) {
  const [organizations, setOrganizations] = useState([]);
  const [name, setName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [issuedCode, setIssuedCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const response = await api('/organizations');
    if (!response.ok) throw new Error(await response.text());
    const data = await response.json();
    setOrganizations(data.organizations || []);
    onOrganizationsChanged(data.organizations || []);
  }, [onOrganizationsChanged]);
  useEffect(() => { load().catch(requestError => setError(requestError.message)); }, [load]);

  const create = async event => {
    event.preventDefault(); setBusy(true); setError(''); setIssuedCode('');
    try {
      const response = await api('/organizations', { method: 'POST', body: JSON.stringify({ name }) });
      if (!response.ok) throw new Error(await response.text());
      const data = await response.json();
      setIssuedCode(data.invite_code);
      setName('');
      await load();
    } catch (requestError) { setError(requestError.message || '创建失败'); } finally { setBusy(false); }
  };
  const join = async event => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const response = await api('/organizations/join', { method: 'POST', body: JSON.stringify({ invite_code: inviteCode }) });
      if (!response.ok) throw new Error(await response.text());
      setInviteCode(''); await load(); toast('已加入组织');
    } catch (requestError) { setError(requestError.message || '加入失败'); } finally { setBusy(false); }
  };
  const select = id => { setActiveOrganizationId(id); toast(id ? '已切换到组织工作区' : '已切换到个人工作区'); };

  return <div className="mx-auto max-w-4xl">
    <button type="button" onClick={onBack} className="nav-btn mb-4 text-sm text-stone-400 hover:text-brass-500">← 返回项目</button>
    <div className="mb-6"><p className="text-[11px] font-medium tracking-wide text-brass-500">WORKSPACE</p><h2 className="mt-1 font-heading text-2xl font-semibold text-stone-100">组织</h2><p className="mt-2 text-sm text-stone-400">组织成员可以共同查看和编辑该组织创建的项目与风格预设。</p></div>
    {error && <p className="mb-4 rounded-md border border-clay-500/30 bg-clay-500/10 px-3 py-2 text-sm text-clay-400">{error}</p>}
    {issuedCode && <div className="mb-5 rounded-lg border border-leaf-500/30 bg-leaf-500/10 p-4"><p className="text-sm font-medium text-leaf-500">组织邀请码</p><p className="mt-2 break-all font-mono text-sm text-stone-200">{issuedCode}</p></div>}
    <div className="grid gap-5 md:grid-cols-2">
      <section className="rounded-xl border border-ink-700 bg-ink-900 p-5"><h3 className="font-heading text-lg font-semibold text-stone-100">创建组织</h3><form onSubmit={create} className="mt-4 flex gap-2"><input className="style-input min-w-0 flex-1" placeholder="组织名称" value={name} onChange={event => setName(event.target.value)} required /><button disabled={busy} className="volc-primary shrink-0 rounded-lg px-3 text-sm font-medium text-ink-950 disabled:opacity-50">创建</button></form></section>
      <section className="rounded-xl border border-ink-700 bg-ink-900 p-5"><h3 className="font-heading text-lg font-semibold text-stone-100">加入组织</h3><form onSubmit={join} className="mt-4 flex gap-2"><input className="style-input min-w-0 flex-1" placeholder="邀请码" value={inviteCode} onChange={event => setInviteCode(event.target.value)} required /><button disabled={busy} className="rounded-lg border border-ink-600 px-3 text-sm font-medium text-stone-200 hover:border-brass-500">加入</button></form></section>
    </div>
    <section className="mt-5 overflow-hidden rounded-xl border border-ink-700 bg-ink-900"><div className="border-b border-ink-700 px-5 py-3 text-sm font-medium text-stone-200">我的组织</div><div className="divide-y divide-ink-700"><button type="button" onClick={() => select('')} className="flex w-full items-center justify-between px-5 py-4 text-left hover:bg-ink-800"><span className="text-sm text-stone-200">个人工作区</span>{!getActiveOrganizationId() && <span className="text-xs text-leaf-500">当前</span>}</button>{organizations.map(organization => <button key={organization.id} type="button" onClick={() => select(organization.id)} className="flex w-full items-center justify-between px-5 py-4 text-left hover:bg-ink-800"><span className="text-sm text-stone-200">{organization.name}</span>{getActiveOrganizationId() === organization.id && <span className="text-xs text-leaf-500">当前</span>}</button>)}</div></section>
  </div>;
}
