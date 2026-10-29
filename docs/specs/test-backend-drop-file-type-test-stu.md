# Specification: Drop file-type Test Stubs in Campaign Import & Archive Suites

## 1. Overview & Business Value

CozyVTT validates uploaded and imported assets through format sniffing powered by `file-type` and fallback audio frame inspection. Two existing integration and service test suites (`campaignImportAllowlist.e2e.test.ts` and `campaignArchiveAudio.test.ts`) previously mocked `file-type` via `jest.mock(...)`. This prevented the suites from exercising the actual detection logic, obscuring real-world behavior—such as `file-type` returning `application/ogg` instead of `audio/ogg` for malformed OGG containers.

This specification defines the replacement of those test stubs with minimal, structurally valid in-memory binary fixtures, exercising the real `file-type` library across campaign import and archive audio flows.

## 2. Technical Architecture & Component Changes

### 2.1 Centralized Binary Fixtures Helper (`backend/src/__tests__/helpers/binaryFixtures.ts`)

A dedicated helper module will export immutable `Buffer` instances representing the smallest valid headers and payloads for each format:

- `PNG_FIXTURE`: Minimal 1x1 transparent/valid PNG (approx. 67-85 bytes) beginning with `\x89PNG\r\n\x1a\n` and containing valid `IHDR`, `IDAT`, and `IEND` chunks.
- `JPEG_FIXTURE`: Minimal valid JPEG image (approx. 100-200 bytes) with SOI (`0xFFD8`), SOF0, and EOI (`0xFFD9`) markers.
- `WEBP_FIXTURE`: Minimal valid WebP image starting with `RIFF....WEBPVP8 `.
- `GIF_FIXTURE`: Minimal valid GIF89a image (approx. 35-43 bytes).
- `MP3_ID3_FIXTURE`: Valid MP3 buffer starting with an `ID3v2` tag header (`ID3...`) recognized natively by `file-type` as `audio/mpeg`.
- `MP3_RAW_FRAME_FIXTURE`: Valid MPEG-1 Layer 3 sync header (e.g., `0xFFFB9064`) without ID3 container, for which `file-type` returns `undefined`, triggering CozyVTT's audio frame fallback sniffer.
- `OGG_VORBIS_FIXTURE`: Minimal valid Ogg page containing the Vorbis identification header packet (`\x01vorbis`), structured with magic `OggS`, header type `0x02` (BOS), stream serial, and vorbis header packet payload, natively recognized by `file-type` as `audio/ogg`.
- `WAV_FIXTURE`: Minimal valid 44-byte canonical WAV header (`RIFF....WAVEfmt ...data...`).
- `PDF_FIXTURE`: Minimal PDF document header and trailer (`%PDF-1.4...%%EOF`).
- `TIFF_FIXTURE`: Minimal TIFF header (`II*\x00` Little Endian or `MM\x00*` Big Endian).
- `EXE_FIXTURE`: Minimal DOS/PE executable header (`MZ...`).

### 2.2 Removal of Jest Mocks

1. `backend/src/routes/__tests__/campaignImportAllowlist.e2e.test.ts`:
   - Remove `jest.mock('file-type', ...)` completely.
   - Import fixtures from `backend/src/__tests__/helpers/binaryFixtures.ts`.
   - Ensure all `importOne(...)` calls use the centralized fixtures.
   - Expand test cases to cover all allowed formats for campaigns (`PNG`, `JPEG`, `WEBP`, `GIF`, `OGG`, `MP3`, `WAV`).
   - Validate rejection of disallowed types (`TIFF`, `EXE`, `PDF` as map/token).
   - Validate that raw MP3 frames exercise the fallback detector and are successfully recognized as `audio/mpeg`.

2. `backend/src/services/__tests__/campaignArchiveAudio.test.ts`:
   - Remove `jest.mock('file-type', ...)` completely.
   - Replace the synthetic 4-byte `OggS` buffer with `OGG_VORBIS_FIXTURE`.
   - Validate that campaign export and import cycle with audio assets succeeds with genuine `audio/ogg` MIME detection.

## 3. Data Structures & File Layout

### New Module: `backend/src/__tests__/helpers/binaryFixtures.ts`

Exports:
```typescript
export const BINARY_FIXTURES: {
  png: Buffer;
  jpeg: Buffer;
  webp: Buffer;
  gif: Buffer;
  mp3WithId3: Buffer;
  mp3RawFrame: Buffer;
  oggVorbis: Buffer;
  wav: Buffer;
  pdf: Buffer;
  tiff: Buffer;
  exe: Buffer;
};
```

Convenience named exports (`PNG_BUFFER`, `JPEG_BUFFER`, etc.) may also be provided.

## 4. Test Matrix & Acceptance Criteria

| Suite | Test Case | Fixture | Expected Verdict | Expected MIME |
| :--- | :--- | :--- | :--- | :--- |
| `campaignImportAllowlist.e2e.test.ts` | Disallowed executable disguised as PDF | `EXE_FIXTURE` | Rejected (empty array) | N/A |
| `campaignImportAllowlist.e2e.test.ts` | Disallowed image (TIFF) for token | `TIFF_FIXTURE` | Rejected (empty array) | N/A |
| `campaignImportAllowlist.e2e.test.ts` | PDF for map | `PDF_FIXTURE` | Rejected (empty array) | N/A |
| `campaignImportAllowlist.e2e.test.ts` | Allowed images (PNG, JPEG, WEBP, GIF) | Respective image fixtures | Accepted (stored) | `image/png`, `image/jpeg`, `image/webp`, `image/gif` |
| `campaignImportAllowlist.e2e.test.ts` | Allowed audio (OGG Vorbis) | `OGG_VORBIS_FIXTURE` | Accepted (stored) | `audio/ogg` |
| `campaignImportAllowlist.e2e.test.ts` | Allowed audio (MP3 ID3) | `MP3_ID3_FIXTURE` | Accepted (stored) | `audio/mpeg` |
| `campaignImportAllowlist.e2e.test.ts` | Allowed audio (Raw MP3 Frame) | `MP3_RAW_FRAME_FIXTURE` | Accepted via fallback | `audio/mpeg` |
| `campaignImportAllowlist.e2e.test.ts` | Allowed audio (WAV) | `WAV_FIXTURE` | Accepted (stored) | `audio/wav` (or `audio/vnd.wave`) |
| `campaignArchiveAudio.test.ts` | Export & re-import audio tracks | `OGG_VORBIS_FIXTURE` | Accepted, tracks restored | `audio/ogg` |

## 5. Security & Invariant Analysis

- **OWASP LLM01 / Tampering Resistance**: Test fixtures are purely static byte buffers and contain no shell scripts, commands, or unescaped strings.
- **MIME Sniffing Invariant**: Uploads and imports must strictly honor byte content rather than metadata headers or file extensions. Real detection tests verify that arbitrary filenames (`Players Handbook.exe` containing PNG bytes) are saved as `.png` with `image/png`.
- **Fallback Isolation**: Testing raw MPEG frame headers ensures that the fallback parser in CozyVTT cannot be broken by future upgrades to the `file-type` dependency.
