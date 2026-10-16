const express = require('express');
const {
  createIssue,
  listIssues,
  getIssue,
  updateStatus,
  updateIssue,
  addNote,
  recordProgress
} = require('../controllers/issueController');
const {
  uploadEvidence,
  downloadEvidence
} = require('../controllers/evidenceController');
const { uploadEvidenceMiddleware } = require('../middleware/upload');
const rateLimit = require('express-rate-limit');
const { getProviderSuggestions } = require('../controllers/providerController');
const { getIssueAdvisory } = require('../controllers/aiAdvisoryController');
const { authenticate, requireSocietyMember } = require('../middleware/auth');

const router = express.Router({ mergeParams: true });

// Dedicated rate limiter for AI advisory inference (max 30 requests per 15 minutes per IP)
const aiAdvisoryLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many AI advisory requests, please try again later.'
  }
});

// Enforce authentication and active society membership on all issue operations
router.use(authenticate);
router.use(requireSocietyMember());

// Society-scoped issue endpoints
router.post('/', createIssue);
router.get('/', listIssues);
router.get('/:issueId', getIssue);
router.patch('/:issueId/status', updateStatus);
router.patch('/:issueId', updateIssue);
router.post('/:issueId/notes', addNote);

// Secure private evidence upload and download
router.post('/:issueId/evidence', uploadEvidenceMiddleware, uploadEvidence);
router.get('/:issueId/evidence/:evidenceId', downloadEvidence);

// Admin-only repair progress recording
router.post('/:issueId/progress', requireSocietyMember(['admin']), recordProgress);

// Admin-only issue provider suggestions
router.get('/:issueId/provider-suggestions', requireSocietyMember(['admin']), getProviderSuggestions);

// AI Advisory endpoints (member-scoped with resident privacy filtering) - Strictly POST only
router.post('/:issueId/ai-advisory', aiAdvisoryLimiter, getIssueAdvisory);
router.post('/:issueId/analyze', aiAdvisoryLimiter, getIssueAdvisory);

module.exports = router;
