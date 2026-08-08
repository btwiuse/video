function AuthScreen({ onAuthenticated, onBack }) {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async event => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await api(`/auth/${mode === 'login' ? 'login' : 'register'}`, {
        method: 'POST', body: JSON.stringify({ email, password }),
      });
      if (!response.ok) throw new Error(await response.text());
      const data = await response.json();
      onAuthenticated(data.user);
    } catch (requestError) {
      setError(requestError.message || '操作失败，请稍后重试');
    } finally {
      setBusy(false);
    }
  };

  return <div className="mx-auto max-w-md pt-6">
    <section className="overflow-hidden rounded-xl border border-ink-700 bg-ink-900 shadow-sm">
      <div className="border-b border-ink-700 px-6 py-5">
        <button type="button" onClick={onBack} className="mb-4 text-sm text-stone-400 hover:text-brass-500">← 返回公开项目</button>
        <h2 className="font-heading text-2xl font-semibold text-stone-100">{mode === 'login' ? '登录工作台' : '创建账户'}</h2>
        <p className="mt-2 text-sm text-stone-400">登录后查看个人与组织的私有项目。</p>
      </div>
      <form onSubmit={submit} className="space-y-4 p-6">
        <div><label className="mb-1.5 block text-xs font-medium text-stone-300">邮箱</label><input className="style-input" type="email" required value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" /></div>
        <div><label className="mb-1.5 block text-xs font-medium text-stone-300">密码</label><input className="style-input" type="password" required value={password} onChange={event => setPassword(event.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /></div>
        {error && <p className="rounded-md border border-clay-500/30 bg-clay-500/10 px-3 py-2 text-sm text-clay-400">{error}</p>}
        <button disabled={busy} className="volc-primary w-full rounded-lg px-4 py-2.5 text-sm font-medium text-ink-950 disabled:opacity-50">{busy ? '处理中…' : mode === 'login' ? '登录' : '注册并登录'}</button>
      </form>
      <div className="border-t border-ink-700 px-6 py-4 text-sm text-stone-400">
        {mode === 'login' ? '还没有账户？' : '已有账户？'} <button type="button" className="font-medium text-brass-500 hover:text-brass-400" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}>{mode === 'login' ? '注册' : '登录'}</button>
      </div>
    </section>
  </div>;
}
