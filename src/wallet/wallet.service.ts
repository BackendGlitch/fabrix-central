import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { users, creditTransactions, pendingTopUps } from '../database/schema';
import { eq, desc, and } from 'drizzle-orm';

export interface TopUpInput {
  amount: number;
  paymentMethod: string;
  metadata?: Record<string, unknown>;
}

export interface PaymentInput {
  jobId: string;
  amount: number;
  description?: string;
}

export interface TransferInput {
  fromUserId: string;
  toUserId: string;
  amount: number;
  jobId: string;
  description?: string;
}

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(private readonly db: DatabaseService) {}

  /**
   * Get user's wallet balance and recent transactions
   */
  async getWallet(userId: string) {
    const user = await this.db.db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        credits: users.credits,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user[0]) {
      throw new NotFoundException('User not found');
    }

    // Get recent transactions
    const transactions = await this.db.db
      .select()
      .from(creditTransactions)
      .where(eq(creditTransactions.userId, userId))
      .orderBy(desc(creditTransactions.createdAt))
      .limit(20);

    return {
      balance: user[0].credits,
      user: user[0],
      transactions: transactions.map(t => ({
        id: t.id,
        type: t.type,
        amount: t.amount,
        balanceAfter: t.balanceAfter,
        description: t.description,
        jobId: t.jobId,
        createdAt: t.createdAt,
      })),
    };
  }

  /**
   * Top up credits (add credits to account)
   * In production, this would integrate with a payment processor
   */
  async topUp(userId: string, input: TopUpInput) {
    if (input.amount <= 0) {
      throw new BadRequestException('Amount must be greater than 0');
    }

    return await this.db.db.transaction(async (tx) => {
      // Get current balance
      const user = await tx
        .select({ credits: users.credits })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!user[0]) {
        throw new NotFoundException('User not found');
      }

      const currentBalance = user[0].credits;
      const newBalance = currentBalance + input.amount;

      // Update user credits
      await tx
        .update(users)
        .set({ credits: newBalance })
        .where(eq(users.id, userId));

      // Create transaction record
      const [transaction] = await tx
        .insert(creditTransactions)
        .values({
          userId,
          type: 'topup',
          amount: input.amount,
          balanceAfter: newBalance,
          description: `Top-up ${input.amount} TND via ${input.paymentMethod}`,
          metadata: {
            paymentMethod: input.paymentMethod,
            ...input.metadata,
          },
        })
        .returning();

      this.logger.log(`[TopUp] User ${userId} added ${input.amount} credits. New balance: ${newBalance}`);

      return {
        success: true,
        amount: input.amount,
        newBalance,
        transactionId: transaction.id,
      };
    });
  }

  /**
   * Pay for a job using credits
   */
  async payForJob(userId: string, input: PaymentInput) {
    if (input.amount <= 0) {
      throw new BadRequestException('Amount must be greater than 0');
    }

    return await this.db.db.transaction(async (tx) => {
      // Get current balance
      const user = await tx
        .select({ credits: users.credits })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!user[0]) {
        throw new NotFoundException('User not found');
      }

      const currentBalance = user[0].credits;

      if (currentBalance < input.amount) {
        throw new BadRequestException(
          `Insufficient credits. Required: ${input.amount} TND, Available: ${currentBalance} TND`
        );
      }

      const newBalance = currentBalance - input.amount;

      // Deduct credits from user
      await tx
        .update(users)
        .set({ credits: newBalance })
        .where(eq(users.id, userId));

      // Create payment transaction record
      const [transaction] = await tx
        .insert(creditTransactions)
        .values({
          userId,
          type: 'payment',
          amount: -input.amount,
          balanceAfter: newBalance,
          description: input.description || `Payment for job ${input.jobId}`,
          jobId: input.jobId,
        })
        .returning();

      this.logger.log(`[Payment] User ${userId} paid ${input.amount} credits for job ${input.jobId}. New balance: ${newBalance}`);

      return {
        success: true,
        amount: input.amount,
        newBalance,
        transactionId: transaction.id,
      };
    });
  }

  /**
   * Transfer credits to owner (payout)
   */
  async transferToOwner(input: TransferInput) {
    if (input.amount <= 0) {
      throw new BadRequestException('Amount must be greater than 0');
    }

    return await this.db.db.transaction(async (tx) => {
      // Get owner's current balance
      const owner = await tx
        .select({ credits: users.credits })
        .from(users)
        .where(eq(users.id, input.toUserId))
        .limit(1);

      if (!owner[0]) {
        throw new NotFoundException('Owner not found');
      }

      const ownerCurrentBalance = owner[0].credits;
      const ownerNewBalance = ownerCurrentBalance + input.amount;

      // Add credits to owner
      await tx
        .update(users)
        .set({ credits: ownerNewBalance })
        .where(eq(users.id, input.toUserId));

      // Create payout transaction record for owner
      const [transaction] = await tx
        .insert(creditTransactions)
        .values({
          userId: input.toUserId,
          type: 'payout',
          amount: input.amount,
          balanceAfter: ownerNewBalance,
          description: input.description || `Payout for job ${input.jobId}`,
          jobId: input.jobId,
          metadata: {
            fromUserId: input.fromUserId,
          },
        })
        .returning();

      this.logger.log(`[Payout] Owner ${input.toUserId} received ${input.amount} credits for job ${input.jobId}. New balance: ${ownerNewBalance}`);

      return {
        success: true,
        amount: input.amount,
        ownerNewBalance,
        transactionId: transaction.id,
      };
    });
  }

  /**
   * Check if user has enough credits
   */
  async hasEnoughCredits(userId: string, amount: number): Promise<boolean> {
    const user = await this.db.db
      .select({ credits: users.credits })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user[0]) {
      return false;
    }

    return user[0].credits >= amount;
  }

  /**
   * Get transaction history
   */
  async getTransactions(userId: string, limit = 50) {
    const transactions = await this.db.db
      .select()
      .from(creditTransactions)
      .where(eq(creditTransactions.userId, userId))
      .orderBy(desc(creditTransactions.createdAt))
      .limit(limit);

    return transactions.map(t => ({
      id: t.id,
      type: t.type,
      amount: t.amount,
      balanceAfter: t.balanceAfter,
      description: t.description,
      jobId: t.jobId,
      createdAt: t.createdAt,
      metadata: t.metadata,
    }));
  }

  /**
   * Get pending top-ups for user
   */
  async getPendingTopUps(userId: string) {
    const topups = await this.db.db
      .select()
      .from(pendingTopUps)
      .where(eq(pendingTopUps.userId, userId))
      .orderBy(desc(pendingTopUps.createdAt));

    return topups;
  }

  /**
   * Create a pending top-up record
   */
  async createPendingTopUp(data: {
    userId: string;
    intentId: string;
    amount: number;
    payUrl: string;
    status: string;
  }) {
    const [topup] = await this.db.db
      .insert(pendingTopUps)
      .values({
        userId: data.userId,
        intentId: data.intentId,
        amount: data.amount,
        payUrl: data.payUrl,
        status: data.status as any,
        metadata: {},
      })
      .returning();

    return topup;
  }

  /**
   * Get pending top-up by intent ID
   */
  async getPendingTopUpByIntentId(intentId: string) {
    const [topup] = await this.db.db
      .select()
      .from(pendingTopUps)
      .where(eq(pendingTopUps.intentId, intentId))
      .limit(1);

    return topup || null;
  }

  /**
   * Confirm a top-up and add credits to wallet
   */
  async confirmTopUp(intentId: string, userId: string) {
    return await this.db.db.transaction(async (tx) => {
      // Update pending top-up status
      await tx
        .update(pendingTopUps)
        .set({
          status: 'succeeded' as any,
          confirmedAt: new Date(),
        })
        .where(eq(pendingTopUps.intentId, intentId));

      // Get the top-up amount
      const [topup] = await tx
        .select({ amount: pendingTopUps.amount })
        .from(pendingTopUps)
        .where(eq(pendingTopUps.intentId, intentId))
        .limit(1);

      if (!topup) {
        throw new NotFoundException('Top-up not found');
      }

      // Get current balance
      const [user] = await tx
        .select({ credits: users.credits })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!user) {
        throw new NotFoundException('User not found');
      }

      const newBalance = user.credits + topup.amount;

      // Update user credits
      await tx
        .update(users)
        .set({ credits: newBalance })
        .where(eq(users.id, userId));

      // Create transaction record
      const [transaction] = await tx
        .insert(creditTransactions)
        .values({
          userId,
          type: 'topup',
          amount: topup.amount,
          balanceAfter: newBalance,
          description: `Top-up ${topup.amount} TND via NexaPay`,
          metadata: {
            paymentMethod: 'nexapay',
            intentId,
          },
        })
        .returning();

      this.logger.log(`[TopUp Confirmed] User ${userId} added ${topup.amount} credits via NexaPay intent ${intentId}. New balance: ${newBalance}`);

      return {
        success: true,
        amount: topup.amount,
        newBalance,
        transactionId: transaction.id,
      };
    });
  }

  /**
   * Deduct credits for owner payout/withdrawal
   */
  async deductForPayout(userId: string, amount: number, payoutId: string) {
    return await this.db.db.transaction(async (tx) => {
      // Get current balance
      const [user] = await tx
        .select({ credits: users.credits })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!user) {
        throw new NotFoundException('User not found');
      }

      if (user.credits < amount) {
        throw new BadRequestException(`Insufficient balance. Available: ${user.credits} TND`);
      }

      const newBalance = user.credits - amount;

      // Deduct credits
      await tx
        .update(users)
        .set({ credits: newBalance })
        .where(eq(users.id, userId));

      // Create payout transaction record
      const [transaction] = await tx
        .insert(creditTransactions)
        .values({
          userId,
          type: 'payout',
          amount: -amount,
          balanceAfter: newBalance,
          description: `Withdrawal ${amount} TND to bank account`,
          metadata: {
            payoutId,
            method: 'nexapay_payout',
          },
        })
        .returning();

      this.logger.log(`[Payout] User ${userId} withdrew ${amount} credits. New balance: ${newBalance}. Payout ID: ${payoutId}`);

      return {
        success: true,
        amount,
        newBalance,
        transactionId: transaction.id,
      };
    });
  }
}
