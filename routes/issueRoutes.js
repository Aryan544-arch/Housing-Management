const express = require('express');
const {
  createIssue,
  listIssues,
  getIssue,
  updateStatus,
  updateIssue,
  addNote
} = require('../controllers/issueController');
const { getProviderSuggestions } = require('../controllers/providerController');
const { authenticate, requireSocietyMember } = require('../middleware/auth');

const router = express.Router({ mergeParams: true });

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

// Admin-only issue provider suggestions
router.get('/:issueId/provider-suggestions', requireSocietyMember(['admin']), getProviderSuggestions);

module.exports = router;
