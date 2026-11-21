const crypto = require('node:crypto');

class MockWhatsAppService {
  constructor() {
    this.reset();
  }

  reset() {
    this.deliveredKeys = new Map(); // idempotencyKey -> deliveryReceipt
    this.attemptLogs = []; // Array of attempt records
    this.failureMode = 'RANDOM'; // 'RANDOM' | 'ALWAYS_SUCCESS' | 'ALWAYS_FAIL' | 'FAIL_ONCE'
    this.failCountByKey = new Map();
  }

  setFailureMode(mode) {
    this.failureMode = mode;
  }

  /**
   * Sends certificate via WhatsApp simulation.
   * Guarantees idempotency via idempotencyKey.
   * Simulates transient failures, timeouts, and success.
   */
  async sendMessage({ recipientPhone, certificateNumber, candidateName, pdfDownloadUrl, idempotencyKey }) {
    const startTime = Date.now();
    const currentAttempt = (this.failCountByKey.get(idempotencyKey) || 0) + 1;

    // 1. IDEMPOTENCY CHECK:
    // If this exact delivery was already completed, return the original receipt immediately
    if (this.deliveredKeys.has(idempotencyKey)) {
      const existing = this.deliveredKeys.get(idempotencyKey);
      this.attemptLogs.push({
        idempotencyKey,
        recipientPhone,
        certificateNumber,
        attempt: currentAttempt,
        status: 'IDEMPOTENT_CACHE_HIT',
        receipt: existing,
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString()
      });
      return existing;
    }

    // 2. SIMULATE NETWORK BEHAVIOR (Success, Failure, Timeout)
    let shouldFail = false;
    let failureType = 'TRANSIENT_ERROR';

    if (this.failureMode === 'ALWAYS_FAIL') {
      shouldFail = true;
    } else if (this.failureMode === 'FAIL_ONCE') {
      if (currentAttempt === 1) {
        shouldFail = true;
        this.failCountByKey.set(idempotencyKey, currentAttempt);
      }
    } else if (this.failureMode === 'RANDOM') {
      // 15% transient error, 5% timeout, 80% success
      const rand = Math.random();
      if (rand < 0.05) {
        shouldFail = true;
        failureType = 'TIMEOUT';
      } else if (rand < 0.20) {
        shouldFail = true;
        failureType = 'TRANSIENT_ERROR';
      }
    }

    // 3. HANDLE FAILURE SIMULATION
    if (shouldFail) {
      const durationMs = failureType === 'TIMEOUT' ? 50 : 15; // simulate elapsed time
      const errorMsg =
        failureType === 'TIMEOUT'
          ? 'WHATSAPP_GATEWAY_TIMEOUT: Upstream WhatsApp server timed out after 5000ms'
          : 'WHATSAPP_SERVER_ERROR: Transient 503 Service Unavailable';

      this.attemptLogs.push({
        idempotencyKey,
        recipientPhone,
        certificateNumber,
        attempt: currentAttempt,
        status: 'FAILED',
        error: errorMsg,
        durationMs,
        timestamp: new Date().toISOString()
      });

      const error = new Error(errorMsg);
      error.isTransient = true;
      error.attempt = currentAttempt;
      throw error;
    }

    // 4. HANDLE SUCCESSFUL DISPATCH
    const receipt = {
      messageId: `wamid.HBgM${crypto.randomBytes(8).toString('hex').toUpperCase()}`,
      idempotencyKey,
      recipientPhone,
      certificateNumber,
      candidateName,
      pdfDownloadUrl,
      status: 'DELIVERED',
      deliveredAt: new Date().toISOString()
    };

    this.deliveredKeys.set(idempotencyKey, receipt);

    this.attemptLogs.push({
      idempotencyKey,
      recipientPhone,
      certificateNumber,
      attempt: currentAttempt,
      status: 'SENT',
      receipt,
      durationMs: Date.now() - startTime,
      timestamp: new Date().toISOString()
    });

    return receipt;
  }

  getDeliveryLogs() {
    return [...this.attemptLogs];
  }

  getReceipt(idempotencyKey) {
    return this.deliveredKeys.get(idempotencyKey) || null;
  }
}

const mockWhatsApp = new MockWhatsAppService();

module.exports = {
  mockWhatsApp,
  MockWhatsAppService
};
