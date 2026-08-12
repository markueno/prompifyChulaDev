import { Component, type ErrorInfo, type ReactNode } from 'react';
import { logger } from '~/utils/logger';

interface Props {
  children: ReactNode;
  /** Shown in the log so it's obvious which widget failed. */
  label: string;
  fallback?: ReactNode;
}

interface State {
  failed: boolean;
}

/**
 * Contains a failure to one non-essential widget.
 *
 * Remix's route ErrorBoundary catches render errors and replaces the ENTIRE page with
 * "Something went wrong" — right for a broken route, wrong for a secondary widget. The chat
 * history sidebar is now mounted on Overview, Pricing and Admin, where it is incidental: if it
 * throws, those pages should still work.
 */
export class SafeBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logger.error(`[${this.props.label}] crashed and was contained`, error, info.componentStack);
  }

  render() {
    if (this.state.failed) {
      return this.props.fallback ?? null;
    }

    return this.props.children;
  }
}
