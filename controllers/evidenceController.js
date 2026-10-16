const fs = require('fs');
const mongoose = require('mongoose');
const { Issue } = require('../models/Issue');
const {
  saveEvidenceFile,
  deleteEvidenceFile,
  getEvidenceFilePath
} = require('../services/evidence/evidenceStorageService');

/**
 * Upload an evidence file to an issue.
 * Supports root issue evidence and repair completion evidence.
 * Enforces role authorization, resident privacy, file validation,
 * and optimistic concurrency rollback cleanup.
 */
async function uploadEvidence(req, res, next) {
  let newlyStoredFilename = null;

  try {
    const { issueId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(issueId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid issue ID format.'
      });
    }

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

    const isAdmin = req.membership.role === 'admin';
    const context = (req.body.context || 'issue').trim().toLowerCase();

    // Context validation
    if (context !== 'issue' && context !== 'repair_completion') {
      return res.status(400).json({
        success: false,
        message: 'Invalid evidence context. Allowed: "issue", "repair_completion".'
      });
    }

    // Repair completion evidence is strictly restricted to admins
    if (context === 'repair_completion' && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Access denied: Only administrators may attach repair completion evidence.'
      });
    }

    // Residents cannot set isInternal: true
    const isInternalClaim = req.body.isInternal === true || req.body.isInternal === 'true';
    if (!isAdmin && isInternalClaim) {
      return res.status(403).json({
        success: false,
        message: 'Access denied: Residents cannot create or upload internal evidence.'
      });
    }

    // Resident unit issue access control
    if (!isAdmin && issue.location && issue.location.type === 'unit') {
      const isSubmitter = issue.submittingResident && (
        issue.submittingResident._id
          ? issue.submittingResident._id.equals(req.user._id)
          : issue.submittingResident.equals(req.user._id)
      );
      if (!isSubmitter) {
        return res.status(404).json({
          success: false,
          message: 'Issue not found in this society.'
        });
      }
    }

    // Terminal and closed state guards
    if (issue.status === 'cancelled') {
      return res.status(400).json({
        success: false,
        message: 'Cannot add evidence to a cancelled issue.'
      });
    }

    if (issue.status === 'verified_closed' && !isAdmin) {
      return res.status(400).json({
        success: false,
        message: 'Cannot add evidence to a closed issue. Reopen the issue to add evidence.'
      });
    }

    // File presence check
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded. Please attach an evidence file in the "file" field.'
      });
    }

    // Validate and save file to private disk storage
    let savedFile;
    try {
      savedFile = await saveEvidenceFile({
        buffer: req.file.buffer,
        originalname: req.file.originalname,
        mimetype: req.file.mimetype
      });
      newlyStoredFilename = savedFile.storedFilename;
    } catch (validationError) {
      return res.status(400).json({
        success: false,
        message: validationError.message
      });
    }

    // Create evidence subdocument
    const evidenceId = new mongoose.Types.ObjectId();
    const evidenceItem = {
      _id: evidenceId,
      caption: req.body.caption ? String(req.body.caption).trim().slice(0, 200) : '',
      referenceUrl: `/api/societies/${req.society._id}/issues/${issue._id}/evidence/${evidenceId}`,
      originalFilename: savedFile.originalFilename,
      storedFilename: savedFile.storedFilename,
      mimeType: savedFile.mimeType,
      sizeBytes: savedFile.sizeBytes,
      uploadedBy: req.user._id,
      isInternal: isAdmin && isInternalClaim,
      uploadedAt: new Date()
    };

    // Attach to requested context
    if (context === 'repair_completion') {
      if (!issue.completionDetails) {
        issue.completionDetails = { workSummary: '', evidence: [] };
      }
      if (!Array.isArray(issue.completionDetails.evidence)) {
        issue.completionDetails.evidence = [];
      }
      issue.completionDetails.evidence.push(evidenceItem);
    } else {
      if (!Array.isArray(issue.evidence)) {
        issue.evidence = [];
      }
      issue.evidence.push(evidenceItem);
    }

    // Append server-controlled audit event
    issue.history.push({
      action: 'details_updated',
      changedBy: req.user._id,
      note: `Evidence uploaded (${context}): ${savedFile.originalFilename}`,
      isInternal: evidenceItem.isInternal,
      changedAt: new Date()
    });

    // Save issue with OCC conflict handling and file rollback
    try {
      await issue.save();
    } catch (saveError) {
      // Clean up newly written file immediately on save failure
      if (newlyStoredFilename) {
        await deleteEvidenceFile(newlyStoredFilename);
      }
      if (saveError.name === 'VersionError') {
        return res.status(409).json({
          success: false,
          message: 'Conflict: This issue was modified by another request. Please reload and try again.'
        });
      }
      throw saveError;
    }

    res.status(201).json({
      success: true,
      message: 'Evidence uploaded successfully',
      evidence: {
        _id: evidenceItem._id,
        caption: evidenceItem.caption,
        referenceUrl: evidenceItem.referenceUrl,
        originalFilename: evidenceItem.originalFilename,
        mimeType: evidenceItem.mimeType,
        sizeBytes: evidenceItem.sizeBytes,
        isInternal: evidenceItem.isInternal,
        uploadedAt: evidenceItem.uploadedAt,
        uploadedBy: req.user._id
      },
      issue: issue.toClientJSON(req.membership.role, req.user._id)
    });
  } catch (error) {
    if (newlyStoredFilename) {
      await deleteEvidenceFile(newlyStoredFilename);
    }
    next(error);
  }
}

