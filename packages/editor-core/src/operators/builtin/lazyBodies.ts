// Lazy apply bodies of the built-in operators (M-AI B5, `check:size`): an operator file keeps its definitions and
// polls on the editor's and Auto-Rig's first visit, and its apply bodies are a chunk of their own that each run's
// `prepare` loads — like `pose.mirrorAnimation`'s workflow (§5.27). The loader returns the module itself once loaded,
// so later runs stay synchronous up to `apply` as before; a failed load fails that run and is retried by the next.
// Model, clip and project imports prefetch every body chunk (`preloadOperatorBodies`: a character is about to arrive,
// so its first edit does not wait).

const loaders: (() => unknown)[] = [];

/** The loader of one body chunk (`load` is the file's literal `import('./…')`). */
export function lazyBodies<M>(load: () => Promise<M>): () => M | Promise<M> {
  let loaded: M | null = null;
  let loading: Promise<M> | null = null;
  const get = (): M | Promise<M> => {
    if (loaded !== null) return loaded;
    if (loading === null) {
      const attempt = load().then((chunk) => {
        loaded = chunk;
        return chunk;
      });
      loading = attempt;
      attempt.catch(() => {
        if (loading === attempt) loading = null;
      });
    }
    return loading;
  };
  loaders.push(get);
  return get;
}

/** Intent prefetch of every body chunk; errors are left to the run that needs it. */
export function preloadOperatorBodies(): void {
  for (const get of loaders) Promise.resolve(get()).catch(() => {});
}
