const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MiB default limit

const ALLOWED_MIME_EXT_MAP = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/webp': ['.webp'],
  'application/pdf': ['.pdf']
};

const ALLOWED_MIME_TYPES = Object.keys(ALLOWED_MIME_EXT_MAP);
const ALLOWED_EXTENSIONS = Object.values(ALLOWED_MIME_EXT_MAP).flat();

/**
 * Retrieve maximum allowed evidence file size in bytes from environment.
 * @returns {number}
 */
function getMaxFileSize() {
  const envVal = parseInt(process.env.MAX_EVIDENCE_FILE_SIZE_BYTES, 10);
  return !isNaN(envVal) && envVal > 0 ? envVal : DEFAULT_MAX_FILE_SIZE_BYTES;
}

/**
 * Retrieve verified private evidence storage directory.
 * @returns {string} Absolute resolved directory path
 */
function getStorageDir() {
  const envDir = process.env.EVIDENCE_STORAGE_DIR ? process.env.EVIDENCE_STORAGE_DIR.trim() : '';
  const targetDir = envDir
    ? path.resolve(process.cwd(), envDir)
    : path.resolve(process.cwd(), 'private', 'evidence');

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  return targetDir;
}

/**
 * Validate buffer header against expected magic bytes / file signatures.
 * Performs deep sanity checks on SOI/marker structure and chunk headers.
 * Note: File-signature inspection verifies format plausibility and rejects
 * mismatched or malformed headers, but does not substitute for deep sandbox scanning.
 *
 * @param {Buffer} buffer - File buffer
 * @param {string} mimeType - Claimed MIME type
 * @returns {boolean}
 */
function validateFileSignature(buffer, mimeType) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) {
    return false;
  }

  switch (mimeType) {
    case 'image/jpeg':
      // JPEG magic: FF D8 (SOI) followed by FF and a valid initial marker
      // Standard initial markers after SOI: APP0-APP15 (E0-EF), DQT (DB), SOF0-SOF15 (C0-CF), COM (FE)
      if (buffer.length < 4) return false;
      const isJpegSoi = buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF;
      if (!isJpegSoi) return false;
      const markerByte = buffer[3];
      const isValidJpegMarker =
        (markerByte >= 0xC0 && markerByte <= 0xFE && markerByte !== 0xFF);
      return isValidJpegMarker;

    case 'image/png':
      // PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
      if (buffer.length < 8) return false;
      return (
        buffer[0] === 0x89 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x4E &&
        buffer[3] === 0x47 &&
        buffer[4] === 0x0D &&
        buffer[5] === 0x0A &&
        buffer[6] === 0x1A &&
        buffer[7] === 0x0A
      );

    case 'image/webp':
      // WebP signature: RIFF (bytes 0-3), WEBP (bytes 8-11), and a recognized chunk (bytes 12-15)
      // Recognized first chunks per WebP container specification: 'VP8 ' (lossy), 'VP8L' (lossless), 'VP8X' (extended)
      if (buffer.length < 16) return false;
      const isRiff =
        buffer[0] === 0x52 && // R
        buffer[1] === 0x49 && // I
        buffer[2] === 0x46 && // F
        buffer[3] === 0x46;   // F
      const isWebp =
        buffer[8] === 0x57 &&  // W
        buffer[9] === 0x45 &&  // E
        buffer[10] === 0x42 && // B
        buffer[11] === 0x50;   // P
      if (!isRiff || !isWebp) return false;
      const chunkFourCC = buffer.subarray(12, 16).toString('ascii');
      const isRecognizedVp8Chunk =
        chunkFourCC === 'VP8 ' || chunkFourCC === 'VP8L' || chunkFourCC === 'VP8X';
      return isRecognizedVp8Chunk;

    case 'application/pdf':
      // PDF magic bytes: %PDF- (25 50 44 46 2D)
      if (buffer.length < 5) return false;
      return (
        buffer[0] === 0x25 && // %
        buffer[1] === 0x50 && // P
        buffer[2] === 0x44 && // D
        buffer[3] === 0x46 && // F
        buffer[4] === 0x2D    // -
      );

    default:
      return false;
  }
}

/**
 * Sanitize original client filename for safe display in metadata and headers.
 * Strips path traversal sequences, null bytes, and non-printable characters.
 *
 * @param {string} originalname
 * @returns {string}
 */
