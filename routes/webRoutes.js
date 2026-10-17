const express = require('express');
const mongoose = require('mongoose');
const { optionalAuthenticate } = require('../middleware/auth');
const Society = require('../models/Society');
const SocietyMembership = require('../models/SocietyMembership');
const { Issue } = require('../models/Issue');
const { Provider } = require('../models/Provider');
const { Notification } = require('../models/Notification');

const router = express.Router();

/**
 * Sanitize and validate redirect destinations to prevent open redirects and redirect loops.
 * Only allows relative paths on the current origin, rejecting external protocols, protocol-relative
 * URLs (//), and login/register loops.
 */
function getSafeRedirectUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '/dashboard';
  const trimmed = rawUrl.trim();
  // Must start with single slash; reject double slash or backslash (protocol-relative / bypasses)
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.startsWith('/\\')) {
    return '/dashboard';
  }
  // Reject external scheme attempts
  if (trimmed.includes('://') || /^\/[a-z0-9]+:/i.test(trimmed)) {
    return '/dashboard';
  }
  // Prevent redirect loops
  if (trimmed.startsWith('/login') || trimmed.startsWith('/register')) {
    return '/dashboard';
  }
  return trimmed;
}

/**
 * Web-specific authentication guard:
 * Populates req.user from HttpOnly cookie or Authorization header.
 * Redirects to /login (HTTP 302) if session is unauthenticated.
 */
function requireWebAuth(req, res, next) {
  optionalAuthenticate(req, res, () => {
    if (!req.user) {
      const rawTarget = req.originalUrl || '';
      const safeTarget = getSafeRedirectUrl(rawTarget);
      const loginUrl = safeTarget !== '/dashboard' ? `/login?redirect=${encodeURIComponent(safeTarget)}` : '/login';
      return res.redirect(loginUrl);
    }
    next();
  });
}

/**
 * Helper to fetch all active society memberships for the current user.
 */
async function getUserMemberships(userId) {
  if (!userId) return [];
  return SocietyMembership.find({
    user: userId,
    status: 'active'
  }).populate('society', 'name code address');
}

/**
 * Helper to fetch ALL memberships (active, pending, inactive) for status triage.
 */
async function getAllUserMemberships(userId) {
  if (!userId) return [];
  return SocietyMembership.find({
    user: userId
  }).populate('society', 'name code address');
}

// 1. Root Route
router.get('/', optionalAuthenticate, (req, res) => {
  if (req.user) {
    return res.redirect('/dashboard');
  }
  res.redirect('/login');
});

// 2. Authentication Views
router.get('/login', optionalAuthenticate, (req, res) => {
  const safeRedirect = getSafeRedirectUrl(req.query.redirect);
  if (req.user) {
    return res.redirect(safeRedirect);
  }
  res.render('auth/login', {
    title: 'Log In',
    csrfToken: res.locals.csrfToken || '',
    redirectUrl: safeRedirect !== '/dashboard' ? safeRedirect : '',
    user: null
  });
});

router.get('/register', optionalAuthenticate, (req, res) => {
  const safeRedirect = getSafeRedirectUrl(req.query.redirect);
  if (req.user) {
    return res.redirect(safeRedirect);
  }
  res.render('auth/register', {
    title: 'Register Account',
    csrfToken: res.locals.csrfToken || '',
    redirectUrl: safeRedirect !== '/dashboard' ? safeRedirect : '',
    user: null
  });
});

router.get('/verify-email', optionalAuthenticate, (req, res) => {
  res.render('auth/verify-email', {
    title: 'Email Verification Status',
    csrfToken: res.locals.csrfToken || '',
    user: req.user || null
  });
});

// 3. Main Dashboard Router (Dispatches to active society or selection console)
router.get('/dashboard', requireWebAuth, async (req, res, next) => {
  try {
    const allMemberships = await getAllUserMemberships(req.user._id);
    const activeMemberships = allMemberships.filter(m => m.status === 'active' && m.society);
    const pendingMemberships = allMemberships.filter(m => m.status === 'pending' && m.society);
    const inactiveMemberships = allMemberships.filter(m => m.status === 'inactive' && m.society);

    // If user belongs to exactly one active society and has no other pending/inactive affiliations,
    // route directly to that society's dashboard
    if (activeMemberships.length === 1 && pendingMemberships.length === 0 && inactiveMemberships.length === 0) {
      return res.redirect(`/societies/${activeMemberships[0].society._id}/dashboard`);
    }

    // Multiple active societies, pending status, or zero memberships: render selection console
    res.render('dashboard/select-society', {
      title: 'Select Housing Society',
      user: req.user,
      memberships: activeMemberships,
      activeMemberships,
      pendingMemberships,
      inactiveMemberships,
      allMemberships,
      activeSociety: null,
      csrfToken: res.locals.csrfToken || ''
    });
  } catch (err) {
    next(err);
  }
});

