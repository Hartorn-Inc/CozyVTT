// ============================================
// TableDrawer — party / session chrome that never unmounts
//
// Wide: a persistent rail (or a zero-width collapsed rail).
// Narrow: an overlay drawer. Closed drawers stay mounted (`invisible` /
// off-screen / aria-hidden) so CampaignRoster, TokenRoster and SessionSidebar
// keep their socket listeners and chat history.
// ============================================

import { useFocusTrap } from '@/hooks/useFocusTrap';
import Button from '@/components/ui/Button';
import { cn } from '@/utils/cn';

interface TableDrawerProps {
  id: string;
  title: string;
  side: 'left' | 'right';
  isWide: boolean;
  /** Wide only: hide the rail without unmounting. */
  collapsed: boolean;
  /** Narrow only: overlay the map. */
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** Inner scroller. SessionSidebar manages its own scroll, so pass `false`. */
  scrollBody?: boolean;
}

export default function TableDrawer({
  id,
  title,
  side,
  isWide,
  collapsed,
  open,
  onClose,
  children,
  scrollBody = true,
}: TableDrawerProps) {
  const overlayOpen = !isWide && open;
  const wideVisible = isWide && !collapsed;
  const shown = overlayOpen || wideVisible;
  const trapRef = useFocusTrap(overlayOpen, onClose);
  const titleId = `${id}-title`;

  return (
    <>
      {overlayOpen && (
        <div
          className="fixed inset-0 z-40 bg-ink/50"
          onClick={onClose}
          aria-hidden="true"
        />
      )}
      <aside
        ref={trapRef}
        id={id}
        role={overlayOpen ? 'dialog' : undefined}
        aria-modal={overlayOpen ? true : undefined}
        aria-labelledby={overlayOpen ? titleId : undefined}
        aria-label={overlayOpen ? undefined : title}
        aria-hidden={shown ? undefined : true}
        inert={!shown ? true : undefined}
        className={cn(
          'flex flex-col bg-surface',
          isWide && wideVisible && cn(
            'relative h-full shrink-0',
            side === 'left' ? 'w-[16.25rem] border-r border-brand/20' : 'w-[18.75rem] border-l border-brand/20'
          ),
          isWide && !wideVisible && 'w-0 overflow-hidden invisible pointer-events-none border-0',
          !isWide && 'fixed inset-y-0 z-50 w-[min(20rem,92vw)] max-w-full shadow-lg',
          !isWide && side === 'left' && 'left-0 border-r border-brand/20',
          !isWide && side === 'right' && 'right-0 border-l border-brand/20',
          !isWide && overlayOpen && 'visible',
          !isWide && !overlayOpen && cn(
            'invisible pointer-events-none',
            side === 'left' ? '-translate-x-full' : 'translate-x-full'
          )
        )}
      >
        {overlayOpen && (
          <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-brand/20 shrink-0">
            <h2 id={titleId} className="text-sm font-semibold text-ink">
              {title}
            </h2>
            <Button variant="ghost" className="min-h-11" onClick={onClose}>
              Close
            </Button>
          </div>
        )}
        <div
          className={cn(
            'flex-1 min-h-0',
            scrollBody ? 'overflow-y-auto p-4 space-y-4' : 'overflow-hidden'
          )}
        >
          {children}
        </div>
      </aside>
    </>
  );
}
