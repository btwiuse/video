const { useState, useEffect, useRef, useCallback } = React;

const formatDuration = (d) => {
  if (!d) return '';
  return d.replace(/(\d+)\.\d+(s)/g, '$1$2');
};

const API_BASE = window.location.origin;
const STEP_NAMES = ["", "剧本分镜", "视觉素材", "视频生成", "音频生成", "后期合成"];

const STATUS_BADGE_STYLES = {
  pending:     'bg-ink-700 text-stone-400',
  running:     'bg-brass-500/20 text-brass-400 animate-pulse-brass',
  done:        'bg-leaf-500/20 text-leaf-400',
  failed:      'bg-clay-500/20 text-clay-400',
  canceled:    'bg-ink-700 text-stone-400',
  step_1:      'bg-brass-500/10 text-brass-400',
  step_2:      'bg-brass-500/10 text-brass-400',
  step_3:      'bg-brass-500/10 text-brass-400',
  step_4:      'bg-brass-500/10 text-brass-400',
  step_5:      'bg-brass-500/10 text-brass-400',
};
const STATUS_BADGE_LABELS = {
  pending: '待处理', running: '运行中', done: '完成', failed: '失败', canceled: '已取消',
  step_1: '步骤 1', step_2: '步骤 2', step_3: '步骤 3', step_4: '步骤 4', step_5: '步骤 5',
};

// Sonner-style toast
const __toasts = [];
let __toastId = 0;
const __toastListeners = new Set();
function toast(message, options = {}) {
  const id = ++__toastId;
  __toasts.push({ id, message, ...options });
  __toastListeners.forEach(fn => fn([...__toasts]));
  setTimeout(() => {
    const idx = __toasts.findIndex(t => t.id === id);
    if (idx !== -1) { __toasts.splice(idx, 1); __toastListeners.forEach(fn => fn([...__toasts])); }
  }, options.duration || 3000);
  return id;
}
toast.error = (msg) => toast(msg, { type: 'error' });
function Toaster() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    __toastListeners.add(setItems);
    setItems([...__toasts]);
    return () => __toastListeners.delete(setItems);
  }, []);
  return ReactDOM.createPortal(
    <div className="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2 min-w-[280px] max-w-[380px] pointer-events-none">
      {items.map(t => (
        <div key={t.id} className={`pointer-events-auto px-4 py-3 rounded-lg shadow-2xl text-sm font-medium animate-slide-up ${t.type === 'error' ? 'bg-clay-500/90 text-white' : 'bg-ink-800/95 text-stone-100 border border-ink-600/50 backdrop-blur-sm'}`}>
          {t.message}
        </div>
      ))}
    </div>,
    document.body
  );
}

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error('ErrorBoundary caught:', error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="bg-clay-500/10 border border-clay-500/30 text-clay-400 p-6 rounded-lg my-4">
          <h3 className="font-heading text-lg font-semibold text-clay-400 mb-2">渲染错误</h3>
          <p className="text-sm text-stone-400 mb-3">此区域发生错误，请刷新页面重试。</p>
          <details className="text-xs text-stone-500">
            <summary className="cursor-pointer hover:text-stone-300">错误详情</summary>
            <pre className="mt-2 bg-ink-950 p-3 rounded overflow-auto max-h-48">{this.state.error.message}</pre>
          </details>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 px-4 py-2 text-xs font-medium bg-clay-500/20 text-clay-400 rounded hover:bg-clay-500/30 transition-colors"
          >
            刷新页面
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const fileCategory = (name) => {
  const ext = name.split('.').pop()?.toLowerCase();
  if (['png','jpg','jpeg','gif','webp'].includes(ext)) return 'image';
  if (['mp4','webm','mov'].includes(ext)) return 'video';
  if (['wav','mp3','m4a','flac'].includes(ext)) return 'audio';
  return 'text';
};

function api(url, opts = {}) {
  const isGet = !opts.method || opts.method === 'GET';
  const headers = isGet ? {} : { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  return fetch(`${API_BASE}${url}`, { ...opts, headers });
}
function artifactUrl(pipelineId, name, cb) {
  const enc = name.split('/').map(s => encodeURIComponent(s)).join('/');
  return `/pipelines/${pipelineId}/artifacts/${enc}${cb ? '?ck=' + cb : ''}`;
}

function StatusBadge({ status }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium ${STATUS_BADGE_STYLES[status] || 'bg-ink-700 text-stone-400'}`}>
      {status === 'running' && <span className="w-1.5 h-1.5 rounded-full bg-brass-400" />}
      {STATUS_BADGE_LABELS[status] || status}
    </span>
  );
}

