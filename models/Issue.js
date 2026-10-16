const mongoose = require('mongoose');

const ISSUE_STATUSES = [
  'submitted',
  'under_review',
  'awaiting_information',
  'provider_contact_pending',
  'scheduled',
  'in_progress',
  'completion_submitted',
  'verification_rejected',
  'verified_closed',
  'reopened',
  'cancelled'
];

const ISSUE_PRIORITIES = ['low', 'normal', 'high', 'urgent'];

const ISSUE_CATEGORIES = [
  'plumbing',
  'electrical',
  'carpentry',
  'security',
  'housekeeping',
  'elevator',
  'common_area',
  'structural',
  'other'
];

const issueEventSchema = new mongoose.Schema(
  {
    action: {
      type: String,
      enum: ['created', 'status_change', 'priority_change', 'details_updated', 'note_added', 'progress_recorded'],
      required: true
    },
    fromStatus: {
      type: String,
      enum: ISSUE_STATUSES
    },
    toStatus: {
      type: String,
      enum: ISSUE_STATUSES
    },
    changedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    note: {
      type: String,
      trim: true,
      default: ''
    },
    isInternal: {
      type: Boolean,
      default: false
    },
    changedAt: {
      type: Date,
      default: Date.now,
      required: true
    }
  },
  { _id: true }
);

const repairCostSchema = new mongoose.Schema(
  {
    materialCost: {
      type: Number,
      min: [0, 'Material cost cannot be negative'],
      default: 0
    },
    laborCost: {
      type: Number,
      min: [0, 'Labor cost cannot be negative'],
      default: 0
    },
    otherCost: {
      type: Number,
      min: [0, 'Other cost cannot be negative'],
      default: 0
    },
    totalCost: {
      type: Number,
      min: [0, 'Total cost cannot be negative'],
      default: 0
    },
    currency: {
      type: String,
      trim: true,
      maxlength: [10, 'Currency cannot exceed 10 characters'],
      default: 'INR'
    }
  },
  { _id: false }
);

const evidenceItemSchema = new mongoose.Schema(
  {
    caption: {
      type: String,
      trim: true,
      maxlength: [200, 'Caption cannot exceed 200 characters'],
      default: ''
    },
    referenceUrl: {
      type: String,
      trim: true,
      maxlength: [500, 'Reference URL cannot exceed 500 characters'],
      default: ''
    },
    originalFilename: {
      type: String,
      trim: true,
      maxlength: [255, 'Filename cannot exceed 255 characters'],
      default: ''
    },
    storedFilename: {
      type: String,
      trim: true,
      maxlength: [255, 'Stored filename cannot exceed 255 characters'],
      default: ''
    },
    mimeType: {
      type: String,
      trim: true,
      maxlength: [100, 'MIME type cannot exceed 100 characters'],
      default: ''
    },
    sizeBytes: {
      type: Number,
      min: [0, 'File size cannot be negative'],
      default: 0
    },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    isInternal: {
      type: Boolean,
      default: false
    },
    uploadedAt: {
      type: Date,
      default: Date.now
    }
  },
  { _id: true }
);

const completionDetailsSchema = new mongoose.Schema(
  {
    workSummary: {
      type: String,
      trim: true,
      maxlength: [2000, 'Work summary cannot exceed 2000 characters'],
      default: ''
    },
    completedAt: {
      type: Date
    },
    completedBy: {
      type: String,
      trim: true,
      maxlength: [100, 'Completed by cannot exceed 100 characters'],
      default: ''
    },
    evidence: [evidenceItemSchema]
  },
  { _id: false }
);

const verificationDetailsSchema = new mongoose.Schema(
  {
    verifiedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    verifiedAt: {
      type: Date
    },
    decision: {
      type: String,
      enum: ['verified_closed', 'verification_rejected']
    },
    notes: {
      type: String,
      trim: true,
      maxlength: [1000, 'Verification notes cannot exceed 1000 characters'],
      default: ''
    }
  },
  { _id: false }
);

const issueSchema = new mongoose.Schema(
  {
    society: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Society',
      required: [true, 'Society reference is required'],
      index: true
    },
    submittingResident: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Submitting resident is required'],
      index: true
    },
    title: {
      type: String,
      required: [true, 'Title is required'],
      trim: true,
      minlength: [5, 'Title must be at least 5 characters long'],
      maxlength: [120, 'Title cannot exceed 120 characters']
    },
    description: {
      type: String,
      required: [true, 'Description is required'],
      trim: true,
      minlength: [10, 'Description must be at least 10 characters long'],
      maxlength: [2000, 'Description cannot exceed 2000 characters']
    },
    category: {
      type: String,
      enum: {
        values: ISSUE_CATEGORIES,
        message: 'Invalid issue category'
      },
      required: [true, 'Category is required']
    },
    location: {
      type: {
        type: String,
        enum: {
          values: ['unit', 'common_area'],
          message: 'Location type must be either unit or common_area'
        },
        required: [true, 'Location type is required']
      },
      blockOrWing: {
        type: String,
        trim: true,
        default: ''
      },
      flatOrUnit: {
        type: String,
        trim: true,
        default: ''
      },
      areaDescription: {
        type: String,
        trim: true,
        default: ''
      }
    },
    priority: {
      type: String,
      enum: {
        values: ISSUE_PRIORITIES,
        message: 'Priority must be low, normal, high, or urgent'
      },
      default: 'normal',
      index: true
    },
    status: {
      type: String,
      enum: {
        values: ISSUE_STATUSES,
        message: 'Invalid issue status'
      },
      default: 'submitted',
      index: true
    },
    scheduledDate: {
      type: Date
    },
    externalProviderDetails: {
      companyOrName: { type: String, trim: true, default: '' },
      contactPhone: { type: String, trim: true, default: '' },
      trade: { type: String, trim: true, default: '' }
    },
    resolutionSummary: {
      type: String,
      trim: true,
      default: ''
    },
    cancellationReason: {
      type: String,
      trim: true,
      default: ''
    },
    costs: {
      type: repairCostSchema
    },
    completionDetails: {
      type: completionDetailsSchema
    },
    verificationDetails: {
      type: verificationDetailsSchema
    },
    evidence: [evidenceItemSchema],
    history: [issueEventSchema]
  },
  {
    timestamps: true,
    optimisticConcurrency: true,
    toJSON: {
      transform(doc, ret) {
        delete ret.__v;
        return ret;
      }
    }
  }
);

