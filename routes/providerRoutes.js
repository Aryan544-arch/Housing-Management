const express = require('express');
const {
  createProvider,
  listProviders,
  getProvider,
  updateProvider,
  deleteProvider,
  getProviderSuggestions
} = require('../controllers/providerController');
const { authenticate, requireSocietyMember } = require('../middleware/auth');

const router = express.Router({ mergeParams: true });

// Enforce authentication and active admin membership on every provider operation
router.use(authenticate);
router.use(requireSocietyMember(['admin']));

// Provider suggestions endpoint (Admin-only)
router.get('/suggestions/:issueId', getProviderSuggestions);
router.get('/suggestions', getProviderSuggestions);

// Provider CRUD endpoints (Admin-only)
router.post('/', createProvider);
router.get('/', listProviders);
router.get('/:providerId', getProvider);
router.patch('/:providerId', updateProvider);
router.delete('/:providerId', deleteProvider);

module.exports = router;
