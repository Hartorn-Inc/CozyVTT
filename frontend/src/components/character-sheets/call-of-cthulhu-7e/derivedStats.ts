/**
 * The Call of Cthulhu 7e derived attributes, worked out from the
 * characteristics as the core rulebook's investigator creation steps say.
 *
 * Kept as the editor's import path. The formulas live in
 * `utils/rules/callOfCthulhu7e.ts` so the server can project the same numbers
 * at read. Dodge's base is in dodge.ts.
 */

export {
  cocHitPoints,
  cocMagicPoints,
  cocMaxSanity,
  cocHalfAndFifth,
  cocDamageBonusAndBuild,
  cocMoveRate,
} from '../../../utils/rules/callOfCthulhu7e';
