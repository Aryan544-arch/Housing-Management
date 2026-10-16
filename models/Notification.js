const mongoose = require('mongoose');

const NOTIFICATION_TYPES = [
  'issue_created',
  'status_changed',
  'repair_scheduled',
  'progress_recorded',
  'completion_submitted',
  'verification_rejected',
  'verified_closed',
  'reopened',
  'cancelled',
  'note_added',
  'details_updated'
];

const notificationSchema = new mongoose.Schema(
  {
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Recipient reference is required'],
      index: true
    },
    society: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Society',
      required: [true, 'Society reference is required'],
      index: true
    },
    issue: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Issue',
      required: [true, 'Issue reference is required'],
      index: true
    },
    type: {
      type: String,
      enum: {
        values: NOTIFICATION_TYPES,
        message: '{VALUE} is not a valid notification type'
      },
      required: [true, 'Notification type is required']
    },
    title: {
      type: String,
      required: [true, 'Notification title is required'],
      trim: true,
      maxlength: [200, 'Title cannot exceed 200 characters']
    },
    message: {
      type: String,
      required: [true, 'Notification message is required'],
      trim: true,
      maxlength: [1000, 'Message cannot exceed 1000 characters']
    },
    read: {
      type: Boolean,
      default: false,
      index: true
    },
    readAt: {
      type: Date,
      default: null
    },
    idempotencyKey: {
      type: String,
      required: [true, 'Idempotency key is required'],
      trim: true
    },
    emailStatus: {
      type: String,
      enum: ['disabled', 'pending', 'sent', 'failed', 'not_applicable'],
      default: 'disabled'
    },
    emailError: {
      type: String,
      trim: true,
      default: null
    },
    emailSentAt: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: true,
    toJSON: {
      transform(doc, ret) {
        delete ret.__v;
        return ret;
      }
    }
  }
);

// Compound unique index for strict deduplication per recipient
notificationSchema.index({ recipient: 1, idempotencyKey: 1 }, { unique: true });

// Compound index for society-scoped listing and pagination queries
notificationSchema.index({ society: 1, recipient: 1, read: 1, createdAt: -1 });

const Notification = mongoose.model('Notification', notificationSchema);

module.exports = {
  Notification,
  NOTIFICATION_TYPES
};
