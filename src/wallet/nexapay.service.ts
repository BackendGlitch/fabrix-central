import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const NexaPayModule = require('@nexapay/node-sdk');
const NexaPay = NexaPayModule.default || NexaPayModule;

@Injectable()
export class NexaPayService {
  private readonly logger = new Logger(NexaPayService.name);
  private readonly client: any;

  constructor(private readonly configService: ConfigService) {
    const apiKey =
      this.configService.get('NEXAPAY_API_KEY') ||
      'nxp_developer_aa603022e4a1083809825a91_7e7a8be1';

    this.client = new NexaPay({
      apiKey,
      environment: 'sandbox',
    });
  }

  /**
   * Create a payment intent for top-up
   * Amount in millimes (1 TND = 1000)
   */
  async createPaymentIntent(
    amount: number, // Amount in TND (credits)
    description: string,
  ): Promise<{
    intent_id: string;
    client_secret: string;
    status: string;
    pay_url: string;
  }> {
    // Convert TND to millimes for NexaPay
    const amountInMillimes = Math.round(amount * 1000);

    this.logger.log(
      `Creating payment intent: ${amount} TND (${amountInMillimes} millimes)`,
    );

    try {
      const appUrl =
        this.configService.get('APP_URL') || 'http://localhost:3000';
      const response = await this.client.paymentIntents.create({
        amount: amountInMillimes,
        currency: 'TND',
        description,
        webhook: `${this.configService.get('API_URL') || 'http://localhost:4000'}/wallet/webhook`,
        redirect_url: `${appUrl}/dashboard/wallet?intent_id={intent_id}&status={status}`,
      });

      this.logger.log(`[NexaPay] Raw response: ${JSON.stringify(response)}`);

      // SDK wraps in { success, data, error }
      const payment = response.data || response;

      if (response.success === false) {
        throw new Error(response.error || 'Payment intent creation failed');
      }

      const result = {
        intent_id: payment.intent_id || payment.intentId || payment.id,
        client_secret:
          payment.client_secret || payment.clientSecret || payment.secret,
        status: payment.status || 'pending',
        pay_url:
          payment.checkout_url ||
          payment.pay_url ||
          payment.payUrl ||
          payment.url,
      };

      this.logger.log(`[NexaPay] Mapped response: ${JSON.stringify(result)}`);

      return result;
    } catch (error: any) {
      this.logger.error(
        `NexaPay createPaymentIntent error: ${error?.message || error}`,
        error,
      );
      throw new Error(
        `Failed to create payment intent: ${error?.message || error}`,
      );
    }
  }

  /**
   * Get payment intent status
   */
  async getPaymentIntent(
    intentId: string,
  ): Promise<{
    intent_id: string;
    amount: number;
    status: string;
    created_at: string;
  }> {
    try {
      const payment = await this.client.paymentIntents.get(intentId);

      return {
        intent_id: payment.intentId || payment.intent_id,
        amount: payment.amount,
        status: payment.status,
        created_at: payment.createdAt || payment.created_at,
      };
    } catch (error: any) {
      this.logger.error(
        `NexaPay getPaymentIntent error: ${error?.message || error}`,
        error,
      );
      throw new Error(
        `Failed to get payment intent: ${error?.message || error}`,
      );
    }
  }

  /**
   * Confirm a payment intent
   */
  async confirmPaymentIntent(
    intentId: string,
    paymentMethod: string,
  ): Promise<{ intent_id: string; status: string; confirmed_at: string }> {
    try {
      const result = await this.client.paymentIntents.confirm(intentId, {
        payment_method: paymentMethod,
      });

      return {
        intent_id: result.intentId || result.intent_id,
        status: result.status,
        confirmed_at: result.confirmedAt || result.confirmed_at,
      };
    } catch (error: any) {
      this.logger.error(
        `NexaPay confirmPaymentIntent error: ${error?.message || error}`,
        error,
      );
      throw new Error(
        `Failed to confirm payment intent: ${error?.message || error}`,
      );
    }
  }

  /**
   * Create a refund
   */
  async createRefund(
    intentId: string,
    amount: number, // in millimes
    reason?: string,
  ): Promise<{ refund_id: string; status: string }> {
    try {
      const result = await this.client.refunds.create({
        intent_id: intentId,
        amount,
        reason: reason || 'Customer request',
      });

      return {
        refund_id: result.refundId || result.refund_id,
        status: result.status,
      };
    } catch (error: any) {
      this.logger.error(
        `NexaPay createRefund error: ${error?.message || error}`,
        error,
      );
      throw new Error(`Failed to create refund: ${error?.message || error}`);
    }
  }

  /**
   * Create a payout/withdrawal
   */
  async createPayout(
    amount: number, // in millimes
    destination: string, // Bank RIB or wallet address
  ): Promise<{ payout_id: string; status: string }> {
    try {
      const result = await this.client.payouts.create({
        amount,
        destination,
      });

      return {
        payout_id: result.payoutId || result.payout_id,
        status: result.status,
      };
    } catch (error: any) {
      this.logger.error(
        `NexaPay createPayout error: ${error?.message || error}`,
        error,
      );
      throw new Error(`Failed to create payout: ${error?.message || error}`);
    }
  }
}