// 3b. Dedicated Society Selection Route (Allows switching society at any time)
router.get('/select-society', requireWebAuth, async (req, res, next) => {
  try {
    const allMemberships = await getAllUserMemberships(req.user._id);
    const activeMemberships = allMemberships.filter(m => m.status === 'active' && m.society);
    const pendingMemberships = allMemberships.filter(m => m.status === 'pending' && m.society);
    const inactiveMemberships = allMemberships.filter(m => m.status === 'inactive' && m.society);

    res.render('dashboard/select-society', {
      title: 'Select Housing Society',
      user: req.user,
      memberships: activeMemberships,
      activeMemberships,
      pendingMemberships,
      inactiveMemberships,
      allMemberships,
      activeSociety: null,
      csrfToken: res.locals.csrfToken || ''
    });
  } catch (err) {
    next(err);
  }
});

// 4. Society-Scoped Dashboard (Resident vs Admin View)
router.get('/societies/:societyId/dashboard', requireWebAuth, async (req, res, next) => {
  try {
    const { societyId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(societyId)) {
      return res.redirect('/dashboard');
    }

    const [currentMembership, allMemberships, unreadCount] = await Promise.all([
      SocietyMembership.findOne({
        user: req.user._id,
        society: societyId,
        status: 'active'
      }).populate('society'),
      getUserMemberships(req.user._id),
      Notification.countDocuments({
        recipient: req.user._id,
        society: societyId,
        read: false
      })
    ]);

    if (!currentMembership || !currentMembership.society) {
      return res.redirect('/dashboard');
    }

    const isAdmin = currentMembership.role === 'admin';
    const society = currentMembership.society;

    // Issue filtering based on role
    const issueFilter = { society: society._id };
    if (!isAdmin) {
      // Residents only see their own issues and common-area issues
      issueFilter.$or = [
        { submittingResident: req.user._id },
        { 'location.type': 'common_area' }
      ];
    }

    const issues = await Issue.find(issueFilter)
      .populate('submittingResident', 'name email phone')
      .sort({ createdAt: -1 });

    const sanitizedIssues = issues.map((doc) =>
      doc.toClientJSON(currentMembership.role, req.user._id)
    );

    const viewTemplate = isAdmin ? 'dashboard/admin' : 'dashboard/resident';

    res.render(viewTemplate, {
      title: `${society.name} | Operations Dashboard`,
      user: req.user,
      activeSociety: society,
      activeSocietyRole: currentMembership.role,
      currentRole: currentMembership.role,
      flatNumber: currentMembership.flatNumber,
      memberships: allMemberships,
      issues: sanitizedIssues,
      unreadCount,
      activeNav: 'dashboard',
      csrfToken: res.locals.csrfToken || ''
    });
  } catch (err) {
    next(err);
  }
});

// 5. New Issue Reporting Form
router.get('/societies/:societyId/issues/new', requireWebAuth, async (req, res, next) => {
  try {
    const { societyId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(societyId)) {
      return res.redirect('/dashboard');
    }

    const [currentMembership, allMemberships, unreadCount] = await Promise.all([
      SocietyMembership.findOne({
        user: req.user._id,
        society: societyId,
        status: 'active'
      }).populate('society'),
      getUserMemberships(req.user._id),
      Notification.countDocuments({
        recipient: req.user._id,
        society: societyId,
        read: false
      })
    ]);

    if (!currentMembership || !currentMembership.society) {
      return res.redirect('/dashboard');
    }

    res.render('issues/new', {
      title: 'Report Building or Unit Issue',
      user: req.user,
      activeSociety: currentMembership.society,
      activeSocietyRole: currentMembership.role,
      currentRole: currentMembership.role,
      flatNumber: currentMembership.flatNumber,
      memberships: allMemberships,
      unreadCount,
      activeNav: 'new-issue',
      csrfToken: res.locals.csrfToken || ''
    });
  } catch (err) {
    next(err);
  }
});

