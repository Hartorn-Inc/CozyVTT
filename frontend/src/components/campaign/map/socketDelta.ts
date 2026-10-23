// ============================================
// Whether a live-table socket delta belongs on this join of this map.
//
// A `token.moved` (and any other token delta that used to ignore map and join)
// for another map, or for an older join, must not move or animate tokens here.
// The handler is bound with the join it was registered under; a payload that
// arrives after a rejoin, before join, or without a map id is discarded
// silently — no toast, no store write.
// ============================================

export interface SocketDeltaGate {
  /** Map id on the event. Missing is treated as another map. */
  eventMapId: string | undefined;
  /** Map this client is looking at. */
  currentMapId: string | undefined;
  /** Join epoch the handler was bound with. */
  boundJoinEpoch: number;
  /** Join epoch now. 0 until this connection has authenticated. */
  currentJoinEpoch: number;
}

/**
 * Whether a socket delta should be applied to the live table.
 *
 * False when the connection has not joined, the handler belongs to an older
 * join, the event names no map, or it names a different map.
 */
export function shouldApplySocketDelta({
  eventMapId,
  currentMapId,
  boundJoinEpoch,
  currentJoinEpoch,
}: SocketDeltaGate): boolean {
  if (currentJoinEpoch === 0) return false;
  if (boundJoinEpoch !== currentJoinEpoch) return false;
  if (eventMapId == null || eventMapId === '') return false;
  if (currentMapId == null || currentMapId === '') return false;
  return eventMapId === currentMapId;
}
