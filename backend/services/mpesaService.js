/**
 * Soya Ventures - Safaricom Daraja M-Pesa B2C Client
 * 
 * Handles OAuth 2.0 authentication, B2C payment requests, token caching,
 * and safe request redaction according to Safaricom Daraja API specifications.
 */

const config = require('../config/env');
const { AppError } = require('../middleware/errorHandler');
const { logger, maskPhone } = require('../config/logger');

let cachedToken = null;
let tokenExpiresAt = 0;

// Mock adapter for unit testing and local sandboxing without external network calls
let mockTransport = null;

function setMockTransport(fn) {
  mockTransport = fn;
}

function clearMockTransport() {
  mockTransport = null;
}

/**
 * Retrieves a valid OAuth 2.0 Bearer access token.
 * Caches token in memory and refreshes prior to expiration.
 */
async function getAccessToken() {
  // Check if unexpired token is cached (with 60-second safety window)
  if (cachedToken && Date.now() < tokenExpiresAt - 60000) {
    return cachedToken;
  }

  if (mockTransport && mockTransport.getAccessToken) {
    const mockRes = await mockTransport.getAccessToken();
    cachedToken = mockRes.access_token;
    tokenExpiresAt = Date.now() + (Number(mockRes.expires_in) || 3599) * 1000;
    return cachedToken;
  }

  const { consumerKey, consumerSecret, baseUrl } = config.mpesa;

  if (!consumerKey || !consumerSecret) {
    throw new AppError(
      'M-Pesa credentials not configured. Please set MPESA_CONSUMER_KEY and MPESA_CONSUMER_SECRET.',
      500,
      'MPESA_CONFIG_MISSING'
    );
  }

  const credentials = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
  const url = `${baseUrl}/oauth/v1/generate?grant_type=client_credentials`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Basic ${credentials}`,
      },
    });

    if (!response.ok) {
      logger.error('Daraja OAuth Token Error: HTTP status failure', { status: response.status });
      throw new AppError('Failed to obtain M-Pesa authorization token.', 502, 'MPESA_AUTH_FAILED');
    }

    const data = await response.json();
    cachedToken = data.access_token;
    tokenExpiresAt = Date.now() + (Number(data.expires_in) || 3599) * 1000;

    logger.debug('Daraja OAuth token refreshed successfully', {
      expiresIn: data.expires_in,
    });

    return cachedToken;
  } catch (err) {
    if (err instanceof AppError) throw err;
    logger.error('Daraja OAuth network connection error', { error: err.message });
    throw new AppError(`M-Pesa network connectivity error: ${err.message}`, 502, 'MPESA_NETWORK_ERROR');
  }
}

/**
 * Submits a B2C Payment Request to Safaricom Daraja API
 */
async function sendB2CPaymentRequest({
  phone,
  amount,
  remarks = 'Commission Payout',
  occasion = null,
  payoutReference,
}) {
  logger.info('Dispatching Daraja B2C payment request', {
    payoutReference,
    phone: maskPhone(phone),
    amount,
  });

  if (mockTransport && mockTransport.sendB2C) {
    return mockTransport.sendB2C({ phone, amount, remarks, occasion, payoutReference });
  }

  const token = await getAccessToken();
  const { baseUrl, initiatorName, securityCredential, shortcode, commandId, resultUrl, timeoutUrl } = config.mpesa;

  const payload = {
    InitiatorName: initiatorName,
    SecurityCredential: securityCredential,
    CommandID: commandId,
    Amount: Math.round(Number(amount)),
    PartyA: shortcode,
    PartyB: phone,
    Remarks: remarks,
    QueueTimeOutURL: timeoutUrl,
    ResultURL: resultUrl,
    Occasion: occasion || payoutReference,
  };

  const url = `${baseUrl}/mpesa/b2c/v1/paymentrequest`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    // Safaricom acceptance response (ResponseCode 0 means queued for processing)
    if (response.ok && data.ResponseCode === '0') {
      logger.info('Daraja accepted B2C payment request', {
        payoutReference,
        conversationId: data.ConversationID,
        originatorConversationId: data.OriginatorConversationID,
      });

      return {
        accepted: true,
        conversationId: data.ConversationID,
        originatorConversationId: data.OriginatorConversationID,
        responseDesc: data.ResponseDescription,
      };
    }

    // Explicit Daraja rejection
    logger.warn('Daraja rejected B2C payment request', {
      payoutReference,
      errorCode: data.errorCode || data.ResponseCode || 'B2C_REJECTED',
      errorMessage: data.errorMessage || data.ResponseDescription,
    });

    return {
      accepted: false,
      errorCode: data.errorCode || data.ResponseCode || 'B2C_REJECTED',
      errorMessage: data.errorMessage || data.ResponseDescription || 'Payment request rejected by Daraja.',
    };
  } catch (err) {
    // Flag network timeouts / connectivity failures as UNCERTAIN
    err.isNetworkFailure = true;
    logger.warn('Daraja B2C network timeout / connection failure', {
      payoutReference,
      error: err.message,
    });
    throw err;
  }
}

module.exports = {
  getAccessToken,
  sendB2CPaymentRequest,
  setMockTransport,
  clearMockTransport,
};