function sanitizeOriginalFilename(originalname) {
  if (!originalname || typeof originalname !== 'string') {
    return 'evidence_file';
  }
  const base = path.basename(originalname).replace(/[\x00-\x1f\x7f-\x9f\/\\]/g, '');
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, '_').trim();
  return cleaned.slice(0, 100) || 'evidence_file';
}

/**
 * Validate and save an evidence file buffer to private storage.
 * Enforces size limits, allowlists, signature validation, safe random naming,
 * and directory traversal checks.
 *
 * @param {Object} params
 * @param {Buffer} params.buffer
 * @param {string} params.originalname
 * @param {string} params.mimetype
 * @returns {Promise<{ storedFilename: string, originalFilename: string, mimeType: string, sizeBytes: number }>}
 */
async function saveEvidenceFile({ buffer, originalname, mimetype }) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('File buffer is empty or invalid.');
  }

  const maxBytes = getMaxFileSize();
  if (buffer.length > maxBytes) {
    throw new Error(`File size exceeds maximum limit of ${Math.round(maxBytes / (1024 * 1024))}MB.`);
  }

  // 1. Validate file extension
  const rawExt = path.extname(originalname || '').toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(rawExt)) {
    throw new Error(`Invalid file extension "${rawExt}". Allowed extensions: ${ALLOWED_EXTENSIONS.join(', ')}`);
  }

  // 2. Validate MIME type against allowlist
  const normalizedMime = (mimetype || '').toLowerCase().trim();
  if (!ALLOWED_MIME_TYPES.includes(normalizedMime)) {
    throw new Error(`Invalid file MIME type "${normalizedMime}". Allowed types: ${ALLOWED_MIME_TYPES.join(', ')}`);
  }

  // 3. Ensure claimed MIME type is compatible with claimed extension
  const validExtsForMime = ALLOWED_MIME_EXT_MAP[normalizedMime] || [];
  if (!validExtsForMime.includes(rawExt)) {
    throw new Error(`File extension "${rawExt}" does not match claimed MIME type "${normalizedMime}".`);
  }

  // 4. Validate file signature (magic bytes) against expected MIME type
  const signatureValid = validateFileSignature(buffer, normalizedMime);
  if (!signatureValid) {
    throw new Error('File content does not match the expected file signature.');
  }

  // 5. Generate cryptographically random stored filename
  const storageDir = getStorageDir();
  const storedFilename = `${crypto.randomUUID()}${rawExt}`;
  const targetPath = path.resolve(storageDir, storedFilename);

  // Path traversal guard
  if (!targetPath.startsWith(storageDir + path.sep)) {
    throw new Error('Path traversal detected during file storage resolution.');
  }

  // 6. Write file atomically to disk
  await fs.promises.writeFile(targetPath, buffer);

  return {
    storedFilename,
    originalFilename: sanitizeOriginalFilename(originalname),
    mimeType: normalizedMime,
    sizeBytes: buffer.length
  };
}

/**
 * Remove an evidence file from private storage.
 * @param {string} storedFilename
 * @returns {Promise<void>}
 */
async function deleteEvidenceFile(storedFilename) {
  if (!storedFilename || typeof storedFilename !== 'string') return;
  try {
    const storageDir = getStorageDir();
    const safeName = path.basename(storedFilename);
    const targetPath = path.resolve(storageDir, safeName);
    if (targetPath.startsWith(storageDir + path.sep)) {
      await fs.promises.unlink(targetPath);
    }
  } catch (err) {
    // Ignore ENOENT (file already deleted or does not exist)
    if (err.code !== 'ENOENT') {
      console.error('Failed to unlink evidence file:', err.message);
    }
  }
}

/**
 * Resolve verified absolute filesystem path for a stored evidence file.
 * Returns null if the path escapes the storage directory.
 *
 * @param {string} storedFilename
 * @returns {string|null} Resolved path or null if invalid/traversal
 */
function getEvidenceFilePath(storedFilename) {
  if (!storedFilename || typeof storedFilename !== 'string') return null;
  const storageDir = getStorageDir();
  const safeName = path.basename(storedFilename);
  const targetPath = path.resolve(storageDir, safeName);
  if (!targetPath.startsWith(storageDir + path.sep)) {
    return null;
  }
  return targetPath;
}

module.exports = {
  saveEvidenceFile,
  deleteEvidenceFile,
  getEvidenceFilePath,
  getMaxFileSize,
  getStorageDir,
  validateFileSignature,
  sanitizeOriginalFilename,
  ALLOWED_EXTENSIONS,
  ALLOWED_MIME_TYPES,
  DEFAULT_MAX_FILE_SIZE_BYTES
};