// 6. Issue Details, Timeline, & Workflow Actions
router.get('/societies/:societyId/issues/:issueId', requireWebAuth, async (req, res, next) => {
  try {
    const { societyId, issueId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(societyId)) {
      return res.redirect('/dashboard');
    }

    const currentMembership = await SocietyMembership.findOne({
      user: req.user._id,
      society: societyId,
      status: 'active'
    }).populate('society');

    if (!currentMembership || !currentMembership.society) {
      return res.redirect('/dashboard');
    }

    if (!mongoose.Types.ObjectId.isValid(issueId)) {
      return res.status(404).render('issues/error', {
        title: 'Issue Not Found · Housing Portal',
        user: req.user,
        activeSociety: currentMembership.society,
        errorCode: 404,
        errorTitle: 'Issue Manifest Not Found',
        errorMessage: 'The requested issue identifier is invalid or does not correspond to a valid issue manifest.',
        returnUrl: `/societies/${societyId}/dashboard`,
        returnLabel: `Return to ${currentMembership.society.name} Dashboard`
      });
    }

    const [allMemberships, rawIssue, unreadCount] = await Promise.all([
      getUserMemberships(req.user._id),
      Issue.findOne({ _id: issueId, society: societyId })
        .populate('submittingResident', 'name email phone')
        .populate('history.changedBy', 'name email'),
      Notification.countDocuments({
        recipient: req.user._id,
        society: societyId,
        read: false
      })
    ]);

    if (!rawIssue) {
      return res.status(404).render('issues/error', {
        title: 'Issue Not Located · Housing Portal',
        user: req.user,
        activeSociety: currentMembership.society,
        errorCode: 404,
        errorTitle: 'Issue Manifest Not Located',
        errorMessage: `No issue ticket with ID "${issueId}" exists within ${currentMembership.society.name}. It may have been archived or removed.`,
        returnUrl: `/societies/${societyId}/dashboard`,
        returnLabel: `Return to ${currentMembership.society.name} Dashboard`
      });
    }

    const isResident = currentMembership.role === 'resident';
    const isSubmitter = rawIssue.submittingResident && rawIssue.submittingResident._id
      ? rawIssue.submittingResident._id.equals(req.user._id)
      : false;
    const isCommonArea = rawIssue.location && rawIssue.location.type === 'common_area';

    // Privacy guard: Residents cannot inspect other residents' private unit issues
    if (isResident && !isSubmitter && !isCommonArea) {
      return res.status(403).render('issues/error', {
        title: 'Access Restricted · Housing Portal',
        user: req.user,
        activeSociety: currentMembership.society,
        errorCode: 403,
        errorTitle: 'Private Unit Issue Restricted',
        errorMessage: 'In accordance with society privacy rules, residential unit issues are restricted exclusively to the submitting resident and society management.',
        returnUrl: `/societies/${societyId}/dashboard`,
        returnLabel: `Return to ${currentMembership.society.name} Dashboard`
      });
    }

    const sanitizedIssue = rawIssue.toClientJSON(currentMembership.role, req.user._id);

    res.render('issues/details', {
      title: `Issue #${rawIssue._id.toString().slice(-6).toUpperCase()} | ${rawIssue.title}`,
      user: req.user,
      activeSociety: currentMembership.society,
      activeSocietyRole: currentMembership.role,
      currentRole: currentMembership.role,
      flatNumber: currentMembership.flatNumber,
      memberships: allMemberships,
      issue: sanitizedIssue,
      unreadCount,
      activeNav: 'issues',
      csrfToken: res.locals.csrfToken || ''
    });
  } catch (err) {
    next(err);
  }
});

// 7. Administrator Provider Directory (Admin Only)
router.get('/societies/:societyId/admin/providers', requireWebAuth, async (req, res, next) => {
  try {
    const { societyId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(societyId)) {
      return res.redirect('/dashboard');
    }

    const [currentMembership, allMemberships, unreadCount] = await Promise.all([
      SocietyMembership.findOne({
        user: req.user._id,
        society: societyId,
        status: 'active'
      }).populate('society'),
      getUserMemberships(req.user._id),
      Notification.countDocuments({
        recipient: req.user._id,
        society: societyId,
        read: false
      })
    ]);

    if (!currentMembership || currentMembership.role !== 'admin') {
      return res.redirect(`/societies/${societyId}/dashboard`);
    }

    const providers = await Provider.find({ society: societyId }).sort({ name: 1 });

    res.render('admin/providers', {
      title: 'Contractors & Service Providers',
      user: req.user,
      activeSociety: currentMembership.society,
      activeSocietyRole: 'admin',
      currentRole: 'admin',
      flatNumber: currentMembership.flatNumber,
      memberships: allMemberships,
      providers,
      unreadCount,
      activeNav: 'providers',
      csrfToken: res.locals.csrfToken || ''
    });
  } catch (err) {
    next(err);
  }
});

// 8. Notifications Center
router.get('/societies/:societyId/notifications', requireWebAuth, async (req, res, next) => {
  try {
    const { societyId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(societyId)) {
      return res.redirect('/dashboard');
    }

    const [currentMembership, allMemberships, notifications, unreadCount] = await Promise.all([
      SocietyMembership.findOne({
        user: req.user._id,
        society: societyId,
        status: 'active'
      }).populate('society'),
      getUserMemberships(req.user._id),
      Notification.find({
        recipient: req.user._id,
        society: societyId
      }).sort({ createdAt: -1 }).limit(50),
      Notification.countDocuments({
        recipient: req.user._id,
        society: societyId,
        read: false
      })
    ]);

    if (!currentMembership || !currentMembership.society) {
      return res.redirect('/dashboard');
    }

    res.render('notifications/index', {
      title: 'Notifications Center',
      user: req.user,
      activeSociety: currentMembership.society,
      activeSocietyRole: currentMembership.role,
      currentRole: currentMembership.role,
      flatNumber: currentMembership.flatNumber,
      memberships: allMemberships,
      notifications,
      unreadCount,
      activeNav: 'notifications',
      csrfToken: res.locals.csrfToken || ''
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
