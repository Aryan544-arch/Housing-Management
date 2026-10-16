const multer = require('multer');
const { getMaxFileSize } = require('../services/evidence/evidenceStorageService');

const storage = multer.memoryStorage();

const MAX_FIELDS = 10;
const MAX_FIELD_SIZE_BYTES = 10 * 1024; // 10 KiB per field
const MAX_PARTS = 15;

const upload = multer({
  storage,
  limits: {
    fileSize: getMaxFileSize(),
    files: 1,
    fields: MAX_FIELDS,
    fieldSize: MAX_FIELD_SIZE_BYTES,
    parts: MAX_PARTS
  }
});

/**
 * Express middleware for single evidence file upload handling Multer errors gracefully.
 */
function uploadEvidenceMiddleware(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({
            success: false,
            message: `File too large. Maximum allowed size is ${Math.round(getMaxFileSize() / (1024 * 1024))}MB.`
          });
        }
        if (err.code === 'LIMIT_FILE_COUNT') {
          return res.status(400).json({
            success: false,
            message: 'Too many files uploaded. Please upload only one file.'
          });
        }
        if (err.code === 'LIMIT_FIELD_COUNT') {
          return res.status(400).json({
            success: false,
            message: `Too many form fields. Maximum allowed is ${MAX_FIELDS}.`
          });
        }
        if (err.code === 'LIMIT_FIELD_VALUE') {
          return res.status(400).json({
            success: false,
            message: `Form field value too large. Maximum allowed size is ${Math.round(MAX_FIELD_SIZE_BYTES / 1024)}KB.`
          });
        }
        if (err.code === 'LIMIT_PART_COUNT') {
          return res.status(400).json({
            success: false,
            message: `Too many multipart parts. Maximum allowed is ${MAX_PARTS}.`
          });
        }
        if (err.code === 'LIMIT_UNEXPECTED_FILE') {
          return res.status(400).json({
            success: false,
            message: 'Unexpected file field. Evidence file must be provided in the "file" field.'
          });
        }
        return res.status(400).json({
          success: false,
          message: `Upload error: ${err.message}`
        });
      }
      return res.status(400).json({
        success: false,
        message: `Upload error: ${err.message}`
      });
    }
    next();
  });
}

module.exports = {
  uploadEvidenceMiddleware,
  MAX_FIELDS,
  MAX_FIELD_SIZE_BYTES,
  MAX_PARTS
};
