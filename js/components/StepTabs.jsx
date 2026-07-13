function StepTabs({ currentStep, pipelineStatus, activeStep, onNavigate }) {
  const isDone = pipelineStatus === 'done';
  const current = isDone ? 5 : currentStep;
  return (
    <div className="flex gap-2 mb-6">
      {[1,2,3,4,5].map(n => {
        const completed = n <= current;
        const isNext = n === current + 1;
        const available = completed || isNext;
        const isActive = n === activeStep;
        return (
          <button
            key={n}
            onClick={() => { if (available) onNavigate(n); }}
            disabled={!available}
            className={`step-btn flex-1 py-3 px-2 rounded text-sm font-medium transition-all ${
              isActive
                ? 'bg-brass-500 text-ink-950 ring-1 ring-brass-400 shadow-lg shadow-brass-500/10'
                : completed
                  ? 'bg-brass-500/15 text-brass-400 hover:bg-brass-500/25'
                  : isNext
                    ? 'bg-ink-800 text-stone-300 ring-1 ring-ink-600 hover:bg-ink-700'
                    : 'bg-ink-800/60 text-stone-600 cursor-not-allowed'
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
