// ============================================
// DmToolsMenu — SessionToolbar inline on wide, labelled menu on narrow
//
// The header's DM library/tools must stay reachable at phone width. The
// toolbar is a row of icon buttons that would clip; on a narrow viewport a
// labelled control opens the same tools instead.
// ============================================

import { useEffect, useState } from 'react';
import { useFocusTrap } from '@/hooks/useFocusTrap';
import SessionToolbar, { type SessionToolKey } from '@/components/campaign/SessionToolbar';
import Button from '@/components/ui/Button';
import { cn } from '@/utils/cn';

interface DmToolsMenuProps {
  isWide: boolean;
  openPanels: Partial<Record<SessionToolKey, boolean>>;
  onOpen: (key: SessionToolKey) => void;
  spiritLayerEnabled?: boolean;
  /** Close the narrow menu when a Party/Session drawer takes the overlay. */
  dismissed?: boolean;
  /** Opening the menu dismisses those drawers so only one overlay is up. */
  onWillOpen?: () => void;
}

export default function DmToolsMenu({
  isWide,
  openPanels,
  onOpen,
  spiritLayerEnabled,
  dismissed = false,
  onWillOpen,
}: DmToolsMenuProps) {
  const [open, setOpen] = useState(false);
  const overlayOpen = !isWide && open;
  const trapRef = useFocusTrap(overlayOpen, () => setOpen(false));

  useEffect(() => {
    if (dismissed) setOpen(false);
  }, [dismissed]);

  const toolbar = (
    <SessionToolbar
      layout={isWide ? 'icons' : 'list'}
      openPanels={openPanels}
      onOpen={(key) => {
        onOpen(key);
        setOpen(false);
      }}
      spiritLayerEnabled={spiritLayerEnabled}
    />
  );

  if (isWide) {
    return toolbar;
  }

  return (
    <div className="relative">
      <Button
        variant="ghost"
        className="min-h-11"
        aria-expanded={open}
        aria-controls="dm-tools-panel"
        onClick={() => {
          if (!open) onWillOpen?.();
          setOpen((value) => !value);
        }}
      >
        DM tools
      </Button>
      {open && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}
      <div
        ref={trapRef}
        id="dm-tools-panel"
        role={overlayOpen ? 'dialog' : undefined}
        aria-modal={overlayOpen ? true : undefined}
        aria-label="DM tools"
        aria-hidden={overlayOpen ? undefined : true}
        inert={!overlayOpen ? true : undefined}
        className={cn(
          'fixed right-2 top-16 z-50 mt-1 max-w-[calc(100vw-1rem)] rounded-cozy border border-brand/20 bg-surface p-2 shadow-lg',
          overlayOpen ? 'visible' : 'invisible pointer-events-none'
        )}
      >
        {toolbar}
        <Button
          variant="ghost"
          className="min-h-11 mt-2 w-full"
          onClick={() => setOpen(false)}
        >
          Close
        </Button>
      </div>
    </div>
  );
}
