import { ToastContainer, useToast } from '@mieweb/ui';

/**
 * Where toasts show. @mieweb/ui's ToastProvider only keeps the list; the app
 * draws it. Rendered once, inside the provider in AppLayout.
 */
export function AppToasts() {
  const { toasts, dismiss } = useToast();
  return <ToastContainer toasts={toasts} onDismiss={dismiss} />;
}
