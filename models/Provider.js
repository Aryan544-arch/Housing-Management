const mongoose = require('mongoose');
const { ISSUE_CATEGORIES } = require('./Issue');

const providerPricingSchema = new mongoose.Schema(
  {
    estimate: {
      type: String,
      trim: true,
      maxlength: [100, 'Price estimate cannot exceed 100 characters'],
      default: ''
    },
    minRate: {
      type: Number,
      min: [0, 'Minimum rate cannot be negative']
    },
    maxRate: {
      type: Number,
      min: [0, 'Maximum rate cannot be negative']
    },
    rateType: {
      type: String,
      enum: {
        values: ['hourly', 'fixed', 'per_visit', 'quote_required'],
        message: 'Invalid rate type'
      },
      default: 'quote_required'
    }
  },
  { _id: false }
);

const serviceAreaSchema = new mongoose.Schema(
  {
    allBlocks: {
      type: Boolean,
      default: true
    },
    blocks: [
      {
        type: String,
        trim: true
      }
    ]
  },
  { _id: false }
);

const providerSchema = new mongoose.Schema(
  {
    society: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Society',
      required: [true, 'Society reference is required'],
      index: true
    },
    name: {
      type: String,
      required: [true, 'Provider name is required'],
      trim: true,
      minlength: [2, 'Name must be at least 2 characters long'],
      maxlength: [100, 'Name cannot exceed 100 characters']
    },
    categories: {
      type: [
        {
          type: String,
          enum: {
            values: ISSUE_CATEGORIES,
            message: 'Invalid service category'
          }
        }
      ],
      validate: {
        validator(val) {
          return Array.isArray(val) && val.length > 0;
        },
        message: 'At least one service category is required'
      },
      index: true
    },
    description: {
      type: String,
      trim: true,
      maxlength: [1000, 'Description cannot exceed 1000 characters'],
      default: ''
    },
    serviceArea: {
      type: serviceAreaSchema,
      default: () => ({ allBlocks: true, blocks: [] })
    },
    contactPhone: {
      type: String,
      required: [true, 'Contact phone is required'],
      trim: true,
      minlength: [5, 'Contact phone must be at least 5 characters'],
      maxlength: [30, 'Contact phone cannot exceed 30 characters']
    },
    contactEmail: {
      type: String,
      trim: true,
      lowercase: true,
      default: '',
      maxlength: [100, 'Contact email cannot exceed 100 characters'],
      validate: {
        validator(v) {
          if (!v) return true;
          return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
        },
        message: 'Invalid contact email format'
      }
    },
    contactPerson: {
      type: String,
      trim: true,
      default: '',
      maxlength: [100, 'Contact person cannot exceed 100 characters']
    },
    pricing: {
      type: providerPricingSchema,
      default: () => ({ rateType: 'quote_required', estimate: '' })
    },
    priceEstimate: {
      type: String,
      trim: true,
      default: '',
      maxlength: [100, 'Price estimate cannot exceed 100 characters']
    },
    status: {
      type: String,
      enum: {
        values: ['active', 'inactive'],
        message: 'Status must be active or inactive'
      },
      default: 'active',
      index: true
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    }
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

// Enforce unique provider name per society
providerSchema.index({ society: 1, name: 1 }, { unique: true });
// Compound index for category and status filtering
providerSchema.index({ society: 1, status: 1, categories: 1 });

const Provider = mongoose.model('Provider', providerSchema);

module.exports = {
  Provider,
  ISSUE_CATEGORIES
};
