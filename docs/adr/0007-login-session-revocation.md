# Login-session revocation is fail-closed, with a two-second drag bound

A **login session** is the signed-in connection, not a play **Session**. Discrete HTTP and socket actions use current authorization (0 s stale). High-frequency drag frames may be stale at most 2 s; a monitor then disconnects. Self-service password/MFA keeps the initiating login session and revokes the others; admin/reset/external revocation kills all of them. Campaign kick or role change drops that table's sockets and leaves the login session. If the store or policy cannot be confirmed, the action fails closed (503); a dead login session is 401. This remediation supports one backend process. Moving login sessions onto the configured PostgreSQL schema may sign everyone out once.

**Status**: accepted
