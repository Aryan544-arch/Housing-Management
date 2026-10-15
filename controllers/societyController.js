const mongoose = require('mongoose');
const Society = require('../models/Society');
const SocietyMembership = require('../models/SocietyMembership');
const User = require('../models/User');

/**
 * Create a new housing society and designate the creator as admin.
 */
async function createSociety(req, res, next) {
  try {
    const { name, code, address } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      return res.status(400).json({
        success: false,
        message: 'Society name is required and must be at least 2 characters long.'
      });
    }

    if (!code || typeof code !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Society code is required.'
      });
    }

    const normalizedCode = code.trim().toUpperCase();
    if (!/^[A-Z0-9_-]{3,20}$/.test(normalizedCode)) {
      return res.status(400).json({
        success: false,
        message: 'Society code must be 3-20 alphanumeric characters, hyphens, or underscores.'
      });
    }

    const existingSociety = await Society.findOne({ code: normalizedCode });
    if (existingSociety) {
      return res.status(409).json({
        success: false,
        message: 'A society with this code already exists.'
      });
    }

    const society = await Society.create({
      name: name.trim(),
      code: normalizedCode,
      address: address || {},
      createdBy: req.user._id
    });

    let membership;
    try {
      // Automatically assign creator as admin member
      membership = await SocietyMembership.create({
        user: req.user._id,
        society: society._id,
        role: 'admin',
        status: 'active'
      });
    } catch (membershipError) {
      // Rollback orphaned society document if membership creation fails
      await Society.findByIdAndDelete(society._id);
      throw membershipError;
    }

    res.status(201).json({
      success: true,
      message: 'Society created successfully',
      society,
      membership
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Get details for a society (member-only access).
 */
function getSociety(req, res) {
  res.status(200).json({
    success: true,
    society: req.society,
    currentRole: req.membership.role,
    flatNumber: req.membership.flatNumber
  });
}

/**
 * Add a member to the society (admin-only).
 */
async function addMember(req, res, next) {
  try {
    const { email, role = 'resident', flatNumber = '' } = req.body;

    if (!email || typeof email !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'User email is required to add a member.'
      });
    }

    if (!['resident', 'admin'].includes(role)) {
      return res.status(400).json({
        success: false,
        message: 'Role must be either resident or admin. External providers cannot be users.'
      });
    }

    const targetUser = await User.findOne({ email: email.trim().toLowerCase() });
    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: 'No registered user found with that email address.'
      });
    }

    const existingMembership = await SocietyMembership.findOne({
      user: targetUser._id,
      society: req.society._id
    });

    if (existingMembership) {
      return res.status(409).json({
        success: false,
        message: 'User is already a member of this society.'
      });
    }

    const newMembership = await SocietyMembership.create({
      user: targetUser._id,
      society: req.society._id,
      role,
      flatNumber: flatNumber ? flatNumber.trim() : '',
      status: 'active'
    });

    res.status(201).json({
      success: true,
      message: 'Member added successfully',
      membership: newMembership
    });
  } catch (error) {
    next(error);
  }
}

/**
 * List active members of a society (member-only access).
 */
async function listMembers(req, res, next) {
  try {
    const members = await SocietyMembership.find({
      society: req.society._id,
      status: 'active'
    }).populate('user', 'name email phone');

    res.status(200).json({
      success: true,
      societyId: req.society._id,
      count: members.length,
      members
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Access protected internal society data.
 * Used to verify cross-society tenant isolation.
 */
function getProtectedSocietyData(req, res) {
  res.status(200).json({
    success: true,
    message: 'Authorized access to protected society data',
    societyId: req.society._id,
    societyName: req.society.name,
    requesterRole: req.membership.role
  });
}

/**
 * Execute an admin-only action within the society.
 * Used to verify role-based access control.
 */
function executeAdminAction(req, res) {
  res.status(200).json({
    success: true,
    message: 'Admin action executed successfully',
    societyId: req.society._id,
    requesterRole: req.membership.role
  });
}

module.exports = {
  createSociety,
  getSociety,
  addMember,
  listMembers,
  getProtectedSocietyData,
  executeAdminAction
};
