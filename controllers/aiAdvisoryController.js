const mongoose = require('mongoose');
const { Issue } = require('../models/Issue');
const aiAdvisoryService = require('../services/ai/aiAdvisoryService');

/**
 * Generate advisory analysis for an issue using the configured AI service.
 * Enforces authentication, society scoping, resident privacy rules, and untrusted output validation.
 * Strictly read-only: does not modify issue data, status, costs, or audit history.
 */
async function getIssueAdvisory(req, res, next) {
  try {
    const { issueId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(issueId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid issue ID format.'
      });
    }

    // Scoped retrieval within user's active society
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

    const isResident = req.membership.role === 'resident';
    const isSubmitter = issue.submittingResident
      ? (issue.submittingResident._id
          ? issue.submittingResident._id.equals(req.user._id)
          : issue.submittingResident.equals(req.user._id))
      : false;
    const isCommonArea = issue.location && issue.location.type === 'common_area';

    // Privacy check: Residents cannot analyze another resident's private unit issue
    // Uniformly return 404 to avoid private issue ID enumeration
    if (isResident && !isSubmitter && !isCommonArea) {
      return res.status(404).json({
        success: false,
        message: 'Issue not found in this society.'
      });
    }

    const result = await aiAdvisoryService.analyzeIssue(issue);

    if (!result.success) {
      return res.status(result.statusCode || 503).json({
        success: false,
        message: result.error || 'Failed to generate AI advisory.'
      });
    }

    res.status(200).json({
      success: true,
      issueId: issue._id,
      advisory: result.advisory
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getIssueAdvisory
};
