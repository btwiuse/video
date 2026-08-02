function StepTabs({ currentStep, pipelineStatus, activeStep, onNavigate }) {
  const isDone = pipelineStatus === 'done';
  const current = isDone ? WORKFLOW_STEP_COUNT : currentStep;
  return (
    <div className="mb-6 grid grid-cols-2 gap-2 rounded-xl border border-ink-700 bg-ink-800/70 p-2 sm:grid-cols-4">
      {[1,2,3,4].map(n => {
        const completed = n <= current;
        const isNext = n === current + 1;
        const available = completed || isNext;
        const isActive = n === activeStep;
        return (
          <button
            key={n}
            onClick={() => { if (available) onNavigate(n); }}
            disabled={!available}
            className={`step-btn min-w-0 py-2.5 px-2.5 rounded-lg text-sm font-medium transition-all ${
              isActive
                ? 'volc-primary text-ink-950 shadow-md shadow-brass-500/15'
                : completed
                  ? 'bg-brass-500/10 text-brass-600 hover:bg-brass-500/15'
                  : isNext
                    ? 'bg-ink-900 text-stone-300 border border-ink-600 hover:border-brass-400'
                    : 'text-stone-500 cursor-not-allowed'
            }`}
          >
            <div className="font-bold leading-tight">{completed ? '✓' : n}</div>
            <div className="text-xs opacity-80 mt-0.5">{STEP_NAMES[n]}</div>
          </button>
        );
      })}
    </div>
  );
}
