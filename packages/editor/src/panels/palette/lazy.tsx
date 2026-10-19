// Lazy panel bodies of the Model panels (B13): the Palette panel, the Model Outliner and the Attributes panel's Model
// sections load as chunks. A chunk that fails to arrive shows a short message with a retry (a fresh `React.lazy` per
// attempt: a rejected lazy component stays rejected) instead of taking the dock down.
import {
  Component,
  type ComponentType,
  type ErrorInfo,
  type JSX,
  type LazyExoticComponent,
  lazy,
  type ReactNode,
  Suspense,
  useState,
} from 'react';
import { BUTTON, EMPTY_STATE } from '../channel-box/kit/styles';

class LazyBoundary extends Component<
  { readonly name: string; readonly onRetry: () => void; readonly children: ReactNode },
  { readonly failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError(): { readonly failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.warn(`Ekza Animator: the ${this.props.name} could not be loaded`, error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className={EMPTY_STATE} data-testid="lazy-failed">
        <p>
          The {this.props.name} could not be loaded.{' '}
          <button
            type="button"
            className={BUTTON}
            onClick={() => {
              this.setState({ failed: false });
              this.props.onRetry();
            }}
          >
            Retry
          </button>
        </p>
      </div>
    );
  }
}

/** Renders the default export of `load` with `props`, a retry on failure and `fallback` while it loads. */
export function LazyBody<P extends object>(props: {
  readonly name: string;
  readonly load: () => Promise<{ readonly default: ComponentType<P> }>;
  readonly props: P;
  readonly fallback?: ReactNode;
}): JSX.Element {
  const [View, setView] = useState<LazyExoticComponent<ComponentType<P>>>(() => lazy(props.load));
  return (
    <LazyBoundary name={props.name} onRetry={() => setView(() => lazy(props.load))}>
      <Suspense fallback={props.fallback ?? null}>
        {/* oxlint-disable-next-line react/static-components -- one lazy component per load attempt, kept in state */}
        <View {...props.props} />
      </Suspense>
    </LazyBoundary>
  );
}
