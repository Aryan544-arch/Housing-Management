const mongoose = require('mongoose');
const { Provider } = require('../models/Provider');
const { Issue, ISSUE_CATEGORIES } = require('../models/Issue');

const ALLOWED_PROVIDER_FIELDS = [
  'name',
  'categories',
  'description',
  'serviceArea',
  'contactPhone',
  'contactEmail',
  'contactPerson',
  'pricing',
  'priceEstimate',
  'status'
];

/**
 * Create a new service provider in the society.
 * Only accessible by society admins.
 */
async function createProvider(req, res, next) {
  try {
    const incomingFields = Object.keys(req.body);

    if (incomingFields.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No provider details provided.'
      });
    }

    // Reject unknown or unauthorized fields
    const unknownFields = incomingFields.filter((key) => !ALLOWED_PROVIDER_FIELDS.includes(key));
    if (unknownFields.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Invalid or unauthorized field(s) for provider: ${unknownFields.join(', ')}`
      });
    }

    const {
      name,
      categories,
      description,
      serviceArea,
      contactPhone,
      contactEmail,
      contactPerson,
      pricing,
      priceEstimate,
      status
    } = req.body;

    // Validate required fields
    if (!name || typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 100) {
      return res.status(400).json({
        success: false,
        message: 'Provider name is required and must be between 2 and 100 characters.'
      });
    }

    if (!Array.isArray(categories) || categories.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one valid service category is required.'
      });
    }

    const invalidCategories = categories.filter((c) => !ISSUE_CATEGORIES.includes(c));
    if (invalidCategories.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Invalid service category: ${invalidCategories.join(', ')}. Must be one of: ${ISSUE_CATEGORIES.join(', ')}`
      });
    }

    const normalizedCategories = [...new Set(categories)];

    if (!contactPhone || typeof contactPhone !== 'string' || contactPhone.trim().length < 5 || contactPhone.trim().length > 30) {
      return res.status(400).json({
        success: false,
        message: 'Contact phone is required and must be between 5 and 30 characters.'
      });
    }

    if (contactEmail !== undefined && contactEmail !== null && contactEmail !== '') {
      if (typeof contactEmail !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail.trim())) {
        return res.status(400).json({
          success: false,
          message: 'Contact email format is invalid.'
        });
      }
    }

    if (status !== undefined && !['active', 'inactive'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Status must be either active or inactive.'
      });
    }

    // Check for duplicate provider name in this society
    const existing = await Provider.findOne({
      society: req.society._id,
      name: name.trim()
    });

    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'A provider with this name already exists in this society.'
      });
    }

    // Validate and format serviceArea
    let sanitizedServiceArea = { allBlocks: true, blocks: [] };
    if (serviceArea !== undefined) {
      if (!serviceArea || typeof serviceArea !== 'object' || Array.isArray(serviceArea)) {
        return res.status(400).json({
          success: false,
          message: 'Service area must be a valid object.'
        });
      }

      const allowedServiceAreaKeys = ['allBlocks', 'blocks'];
      const unknownAreaKeys = Object.keys(serviceArea).filter((k) => !allowedServiceAreaKeys.includes(k));
      if (unknownAreaKeys.length > 0) {
        return res.status(400).json({
          success: false,
          message: `Invalid field(s) in serviceArea: ${unknownAreaKeys.join(', ')}`
        });
      }

      if (serviceArea.blocks !== undefined && !Array.isArray(serviceArea.blocks)) {
        return res.status(400).json({
          success: false,
          message: 'Service area blocks must be an array of strings.'
        });
      }

      const allBlocks = serviceArea.allBlocks !== undefined ? Boolean(serviceArea.allBlocks) : true;
      let blocks = [];
      if (Array.isArray(serviceArea.blocks)) {
        blocks = serviceArea.blocks
          .filter((b) => typeof b === 'string' && b.trim().length > 0)
          .map((b) => b.trim());
      }
      sanitizedServiceArea = { allBlocks, blocks };
    }

    // Validate and format pricing
    let sanitizedPricing = { rateType: 'quote_required', estimate: '' };
    if (pricing !== undefined) {
      if (!pricing || typeof pricing !== 'object' || Array.isArray(pricing)) {
        return res.status(400).json({
          success: false,
          message: 'Pricing must be a valid object.'
        });
      }

      const allowedPricingKeys = ['rateType', 'estimate', 'minRate', 'maxRate'];
      const unknownPricingKeys = Object.keys(pricing).filter((k) => !allowedPricingKeys.includes(k));
      if (unknownPricingKeys.length > 0) {
        return res.status(400).json({
          success: false,
          message: `Invalid field(s) in pricing: ${unknownPricingKeys.join(', ')}`
        });
      }

      if (pricing.rateType !== undefined && !['hourly', 'fixed', 'per_visit', 'quote_required'].includes(pricing.rateType)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid rate type in pricing. Must be hourly, fixed, per_visit, or quote_required.'
        });
      }

      if (pricing.minRate !== undefined && (typeof pricing.minRate !== 'number' || isNaN(pricing.minRate) || pricing.minRate < 0)) {
        return res.status(400).json({
          success: false,
          message: 'Minimum rate must be a non-negative number.'
        });
      }

      if (pricing.maxRate !== undefined && (typeof pricing.maxRate !== 'number' || isNaN(pricing.maxRate) || pricing.maxRate < 0)) {
        return res.status(400).json({
          success: false,
          message: 'Maximum rate must be a non-negative number.'
        });
      }

      const rateType = pricing.rateType || 'quote_required';
      const estimate = pricing.estimate ? String(pricing.estimate).trim().slice(0, 100) : '';
      const minRate = typeof pricing.minRate === 'number' ? pricing.minRate : undefined;
      const maxRate = typeof pricing.maxRate === 'number' ? pricing.maxRate : undefined;

      if (minRate !== undefined && maxRate !== undefined && maxRate < minRate) {
        return res.status(400).json({
          success: false,
          message: 'Maximum rate cannot be less than minimum rate.'
        });
      }

      sanitizedPricing = { rateType, estimate, minRate, maxRate };
    }

    const provider = new Provider({
      society: req.society._id,
      name: name.trim(),
      categories: normalizedCategories,
      description: description ? String(description).trim().slice(0, 1000) : '',
      serviceArea: sanitizedServiceArea,
      contactPhone: contactPhone.trim(),
      contactEmail: contactEmail ? contactEmail.trim().toLowerCase() : '',
      contactPerson: contactPerson ? String(contactPerson).trim().slice(0, 100) : '',
      pricing: sanitizedPricing,
      priceEstimate: priceEstimate ? String(priceEstimate).trim().slice(0, 100) : '',
      status: status || 'active',
      createdBy: req.user._id,
      updatedBy: req.user._id
    });

    await provider.save();

    res.status(201).json({
      success: true,
      message: 'Provider created successfully',
      provider
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'A provider with this name already exists in this society.'
      });
    }
    next(error);
  }
}

