const mongoose = require('mongoose');

const societyMembershipSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User reference is required'],
      index: true
    },
    society: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Society',
      required: [true, 'Society reference is required'],
      index: true
    },
    role: {
      type: String,
      enum: {
        values: ['resident', 'admin'],
        message: 'Role must be either resident or admin'
      },
      default: 'resident',
      required: true
    },
    flatNumber: {
      type: String,
      trim: true,
      default: ''
    },
    status: {
      type: String,
      enum: {
        values: ['active', 'pending', 'inactive'],
        message: 'Status must be active, pending, or inactive'
      },
      default: 'active',
      required: true
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

// Enforce unique membership per user per society
societyMembershipSchema.index({ user: 1, society: 1 }, { unique: true });

const SocietyMembership = mongoose.model('SocietyMembership', societyMembershipSchema);

module.exports = SocietyMembership;
