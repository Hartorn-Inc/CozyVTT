# Accessible live-table interaction prototype

Status: throwaway UI prototype for Wayfinder [#25](https://github.com/Hartorn-Inc/CozyVTT/issues/25).

Question: which interaction model makes the campaign table usable for DM,
player, spectator, and admin personas with keyboard, assistive technology,
touch, and narrow viewports?

Run it from the repository root:

```bash
cd frontend
npm run dev
```

Open `/prototype/accessible-live-table?variant=A`.

Variants:

- `A` — Tool rail: map-first layout with persistent keyboard-friendly tools.
- `B` — Command deck: initiative-first layout with a high-signal command strip.
- `C` — Focus table: one surface with contextual actions for the selected item.

The route exists only in Vite development builds. It uses in-memory demo data;
it does not authenticate, call the API, persist state, or emit WebSocket
events. Use the persona and viewport controls, then compare focus order,
announcements, labels, action discoverability, character HP/conditions,
initiative context, the character-sheet summary, and narrow-screen behavior.
Narrow mode constrains the complete preview frame and intentionally stacks the
tools, map, character data, sheet summary, and state panel.

The floating switcher supports mouse, `←`, and `→` keyboard navigation. The
selected variant and the rationale should be recorded on Wayfinder #25 before
any production implementation begins.
