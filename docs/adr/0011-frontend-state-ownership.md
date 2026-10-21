# One layer owns each live-table datum; stale replies are dropped

**Campaign** wiring (React Context) owns identity and clocks: which campaign, which **current map**, this join. React Query owns REST documents (campaign row, map metadata, characters, assets). The Zustand live-table store owns **tokens** and chat. A REST reply whose generation or campaign does not match the route is discarded; a socket delta for another map or an older join is discarded. Failed writes stay on screen and say so. Saving campaign settings patches the REST document and does not remount the table. Disconnect keeps the last frame. A failed load is an error with retry, never an empty success. We rejected Context holding the current-map document and copying tokens into Zustand (last REST reply wins), Zustand owning REST lists, and React Query owning per-frame token moves.

**Status**: accepted
