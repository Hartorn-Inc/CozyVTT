...
## Language
...
**Session Lifecycle**:
The deterministic progression of a Campaign's live play session through ACTIVE, PAUSED, and INACTIVE states, guaranteeing that at most one session is running or suspended at any time and that state snapshots are preserved reliably across pauses and ends.
_Avoid_: Game lifecycle, match status

**Dice Parser Arithmetic Validation**:
The validation boundary within formula parsing that rejects undefined, non-finite, and division-by-zero results (such as Infinity and NaN) with typed errors before database persistence.
_Avoid_: Math validation, raw eval check

**Obscured Creature Log Masking**:
The conditional visibility policy applied to dice log entries for obscured tokens: the DM and the controlling player see the true token name, while other members see 'Unknown creature'.
_Avoid_: Anonymized roll, hidden token roll

**Authoritative Dice Log Reconciliation**:
The synchronization mechanism where rejoining clients replace their entire client-side roll history with the server-side authoritative list, ensuring DM clear actions are reflected immediately without page reloads.
_Avoid_: Roll append, log merge

**Socket Manager Lifecycle Listeners**:
Network event handlers bound directly to the Socket.IO v4 Manager (`socket.io`) to capture low-level transport events (reconnect_attempt, reconnect, reconnect_failed) instead of the high-level namespace socket.
_Avoid_: Socket reconnect events, client socket listeners
...