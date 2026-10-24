import { z } from 'zod';
import { CoordinateSchema } from './maps';

/** What an add answers when the id it names is already on the map. */
export const DUPLICATE_WALL_ID_MESSAGE = 'A wall segment with that id is already on this map';
export const DUPLICATE_LIGHT_ID_MESSAGE = 'A light source with that id is already on this map';

export const WallSegmentSchema = z.object({
  id: z.string().uuid(),
  // Bounded (validators/maps.ts); where on the map is the route's check.
  x1: CoordinateSchema,
  y1: CoordinateSchema,
  x2: CoordinateSchema,
  y2: CoordinateSchema,
  type: z.enum(['wall', 'door-closed', 'door-open', 'door-locked', 'window']),
});

/**
 * Ids are unique within a map's list: an edit, a delete and sight all find a
 * wall or light by id, and two sharing one were each handled as the other.
 */
function refuseRepeatedIds(what: 'wall segments' | 'light sources') {
  return (items: Array<{ id: string }>, ctx: z.RefinementCtx) => {
    const seen = new Set<string>();
    items.forEach((item, i) => {
      if (seen.has(item.id)) {
        ctx.addIssue({ code: 'custom', message: `Two ${what} have the same id (${item.id})`, path: [i, 'id'] });
      }
      seen.add(item.id);
    });
  };
}

/** Most wall segments, doors included, one map holds. */
export const MAX_WALL_SEGMENTS = 5000;
/** Most light sources one map holds. */
export const MAX_LIGHT_SOURCES = 200;

export const WallSegmentsArraySchema = z
  .array(WallSegmentSchema)
  .max(MAX_WALL_SEGMENTS, `Maximum ${MAX_WALL_SEGMENTS} wall segments per map`)
  .superRefine(refuseRepeatedIds('wall segments'));

// ── Light Sources ────────────────────────────────────────────────────────────

/** Base shape for a light source (without cross-field refinement). */
const LightSourceBaseShape = z.object({
  id: z.string().uuid(),
  x: CoordinateSchema,
  y: CoordinateSchema,
  brightRadius: z.number().min(0).max(100),
  dimRadius: z.number().min(0.5).max(100),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  enabled: z.boolean(),
});

export const LightSourceSchema = LightSourceBaseShape.refine(
  (obj) => obj.dimRadius >= obj.brightRadius,
  { message: 'dimRadius must be >= brightRadius' }
);

export const LightSourcesArraySchema = z
  .array(LightSourceBaseShape)
  .max(MAX_LIGHT_SOURCES, `Maximum ${MAX_LIGHT_SOURCES} light sources per map`)
  .superRefine((lights, ctx) => {
    for (let i = 0; i < lights.length; i++) {
      if (lights[i].dimRadius < lights[i].brightRadius) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Light at index ${i}: dimRadius must be >= brightRadius`,
          path: [i, 'dimRadius'],
        });
      }
    }
  })
  .superRefine(refuseRepeatedIds('light sources'));

/** Partial schema for PATCH updates — all fields optional except id. */
export const LightSourceUpdateSchema = z.object({
  x: CoordinateSchema.optional(),
  y: CoordinateSchema.optional(),
  brightRadius: z.number().min(0).max(100).optional(),
  dimRadius: z.number().min(0.5).max(100).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  enabled: z.boolean().optional(),
}).refine(obj => Object.keys(obj).length > 0, { message: 'At least one field must be provided' });

// ── Fog Operations ───────────────────────────────────────────────────────────

/**
 * Most cells one reveal/hide message may name. The map itself may hold up to
 * 250,000 squares; a single `fog:operation` (and REST) or `exploration:reveal`
 * is capped here so one payload cannot carry a whole large grid. `reveal_all`
 * and `hide_all` send no cells array and are not under this cap.
 */
export const FOG_MESSAGE_MAX_CELLS = 20000;

const fogCellsInOneMessage = z
  .array(z.number().int().nonnegative())
  .max(FOG_MESSAGE_MAX_CELLS, `At most ${FOG_MESSAGE_MAX_CELLS} cells per message`);

export const FogOperationSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('reveal'),
    cells: fogCellsInOneMessage,
  }),
  z.object({
    op: z.literal('hide'),
    cells: fogCellsInOneMessage,
  }),
  z.object({ op: z.literal('reveal_all') }),
  z.object({ op: z.literal('hide_all') }),
]);

// ── Explored memory ──────────────────────────────────────────────────────────

/**
 * A player's vision covered these fog cells. Bounded so a client cannot push
 * a whole large map every frame; the handler unions it with what is stored.
 */
export const ExplorationRevealSchema = z.object({
  mapId: z.string().uuid(),
  cells: fogCellsInOneMessage,
  /** Whose memory to write. Only a DM may name someone else (Player Preview). */
  userId: z.string().uuid().optional(),
});
