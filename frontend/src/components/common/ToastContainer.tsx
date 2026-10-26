// ============================================
// ToastContainer — renders the stacked toast queue
// Consumes ToastContext to display multiple simultaneous notifications.
// ============================================

import { useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react';
import { useToastStack } from '@/contexts/ToastContext';
import type { ToastItem } from '@/contexts/ToastContext';

const isTest = typeof import.meta !== 'undefined' && import.meta.env?.MODE === 'test';

// ============================================
// Individual Toast Card
// ============================================

function ToastCard({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: string) => void }) {
  // Auto-dismiss timer: duration belongs to the stack, not restarted when new toasts arrive
  useEffect(() => {
    if (toast.duration <= 0) return;
    const timer = setTimeout(() => onDismiss(toast.id), toast.duration);
    return () => clearTimeout(timer);
  }, [toast.id, toast.duration, onDismiss]);

  const { icon, styles } = getToastAppearance(toast.type);

  return (
    <motion.div
      layout={!isTest}
      initial={isTest ? false : { opacity: 0, x: 60, scale: 0.95 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={isTest ? undefined : { opacity: 0, x: 60, scale: 0.9 }}
      transition={{ duration: isTest ? 0 : 0.2 }}
      className="pointer-events-auto"
    >
      <div
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
        className={`glass-panel border-2 ${styles} shadow-lg rounded-lg p-4 flex items-start gap-3 min-w-[280px] max-w-sm`}
      >
        <div className="flex-shrink-0 mt-0.5" aria-hidden="true">
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium break-words">{toast.message}</p>
        </div>
        <button
          onClick={() => onDismiss(toast.id)}
          className="flex-shrink-0 ml-2 hover:opacity-70 transition-opacity focus:outline-none focus:ring-2 focus:ring-current rounded"
          aria-label="Dismiss notification"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
    </motion.div>
  );
}

// ============================================
// Appearance helpers
// ============================================

function getToastAppearance(type: ToastItem['type']) {
  switch (type) {
    case 'success':
      return {
        icon: <CheckCircle className="w-5 h-5 text-success-ink" />,
        styles: 'bg-success/10 border-success/30 text-success-ink',
      };
    case 'error':
      return {
        icon: <AlertCircle className="w-5 h-5 text-danger-ink" />,
        styles: 'bg-danger/10 border-danger/30 text-danger-ink',
      };
    case 'warning':
      return {
        icon: <AlertTriangle className="w-5 h-5 text-warning-ink" />,
        styles: 'bg-warning/10 border-warning/30 text-warning-ink',
      };
    default:
      return {
        icon: <Info className="w-5 h-5 text-info-ink" />,
        styles: 'bg-info/10 border-info/30 text-info-ink',
      };
  }
}

// ============================================
// Container
// ============================================

export default function ToastContainer() {
  const { toasts, dismissToast } = useToastStack();

  const content = toasts.map((toast) => (
    <ToastCard
      key={toast.id}
      toast={toast}
      onDismiss={dismissToast}
    />
  ));

  return (
    <div
      aria-label="Notifications"
      className="fixed top-4 right-4 z-[9998] flex flex-col gap-2 pointer-events-none"
    >
      {isTest ? content : <AnimatePresence mode="sync">{content}</AnimatePresence>}
    </div>
  );
}
