const express = require('express');
const {
  createSociety,
  getSociety,
  addMember,
  listMembers,
  getProtectedSocietyData,
  executeAdminAction
} = require('../controllers/societyController');
const { authenticate, requireSocietyMember } = require('../middleware/auth');

const router = express.Router();

// Society creation requires authenticated user
router.post('/', authenticate, createSociety);

// Member-scoped endpoints (accessible by any active resident or admin in that society)
router.get('/:societyId', authenticate, requireSocietyMember(), getSociety);
router.get('/:societyId/members', authenticate, requireSocietyMember(), listMembers);
router.get('/:societyId/protected-data', authenticate, requireSocietyMember(), getProtectedSocietyData);

// Admin-scoped endpoints (accessible only by active admin in that society)
router.post('/:societyId/members', authenticate, requireSocietyMember(['admin']), addMember);
router.post('/:societyId/admin-action', authenticate, requireSocietyMember(['admin']), executeAdminAction);

// Mount issue management sub-router
const issueRoutes = require('./issueRoutes');
router.use('/:societyId/issues', issueRoutes);

// Mount provider management sub-router
const providerRoutes = require('./providerRoutes');
router.use('/:societyId/providers', providerRoutes);

module.exports = router;
