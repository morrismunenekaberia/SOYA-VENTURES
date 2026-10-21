/**
 * Soya Ventures - Authentication Request Validation
 */

const { AppError } = require('../middleware/errorHandler');

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Supports standard Safaricom prefixes (07XX, 01XX, +2547XX, 2547XX)
const PHONE_REGEX = /^(?:\+?254|0)?([17]\d{8})$/;

/**
 * Normalizes phone numbers to standard Safaricom MSISDN format: 254XXXXXXXXX
 */
function normalizePhoneNumber(rawPhone) {
  if (!rawPhone || typeof rawPhone !== 'string') return null;
  const cleaned = rawPhone.replace(/[\s-]/g, '');
  const match = cleaned.match(PHONE_REGEX);
  if (!match) return null;
  return `254${match[1]}`;
}

function validateRegister(req, res, next) {
  const { full_name, email, password, phone_number, recruiter_id } = req.body || {};

  if (!full_name || typeof full_name !== 'string' || full_name.trim().length < 2) {
    return next(new AppError('Full name is required and must be at least 2 characters.', 400, 'INVALID_NAME'));
  }

  if (!email || typeof email !== 'string' || !EMAIL_REGEX.test(email.trim())) {
    return next(new AppError('A valid email address is required.', 400, 'INVALID_EMAIL'));
  }

  if (!password || typeof password !== 'string' || password.length < 6) {
    return next(new AppError('Password is required and must be at least 6 characters long.', 400, 'WEAK_PASSWORD'));
  }

  const normalizedPhone = normalizePhoneNumber(phone_number);
  if (!normalizedPhone) {
    return next(new AppError('A valid Kenyan phone number is required (e.g., 0712345678 or 254712345678).', 400, 'INVALID_PHONE'));
  }

  // Attach sanitized and normalized inputs
  req.body.full_name = full_name.trim();
  req.body.email = email.trim().toLowerCase();
  req.body.phone_number = normalizedPhone;
  if (recruiter_id) {
    const parsedRecruiter = Number(recruiter_id);
    if (isNaN(parsedRecruiter) || parsedRecruiter <= 0) {
      return next(new AppError('Invalid recruiter identifier.', 400, 'INVALID_RECRUITER'));
    }
    req.body.recruiter_id = parsedRecruiter;
  }

  next();
}

function validateLogin(req, res, next) {
  const { email, password } = req.body || {};

  if (!email || typeof email !== 'string' || !EMAIL_REGEX.test(email.trim())) {
    return next(new AppError('A valid email address is required.', 400, 'INVALID_EMAIL'));
  }

  if (!password || typeof password !== 'string' || password.length === 0) {
    return next(new AppError('Password is required.', 400, 'MISSING_PASSWORD'));
  }

  req.body.email = email.trim().toLowerCase();
  next();
}

function validateCreateUser(req, res, next) {
  const { full_name, email, password, phone_number, role, center_id, commission_rate } = req.body || {};

  if (!full_name || typeof full_name !== 'string' || full_name.trim().length < 2) {
    return next(new AppError('Full name is required and must be at least 2 characters.', 400, 'INVALID_NAME'));
  }

  if (!email || typeof email !== 'string' || !EMAIL_REGEX.test(email.trim())) {
    return next(new AppError('A valid email address is required.', 400, 'INVALID_EMAIL'));
  }

  if (!password || typeof password !== 'string' || password.length < 6) {
    return next(new AppError('Password is required and must be at least 6 characters.', 400, 'WEAK_PASSWORD'));
  }

  const normalizedPhone = normalizePhoneNumber(phone_number);
  if (!normalizedPhone) {
    return next(new AppError('A valid phone number is required (e.g. 0712345678).', 400, 'INVALID_PHONE'));
  }

  const allowedRoles = ['admin', 'manager', 'center', 'agent'];
  if (!role || !allowedRoles.includes(role)) {
    return next(new AppError(`Role must be one of: ${allowedRoles.join(', ')}.`, 400, 'INVALID_ROLE'));
  }

  req.body.full_name = full_name.trim();
  req.body.email = email.trim().toLowerCase();
  req.body.phone_number = normalizedPhone;
  req.body.role = role;

  if (center_id !== undefined && center_id !== null) {
    const parsedCenter = Number(center_id);
    if (isNaN(parsedCenter) || parsedCenter <= 0) {
      return next(new AppError('Center ID must be a positive integer.', 400, 'INVALID_CENTER'));
    }
    req.body.center_id = parsedCenter;
  }

  if (commission_rate !== undefined && commission_rate !== null) {
    const parsedRate = Number(commission_rate);
    if (isNaN(parsedRate) || parsedRate < 0 || parsedRate > 100) {
      return next(new AppError('Commission rate must be between 0 and 100 percent.', 400, 'INVALID_RATE'));
    }
    req.body.commission_rate = parsedRate;
  }

  next();
}

module.exports = {
  normalizePhoneNumber,
  validateRegister,
  validateLogin,
  validateCreateUser,
};