/**
 * Securely stream a private evidence file.
 * Enforces authentication, society membership, unit/common-area privacy,
 * internal evidence redaction, and defensive HTTP security headers.
 */
async function downloadEvidence(req, res, next) {
  try {
    const { issueId, evidenceId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(issueId) || !mongoose.Types.ObjectId.isValid(evidenceId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid issue or evidence ID format.'
      });
    }

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

    const isAdmin = req.membership.role === 'admin';

    // Resident unit issue visibility check
    if (!isAdmin && issue.location && issue.location.type === 'unit') {
      const isSubmitter = issue.submittingResident && (
        issue.submittingResident._id
          ? issue.submittingResident._id.equals(req.user._id)
          : issue.submittingResident.equals(req.user._id)
      );
      if (!isSubmitter) {
        return res.status(404).json({
          success: false,
          message: 'Issue not found in this society.'
        });
      }
    }

    // Look up evidence subdocument across root evidence and completionDetails evidence
    let evidenceItem = null;
    if (Array.isArray(issue.evidence)) {
      evidenceItem = issue.evidence.id(evidenceId);
    }
    if (!evidenceItem && issue.completionDetails && Array.isArray(issue.completionDetails.evidence)) {
      evidenceItem = issue.completionDetails.evidence.id(evidenceId);
    }

    if (!evidenceItem) {
      return res.status(404).json({
        success: false,
        message: 'Evidence not found.'
      });
    }

    // Internal evidence restriction: return 404 to residents to prevent information leakage
    if (evidenceItem.isInternal && !isAdmin) {
      return res.status(404).json({
        success: false,
        message: 'Evidence not found.'
      });
    }

    // Verify stored file presence
    if (!evidenceItem.storedFilename) {
      return res.status(404).json({
        success: false,
        message: 'Evidence file not stored on server.'
      });
    }

    const filePath = getEvidenceFilePath(evidenceItem.storedFilename);
    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        message: 'Evidence file not found on disk.'
      });
    }

    // Set defensive HTTP security headers
    res.setHeader('Content-Type', evidenceItem.mimeType || 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');

    const safeFilename = (evidenceItem.originalFilename || 'evidence').replace(/[^a-zA-Z0-9._-]/g, '_');
    res.setHeader('Content-Disposition', `inline; filename="${safeFilename}"`);

    // Stream binary content with disconnect cleanup
    const fileStream = fs.createReadStream(filePath);

    // Destroy file stream immediately if client aborts or disconnects prematurely
    res.on('close', () => {
      if (!fileStream.destroyed) {
        fileStream.destroy();
      }
    });

    fileStream.on('error', (err) => {
      if (!res.headersSent) {
        return res.status(500).json({
          success: false,
          message: 'Error streaming evidence file.'
        });
      }
    });
    fileStream.pipe(res);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  uploadEvidence,
  downloadEvidence
};
