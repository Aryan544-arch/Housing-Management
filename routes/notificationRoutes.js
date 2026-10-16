const express = require('express');
const router = express.Router({ mergeParams: true });
const notificationController = require('../controllers/notificationController');

// All notification routes inherit authentication and society membership checks from societyRoutes

// GET /api/societies/:societyId/notifications — List notifications with pagination
router.get('/', notificationController.listNotifications);

// POST /api/societies/:societyId/notifications/read-all — Mark all notifications as read
router.post('/read-all', notificationController.markAllAsRead);

// PATCH /api/societies/:societyId/notifications/:notificationId/read — Mark single notification as read
router.patch('/:notificationId/read', notificationController.markAsRead);

module.exports = router;