// Location validation hook
issueSchema.pre('validate', function () {
  if (this.location && this.location.type === 'unit') {
    if (!this.location.blockOrWing || this.location.blockOrWing.trim().length === 0) {
      this.invalidate('location.blockOrWing', 'Block or wing is required for unit issues');
    }
    if (!this.location.flatOrUnit || this.location.flatOrUnit.trim().length === 0) {
      this.invalidate('location.flatOrUnit', 'Flat or unit number is required for unit issues');
    }
  } else if (this.location && this.location.type === 'common_area') {
    if (!this.location.areaDescription || this.location.areaDescription.trim().length < 2) {
      this.invalidate('location.areaDescription', 'Area description is required for common area issues');
    }
  }
});

// Indexes for high-performance scoped querying
issueSchema.index({ society: 1, status: 1 });
issueSchema.index({ society: 1, submittingResident: 1 });
issueSchema.index({ society: 1, priority: 1, createdAt: -1 });

/**
 * Format issue document safely based on requester role and identity.
 * Redacts external provider details and internal notes for residents.
 *
 * @param {string} role - 'admin' or 'resident'
 * @param {string} requesterUserId - ID of user making request
 * @returns {object}
 */
issueSchema.methods.toClientJSON = function (role, requesterUserId) {
  const obj = this.toObject();

  if (role !== 'admin') {
    // Redact provider data and repair costs from residents
    delete obj.externalProviderDetails;
    delete obj.costs;

    // Filter out internal evidence metadata from completion details
    if (obj.completionDetails && Array.isArray(obj.completionDetails.evidence)) {
      obj.completionDetails.evidence = obj.completionDetails.evidence.filter((e) => !e.isInternal);
    }

    // Filter out internal evidence metadata from root issue evidence
    if (Array.isArray(obj.evidence)) {
      obj.evidence = obj.evidence.filter((e) => !e.isInternal);
    }

    // Redact admin contact details from verification details if populated
    if (obj.verificationDetails && obj.verificationDetails.verifiedBy && typeof obj.verificationDetails.verifiedBy === 'object') {
      delete obj.verificationDetails.verifiedBy.email;
      delete obj.verificationDetails.verifiedBy.phone;
    }

    // Filter out internal notes from history and redact other users' contact info
    if (Array.isArray(obj.history)) {
      obj.history = obj.history
        .filter((event) => !event.isInternal)
        .map((event) => {
          if (event.changedBy && typeof event.changedBy === 'object') {
            const isEventActor = requesterUserId && (
              (event.changedBy._id && event.changedBy._id.toString() === requesterUserId.toString()) ||
              event.changedBy.toString() === requesterUserId.toString()
            );
            if (!isEventActor) {
              delete event.changedBy.email;
              delete event.changedBy.phone;
            }
          }
          return event;
        });
    }

    // Safely determine whether the requester is the submitting resident
    const isSubmitter = requesterUserId && obj.submittingResident && (
      (obj.submittingResident._id && obj.submittingResident._id.toString() === requesterUserId.toString()) ||
      obj.submittingResident.toString() === requesterUserId.toString()
    );

    // If viewing another resident's common_area issue (or missing submitter), redact contact details
    if (!isSubmitter && obj.location && obj.location.type === 'common_area') {
      if (obj.submittingResident && typeof obj.submittingResident === 'object') {
        delete obj.submittingResident.phone;
        delete obj.submittingResident.email;
      }
    }
  }

  // Ensure internal disk storage filenames are never leaked to clients
  const sanitizeEvidenceList = (list) => {
    if (!Array.isArray(list)) return;
    for (const item of list) {
      if (item && typeof item === 'object') {
        delete item.storedFilename;
      }
    }
  };
  if (obj.completionDetails && Array.isArray(obj.completionDetails.evidence)) {
    sanitizeEvidenceList(obj.completionDetails.evidence);
  }
  if (Array.isArray(obj.evidence)) {
    sanitizeEvidenceList(obj.evidence);
  }

  delete obj.__v;
  return obj;
};

const Issue = mongoose.model('Issue', issueSchema);

module.exports = {
  Issue,
  ISSUE_STATUSES,
  ISSUE_PRIORITIES,
  ISSUE_CATEGORIES
};
