# 21. Drop file-type Test Stubs in Campaign Import & Archive Suites

Date: 2026-04-12

## Status

Accepted

## Context

In the backend test suites `backend/src/routes/__tests__/campaignImportAllowlist.e2e.test.ts` and `backend/src/services/__tests__/campaignArchiveAudio.test.ts`, the external library `file-type` was previously stubbed out using `jest.mock('file-type', ...)`. The mock used rudimentary magic byte prefixes (such as 4-byte `OggS` slices, 8-byte PNG headers, or 2-byte `MZ` headers) and synthetic dispatch logic.

While this isolated the tests from `file-type`, it introduced several risks and discrepancies:
1. It allowed false confidence: invalid or corrupt payloads could pass the mocked sniffer but fail under production conditions.
2. The real `file-type` library classifies a bare 4-byte `OggS` container as `application/ogg` rather than `audio/ogg` unless a proper Vorbis or Opus packet header is present, causing silent divergence between test mocks and actual runtime behavior.
3. Another test suite (`backend/src/middleware/__tests__/fileTypeVerdicts.test.ts`) already runs directly against the real `file-type` library, demonstrating that running real detection in tests is both feasible and deterministic.
4. Duplicated, ad-hoc buffer definitions across multiple test files increased maintenance overhead.

## Decision

1. **Retire `jest.mock('file-type', ...)`**: Completely remove Jest mocks of `file-type` from `campaignImportAllowlist.e2e.test.ts` and `campaignArchiveAudio.test.ts`.
2. **Centralize Minimal Binary Fixtures in a Shared Helper**: Create `backend/src/__tests__/helpers/binaryFixtures.ts` exporting minimal, syntactically valid `Buffer` constants for:
   - Accepted images: PNG (1x1), JPEG, WebP, GIF (GIF89a).
   - Accepted audio: MP3 (with ID3v2 header), OGG (minimal valid Ogg Vorbis identification packet recognized as `audio/ogg`), WAV (minimal RIFF WAVE PCM header).
   - Documents: PDF (minimal valid header and EOF).
   - Rejected/Disallowed files: TIFF (Little-Endian TIFF header), EXE (MS-DOS/PE header `MZ`), Raw MP3 frame stream (valid MPEG audio sync without ID3 tag for fallback testing).
3. **Preserve Production Fallback Testing**: Specifically maintain test coverage for MPEG audio without ID3 tags to verify that when `file-type` returns `undefined`, CozyVTT's application-level audio frame fallback detector correctly inspects and identifies the stream as `audio/mpeg`.
4. **Expand Import Allowlist Coverage**: Update `campaignImportAllowlist.e2e.test.ts` to assert that all supported asset formats (PNG, JPEG, WebP, GIF, MP3, OGG, WAV) are properly accepted, and disallowed formats (TIFF, EXE, PDF for token/map) are consistently rejected.

## Consequences

### Positive
- Full parity between test execution and production detection pipelines for campaign imports and audio archives.
- Elimination of brittle mock logic that obscured real library behaviors (e.g. `application/ogg` vs `audio/ogg`).
- Reusable, deterministic binary fixtures available for future backend asset tests without bloating Git history with binary files.

### Neutral / Negative
- Minimal binary fixtures require maintaining structurally valid container headers (e.g. Ogg Vorbis identification page), though these are standard, small in size (< 1 KB), and completely static.