/**
 * List all providers in the society with optional filters.
 * Admin-only.
 */
async function listProviders(req, res, next) {
  try {
    const { status, category, search, limit, page } = req.query;
    const filter = { society: req.society._id };

    if (status !== undefined) {
      if (!['active', 'inactive'].includes(status)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid status filter. Must be active or inactive.'
        });
      }
      filter.status = status;
    }

    if (category !== undefined) {
      if (!ISSUE_CATEGORIES.includes(category)) {
        return res.status(400).json({
          success: false,
          message: `Invalid category filter. Must be one of: ${ISSUE_CATEGORIES.join(', ')}`
        });
      }
      filter.categories = category;
    }

    if (search !== undefined) {
      if (typeof search !== 'string') {
        return res.status(400).json({
          success: false,
          message: 'Search query must be a string.'
        });
      }
      const trimmedSearch = search.trim();
      if (trimmedSearch.length > 100) {
        return res.status(400).json({
          success: false,
          message: 'Search query cannot exceed 100 characters.'
        });
      }
      if (trimmedSearch.length > 0) {
        // Escape regex special characters to prevent ReDoS / regex injection
        const sanitized = trimmedSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        filter.name = { $regex: sanitized, $options: 'i' };
      }
    }

    // Safe pagination / Sensible result limits (default 50, maximum 100)
    const parsedLimit = parseInt(limit, 10);
    const parsedPage = parseInt(page, 10);
    const maxLimit = 100;
    const safeLimit = !isNaN(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, maxLimit) : 50;
    const safePage = !isNaN(parsedPage) && parsedPage > 0 ? parsedPage : 1;
    const skip = (safePage - 1) * safeLimit;

    const totalCount = await Provider.countDocuments(filter);
    const providers = await Provider.find(filter)
      .populate('createdBy', 'name email')
      .populate('updatedBy', 'name email')
      .sort({ name: 1 })
      .skip(skip)
      .limit(safeLimit);

    res.status(200).json({
      success: true,
      count: providers.length,
      totalCount,
      page: safePage,
      totalPages: Math.ceil(totalCount / safeLimit),
      providers
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get single provider details.
 * Admin-only.
 */
async function getProvider(req, res, next) {
  try {
    const { providerId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(providerId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid provider ID format.'
      });
    }

    const provider = await Provider.findOne({
      _id: providerId,
      society: req.society._id
    })
      .populate('createdBy', 'name email')
      .populate('updatedBy', 'name email');

    if (!provider) {
      return res.status(404).json({
        success: false,
        message: 'Provider not found in this society.'
      });
    }

    res.status(200).json({
      success: true,
      provider
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Update an existing provider record.
 * Admin-only.
 */
async function updateProvider(req, res, next) {
  try {
    const { providerId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(providerId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid provider ID format.'
      });
    }

    const incomingFields = Object.keys(req.body);
    if (incomingFields.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No update fields provided.'
      });
    }

    const unknownFields = incomingFields.filter((key) => !ALLOWED_PROVIDER_FIELDS.includes(key));
    if (unknownFields.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Invalid or unauthorized field(s) for provider: ${unknownFields.join(', ')}`
      });
    }

    const provider = await Provider.findOne({
      _id: providerId,
      society: req.society._id
    });

    if (!provider) {
      return res.status(404).json({
        success: false,
        message: 'Provider not found in this society.'
      });
    }

    const {
      name,
      categories,
      description,
      serviceArea,
      contactPhone,
      contactEmail,
      contactPerson,
      pricing,
      priceEstimate,
      status
    } = req.body;

    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 100) {
        return res.status(400).json({
          success: false,
          message: 'Provider name must be between 2 and 100 characters.'
        });
      }

      // Check name uniqueness if changed
      if (name.trim() !== provider.name) {
        const duplicate = await Provider.findOne({
          society: req.society._id,
          name: name.trim(),
          _id: { $ne: provider._id }
        });
        if (duplicate) {
          return res.status(409).json({
            success: false,
            message: 'A provider with this name already exists in this society.'
          });
        }
      }
      provider.name = name.trim();
    }

    if (categories !== undefined) {
      if (!Array.isArray(categories) || categories.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'At least one valid service category is required.'
        });
      }
      const invalidCategories = categories.filter((c) => !ISSUE_CATEGORIES.includes(c));
      if (invalidCategories.length > 0) {
        return res.status(400).json({
          success: false,
          message: `Invalid service category: ${invalidCategories.join(', ')}`
        });
      }
      provider.categories = [...new Set(categories)];
    }

    if (description !== undefined) {
      provider.description = description ? String(description).trim().slice(0, 1000) : '';
    }

    if (serviceArea !== undefined) {
      if (typeof serviceArea !== 'object' || serviceArea === null || Array.isArray(serviceArea)) {
        return res.status(400).json({
          success: false,
          message: 'Service area must be a valid object.'
        });
      }

      const allowedServiceAreaKeys = ['allBlocks', 'blocks'];
      const unknownAreaKeys = Object.keys(serviceArea).filter((k) => !allowedServiceAreaKeys.includes(k));
      if (unknownAreaKeys.length > 0) {
        return res.status(400).json({
          success: false,
          message: `Invalid field(s) in serviceArea: ${unknownAreaKeys.join(', ')}`
        });
      }

      if (serviceArea.blocks !== undefined && !Array.isArray(serviceArea.blocks)) {
        return res.status(400).json({
          success: false,
          message: 'Service area blocks must be an array of strings.'
        });
      }

      const allBlocks = serviceArea.allBlocks !== undefined ? Boolean(serviceArea.allBlocks) : provider.serviceArea.allBlocks;
      let blocks = provider.serviceArea.blocks;
      if (Array.isArray(serviceArea.blocks)) {
        blocks = serviceArea.blocks
          .filter((b) => typeof b === 'string' && b.trim().length > 0)
          .map((b) => b.trim());
      }
      provider.serviceArea = { allBlocks, blocks };
    }

    if (contactPhone !== undefined) {
      if (typeof contactPhone !== 'string' || contactPhone.trim().length < 5 || contactPhone.trim().length > 30) {
        return res.status(400).json({
          success: false,
          message: 'Contact phone must be between 5 and 30 characters.'
        });
      }
      provider.contactPhone = contactPhone.trim();
    }

    if (contactEmail !== undefined) {
      if (contactEmail && (typeof contactEmail !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail.trim()))) {
        return res.status(400).json({
          success: false,
          message: 'Contact email format is invalid.'
        });
      }
      provider.contactEmail = contactEmail ? contactEmail.trim().toLowerCase() : '';
    }

    if (contactPerson !== undefined) {
      provider.contactPerson = contactPerson ? String(contactPerson).trim().slice(0, 100) : '';
    }

    if (pricing !== undefined) {
      if (typeof pricing !== 'object' || pricing === null || Array.isArray(pricing)) {
        return res.status(400).json({
          success: false,
          message: 'Pricing must be a valid object.'
        });
      }

      const allowedPricingKeys = ['rateType', 'estimate', 'minRate', 'maxRate'];
      const unknownPricingKeys = Object.keys(pricing).filter((k) => !allowedPricingKeys.includes(k));
      if (unknownPricingKeys.length > 0) {
        return res.status(400).json({
          success: false,
          message: `Invalid field(s) in pricing: ${unknownPricingKeys.join(', ')}`
        });
      }

      if (pricing.rateType !== undefined && !['hourly', 'fixed', 'per_visit', 'quote_required'].includes(pricing.rateType)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid rate type in pricing. Must be hourly, fixed, per_visit, or quote_required.'
        });
      }

      if (pricing.minRate !== undefined && (typeof pricing.minRate !== 'number' || isNaN(pricing.minRate) || pricing.minRate < 0)) {
        return res.status(400).json({
          success: false,
          message: 'Minimum rate must be a non-negative number.'
        });
      }

      if (pricing.maxRate !== undefined && (typeof pricing.maxRate !== 'number' || isNaN(pricing.maxRate) || pricing.maxRate < 0)) {
        return res.status(400).json({
          success: false,
          message: 'Maximum rate must be a non-negative number.'
        });
      }

      const rateType = pricing.rateType !== undefined ? pricing.rateType : provider.pricing.rateType;
      const estimate = pricing.estimate !== undefined ? String(pricing.estimate).trim().slice(0, 100) : provider.pricing.estimate;
      const minRate = pricing.minRate !== undefined ? pricing.minRate : provider.pricing.minRate;
      const maxRate = pricing.maxRate !== undefined ? pricing.maxRate : provider.pricing.maxRate;

      if (minRate !== undefined && maxRate !== undefined && maxRate < minRate) {
        return res.status(400).json({
          success: false,
          message: 'Maximum rate cannot be less than minimum rate.'
        });
      }

      provider.pricing = { rateType, estimate, minRate, maxRate };
    }

    if (priceEstimate !== undefined) {
      provider.priceEstimate = priceEstimate ? String(priceEstimate).trim().slice(0, 100) : '';
    }

    if (status !== undefined) {
      if (!['active', 'inactive'].includes(status)) {
        return res.status(400).json({
          success: false,
          message: 'Status must be either active or inactive.'
        });
      }
      provider.status = status;
    }

    provider.updatedBy = req.user._id;
    await provider.save();

    res.status(200).json({
      success: true,
      message: 'Provider updated successfully',
      provider
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'A provider with this name already exists in this society.'
      });
    }
    if (error.name === 'VersionError') {
      return res.status(409).json({
        success: false,
        message: 'Conflict: This provider record was modified by another request. Please reload and try again.'
      });
    }
    next(error);
  }
}

/**
 * Deactivate or delete a provider.
 * Follows principle: prefer deactivation over permanent deletion when referenced by issues.
 * Admin-only.
 */
async function deleteProvider(req, res, next) {
  try {
    const { providerId } = req.params;
    const { permanent } = req.query;

    if (!mongoose.Types.ObjectId.isValid(providerId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid provider ID format.'
      });
    }

    const provider = await Provider.findOne({
      _id: providerId,
      society: req.society._id
    });

    if (!provider) {
      return res.status(404).json({
        success: false,
        message: 'Provider not found in this society.'
      });
    }

    // Check if referenced by any issues in this society (case-insensitive name or contact phone)
    const escapedName = provider.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const isReferenced = await Issue.findOne({
      society: req.society._id,
      $or: [
        { 'externalProviderDetails.companyOrName': { $regex: `^${escapedName}$`, $options: 'i' } },
        ...(provider.contactPhone ? [{ 'externalProviderDetails.contactPhone': provider.contactPhone }] : [])
      ]
    });

    // If permanent deletion is requested and not referenced, remove completely
    if (permanent === 'true' && !isReferenced) {
      await Provider.deleteOne({ _id: provider._id });
      return res.status(200).json({
        success: true,
        message: 'Provider permanently deleted successfully',
        deleted: true
      });
    }

    // Otherwise, deactivate provider to preserve audit integrity
    provider.status = 'inactive';
    provider.updatedBy = req.user._id;
    await provider.save();

    res.status(200).json({
      success: true,
      message: isReferenced
        ? 'Provider is referenced by society issues and was deactivated rather than deleted.'
        : 'Provider deactivated successfully.',
      deactivated: true,
      provider
    });
  } catch (error) {
    if (error.name === 'VersionError') {
      return res.status(409).json({
        success: false,
        message: 'Conflict: This provider record was modified by another request. Please reload and try again.'
      });
    }
    next(error);
  }
}

/**
 * Retrieve private provider suggestions for an issue.
 * Admin-only.
 */
async function getProviderSuggestions(req, res, next) {
  try {
    const issueId = req.params.issueId || req.query.issueId;

    if (!issueId || !mongoose.Types.ObjectId.isValid(issueId)) {
      return res.status(400).json({
        success: false,
        message: 'A valid issue identifier is required for provider suggestions.'
      });
    }

    // Verify issue belongs to requested society
    const issue = await Issue.findOne({
      _id: issueId,
      society: req.society._id
    });

    if (!issue) {
      return res.status(404).json({
        success: false,
        message: 'Issue not found in this society.'
      });
    }

    if (!issue.category || !ISSUE_CATEGORIES.includes(issue.category)) {
      return res.status(400).json({
        success: false,
        message: 'Issue has an invalid or missing category.'
      });
    }

    // Find active providers in this society that cover the issue category (limit to 100 for safety)
    const candidateProviders = await Provider.find({
      society: req.society._id,
      status: 'active',
      categories: issue.category
    })
      .sort({ name: 1 })
      .limit(100);

    const suggestions = [];

    for (const provider of candidateProviders) {
      let locationMatched = false;
      let compatibilityReason = '';

      if (!issue.location || typeof issue.location !== 'object') {
        // Missing or malformed location details: fail safely, do NOT broaden results
        locationMatched = false;
        compatibilityReason = 'Issue has missing or malformed location details.';
      } else if (issue.location.type === 'unit') {
        const issueBlock = (issue.location.blockOrWing || '').trim().toLowerCase();

        if (!issueBlock) {
          // Unit issue without a block/wing specified
          if (!provider.serviceArea || provider.serviceArea.allBlocks) {
            locationMatched = true;
            compatibilityReason = 'Provider covers all blocks; issue unit block/wing is unspecified.';
          } else {
            locationMatched = false;
            compatibilityReason = 'Provider is restricted to specific blocks, but issue unit block/wing is unspecified.';
          }
        } else {
          if (!provider.serviceArea || provider.serviceArea.allBlocks) {
            locationMatched = true;
            compatibilityReason = 'Provider covers all blocks in the society.';
          } else if (
            Array.isArray(provider.serviceArea.blocks) &&
            provider.serviceArea.blocks.some((b) => typeof b === 'string' && b.trim().toLowerCase() === issueBlock)
          ) {
            locationMatched = true;
            compatibilityReason = `Provider explicitly supports ${issue.location.blockOrWing}.`;
          } else {
            locationMatched = false;
            compatibilityReason = `Provider does not support block ${issue.location.blockOrWing}.`;
          }
        }
      } else if (issue.location.type === 'common_area') {
        const commonBlock = (issue.location.blockOrWing || '').trim().toLowerCase();

        if (!provider.serviceArea || provider.serviceArea.allBlocks) {
          locationMatched = true;
          compatibilityReason = 'Provider covers all blocks and society common areas.';
        } else if (
          commonBlock &&
          Array.isArray(provider.serviceArea.blocks) &&
          provider.serviceArea.blocks.some((b) => typeof b === 'string' && b.trim().toLowerCase() === commonBlock)
        ) {
          locationMatched = true;
          compatibilityReason = `Provider explicitly supports common areas in ${issue.location.blockOrWing}.`;
        } else {
          locationMatched = false;
          compatibilityReason = 'Provider is restricted to specific blocks and does not cover general common areas.';
        }
      } else {
        // Unknown or unsupported location type: fail safely
        locationMatched = false;
        compatibilityReason = 'Unknown or unsupported issue location type.';
      }

      if (locationMatched) {
        suggestions.push({
          provider,
          matchDetails: {
            categoryMatched: true,
            matchedCategory: issue.category,
            locationMatched: true,
            compatibilityReason
          },
          // Explicitly differentiate category/location match from verified vetting or official recommendation
          recommendationLevel: 'criteria_match',
          disclaimer: 'This suggestion is based solely on category and location criteria. It does not constitute an endorsement, qualification check, or availability guarantee.'
        });
      }
    }

    res.status(200).json({
      success: true,
      issueId: issue._id,
      issueCategory: issue.category,
      issueLocation: issue.location,
      count: suggestions.length,
      suggestions
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  createProvider,
  listProviders,
  getProvider,
  updateProvider,
  deleteProvider,
  getProviderSuggestions
};
