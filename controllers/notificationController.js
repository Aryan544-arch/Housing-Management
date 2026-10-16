const mongoose = require('mongoose');
const { Notification } = require('../models/Notification');

/**
 * List notifications for the authenticated user within the current society.
 * Enforces strict recipient ownership and society boundary isolation.
 */
async function listNotifications(req, res, next) {
  try {
    const filter = {
      recipient: req.user._id,
      society: req.society._id
    };

    // Filter by read status if provided
    if (req.query.read !== undefined) {
      if (req.query.read === 'true') {
        filter.read = true;
      } else if (req.query.read === 'false') {
        filter.read = false;
      } else {
        return res.status(400).json({
          success: false,
          message: 'Query parameter "read" must be either "true" or "false"'
        });
      }
    }

    // Pagination validation
    let page = 1;
    if (req.query.page !== undefined) {
      page = parseInt(req.query.page, 10);
      if (!Number.isInteger(page) || page < 1) {
        return res.status(400).json({
          success: false,
          message: 'Page parameter must be a positive integer greater than or equal to 1'
        });
      }
    }

    let limit = 20;
    if (req.query.limit !== undefined) {
      limit = parseInt(req.query.limit, 10);
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
        return res.status(400).json({
          success: false,
          message: 'Limit parameter must be an integer between 1 and 50'
        });
      }
    }

    const skip = (page - 1) * limit;

    const [total, unreadCount, notifications] = await Promise.all([
      Notification.countDocuments(filter),
      Notification.countDocuments({
        recipient: req.user._id,
        society: req.society._id,
        read: false
      }),
      Notification.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
    ]);

    const totalPages = Math.ceil(total / limit) || 1;

    res.status(200).json({
      success: true,
      notifications,
      unreadCount,
      pagination: {
        total,
        page,
        limit,
        totalPages
      }
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Mark a single notification as read.
 * Enforces recipient ownership and society isolation (returns 404 if owned by another user or society).
 */
async function markAsRead(req, res, next) {
  try {
    const { notificationId } = req.params;

    if (!mongoose.isValidObjectId(notificationId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid notification ID format'
      });
    }

    const notification = await Notification.findOne({
      _id: notificationId,
      recipient: req.user._id,
      society: req.society._id
    });

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }

    if (!notification.read) {
      notification.read = true;
      notification.readAt = new Date();
      await notification.save();
    }

    res.status(200).json({
      success: true,
      message: 'Notification marked as read',
      notification
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Mark all unread notifications for the user in the society as read.
 */
async function markAllAsRead(req, res, next) {
  try {
    const result = await Notification.updateMany(
      {
        recipient: req.user._id,
        society: req.society._id,
        read: false
      },
      {
        $set: {
          read: true,
          readAt: new Date()
        }
      }
    );

    res.status(200).json({
      success: true,
      message: 'All notifications marked as read',
      updatedCount: result.modifiedCount
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  listNotifications,
  markAsRead,
  markAllAsRead
};
