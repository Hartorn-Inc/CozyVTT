# SRD Attribution

## What this covers

CozyVTT ships no publisher rulebooks. When an administrator seeds the creature
library, the server fetches creature stat blocks from the [Open5e API](https://open5e.com)
into that instance's own database. Those stat blocks come from the **Dungeons &
Dragons 5th Edition System Reference Document 5.1 (SRD 5.1)**, published by
Wizards of the Coast LLC. That seeding is the attributed CC-BY-4.0 exception.

Pathfinder 2e, Call of Cthulhu 7e, and Shadowrun 6e ship as **structure-only**
sheets: attribute, skill, and feature names the player fills in, with no
publisher rulebook prose. They are not licensed game content.

This file attributes the SRD creature exception and records that the other
shipped systems are structure-only. Third-party software is credited in
[THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md) and
[THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt).

## Licence

SRD 5.1 is released under **two** licences, and a user may choose either:
the Open Game License 1.0a, or the Creative Commons Attribution 4.0
International Licence.

**CozyVTT uses it under CC-BY-4.0.** That choice means a single attribution
notice rather than bundling the full OGL text and maintaining its Section 15
copyright chain. It is also the direction Wizards themselves have taken —
SRD 5.2.1 and everything after it is Creative Commons only.

The required notice is in [SRD_LICENSE.txt](SRD_LICENSE.txt) and reads:

> This work includes material from the System Reference Document 5.1
> ("SRD 5.1") by Wizards of the Coast LLC, available at
> https://dnd.wizards.com/resources/systems-reference-document. The SRD 5.1 is
> licensed under the Creative Commons Attribution 4.0 International License,
> available at https://creativecommons.org/licenses/by/4.0/legalcode.

The app shows a shorter credit in the creature library, with links to the
SRD 5.1 and to the licence: at the foot of the library whenever it lists an
SRD creature, and under the button that imports them, which only an
administrator is offered, while no SRD creatures are imported.

## Open5e

The data reaches CozyVTT through the [Open5e API](https://open5e.com), which
serves the SRD in a structured form so applications do not each have to parse
the source document. That work is not ours and is worth naming: Open5e is a
community project, and the creature library would be a great deal more effort
without it.

The seeder requests the `wotc-srd` document specifically, so only SRD material
is imported.

## Trademarks

Dungeons & Dragons, D&D, and all related logos are trademarks of Wizards of the
Coast LLC. They are **not** included in CozyVTT, and nothing here implies
endorsement or affiliation. What the SRD makes freely usable is the mechanical
content — ability scores, hit points, actions, traits — and that is all CozyVTT
imports.

## Pathfinder 2e (structure-only)

CozyVTT ships a Pathfinder 2e character sheet: attribute names, skill keys,
feat and class-feature name slots, and the rest of the sheet structure a player
fills in. Shipped starter templates keep those names and drop rules prose.
CozyVTT does not ship Paizo rulebook text, adventures, stat blocks, or artwork,
and this is not licensed Pathfinder content.

Pathfinder and related marks belong to their owners. Nothing here implies
endorsement or affiliation.

## Call of Cthulhu 7e (structure-only)

CozyVTT ships a Call of Cthulhu 7e investigator sheet: characteristic names,
skill keys, formula fields such as `(CON+SIZ)/10`, and the rest of the sheet
structure a player fills in. Shipped starter templates keep those names and
investigator flavor and drop rules prose. CozyVTT does not ship Chaosium
rulebook text, adventures, or artwork, and this is not licensed Call of
Cthulhu content.

Call of Cthulhu and related marks belong to their owners. Nothing here implies
endorsement or affiliation.

## Shadowrun 6e (structure-only)

CozyVTT ships Shadowrun 6e sheet structure: attribute names, skill keys,
quality and gear name slots, and derived-stat formula fields. Shipped starter
templates keep those names and drop rules prose. Create and edit stay closed
until the sheet UI exists; this section is the structure-only notice, not a
completed sheet.

Shadowrun and related marks belong to their owners. Nothing here implies
endorsement or affiliation. This is not licensed Shadowrun content.

## If you add another game system

Attribute it here, in its own section, naming the licence it is published under
(OGL, ORC, Creative Commons, a fan-content policy) and where the content came
from. If a system is not openly licensed, restrict the contribution to sheet
structure and data the user enters themselves. A PR that adds rules prose
needs a section here and does not merge without one.
