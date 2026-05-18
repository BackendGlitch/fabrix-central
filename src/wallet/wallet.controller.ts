import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Req,
  BadRequestException,
  Query,
  Headers,
  RawBody,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { WalletService } from './wallet.service';
import { NexaPayService } from './nexapay.service';
import type { Request } from 'express';
import { IsNumber, IsString, IsOptional, IsNotEmpty, IsEnum } from 'class-validator';
import { UsePipes, ValidationPipe } from '@nestjs/common';

interface AuthUser {
  userId: string;
  email: string;
  role: string;
}

class CreatePaymentIntentDto {
  @IsNumber()
  @IsNotEmpty()
  amount!: number; // Amount in TND (credits)

  @IsString()
  @IsOptional()
  description?: string;
}

class ConfirmPaymentDto {
  @IsString()
  @IsNotEmpty()
  intentId!: string;
}

class PayoutDto {
  @IsNumber()
  @IsNotEmpty()
  amount!: number; // Amount in TND

  @IsString()
  @IsNotEmpty()
  destination!: string; // Bank RIB or wallet address
}

class PayForJobDto {
  @IsString()
  @IsNotEmpty()
  jobId!: string;

  @IsNumber()
  @IsNotEmpty()
  amount!: number;
}

@Controller('wallet')
export class WalletController {
  constructor(
    private readonly walletService: WalletService,
    private readonly nexaPayService: NexaPayService,
  ) {}

  /**
   * Get current user's wallet balance and transactions
   */
  @Get()
  @UseGuards(JwtAuthGuard)
  async getWallet(@Req() req: Request) {
    const user = req.user as AuthUser;
    return await this.walletService.getWallet(user.userId);
  }

  /**
   * Get transaction history
   */
  @Get('transactions')
  @UseGuards(JwtAuthGuard)
  async getTransactions(
    @Req() req: Request,
    @Query('limit') limit?: string,
  ) {
    const user = req.user as AuthUser;
    const limitNum = limit ? parseInt(limit, 10) : 50;
    return await this.walletService.getTransactions(user.userId, limitNum);
  }

  /**
   * Get pending top-ups for current user
   */
  @Get('pending-topups')
  @UseGuards(JwtAuthGuard)
  async getPendingTopUps(@Req() req: Request) {
    const user = req.user as AuthUser;
    return await this.walletService.getPendingTopUps(user.userId);
  }

  /**
   * Create a payment intent for top-up (returns checkout URL)
   */
  @Post('create-intent')
  @UseGuards(JwtAuthGuard)
  @UsePipes(new ValidationPipe({ transform: true }))
  async createPaymentIntent(
    @Req() req: Request,
    @Body() dto: CreatePaymentIntentDto,
  ) {
    const user = req.user as AuthUser;

    if (!dto.amount || dto.amount <= 0) {
      throw new BadRequestException('Amount must be greater than 0');
    }

    // Create NexaPay payment intent
    const paymentIntent = await this.nexaPayService.createPaymentIntent(
      dto.amount,
      dto.description || `Top up ${dto.amount} TND credits`,
    );

    // Validate payment intent response
    if (!paymentIntent.intent_id || !paymentIntent.pay_url) {
      console.error('[WalletController] Invalid payment intent response:', paymentIntent);
      throw new BadRequestException('Payment gateway returned invalid response');
    }

    // Map NexaPay status to our DB enum
    const mappedStatus = paymentIntent.status === 'requires_confirmation' ? 'pending' : paymentIntent.status;

    // Save to pending top-ups
    await this.walletService.createPendingTopUp({
      userId: user.userId,
      intentId: paymentIntent.intent_id,
      amount: dto.amount,
      payUrl: paymentIntent.pay_url,
      status: mappedStatus,
    });

    return {
      success: true,
      message: 'Payment intent created',
      data: {
        intentId: paymentIntent.intent_id,
        clientSecret: paymentIntent.client_secret,
        status: paymentIntent.status,
        payUrl: paymentIntent.pay_url,
        amount: dto.amount,
      },
    };
  }

  /**
   * Confirm a payment intent and add credits to wallet
   */
  @Post('confirm-payment')
  @UseGuards(JwtAuthGuard)
  @UsePipes(new ValidationPipe({ transform: true }))
  async confirmPayment(
    @Req() req: Request,
    @Body() dto: ConfirmPaymentDto,
  ) {
    const user = req.user as AuthUser;

    // Get pending top-up
    const pendingTopUp = await this.walletService.getPendingTopUpByIntentId(dto.intentId);

    if (!pendingTopUp) {
      throw new BadRequestException('Payment intent not found');
    }

    // Verify this top-up belongs to the current user
    if (pendingTopUp.userId !== user.userId) {
      throw new BadRequestException('Unauthorized');
    }

    // Already processed
    if (pendingTopUp.status === 'succeeded') {
      const wallet = await this.walletService.getWallet(user.userId);
      return {
        success: true,
        message: 'Payment already processed',
        data: { amount: pendingTopUp.amount, newBalance: wallet.balance },
      };
    }

    // Confirm top-up and add credits (user has already paid on NexaPay checkout)
    await this.walletService.confirmTopUp(dto.intentId, user.userId);

    const wallet = await this.walletService.getWallet(user.userId);

    return {
      success: true,
      message: `Successfully added ${pendingTopUp.amount} TND to your wallet`,
      data: {
        amount: pendingTopUp.amount,
        newBalance: wallet.balance,
      },
    };
  }

  /**
   * Webhook handler for NexaPay payment events
   */
  @Post('webhook')
  async handleWebhook(
    @Body() payload: any,
    @Headers('x-nexapay-signature') signature?: string,
  ) {
    const event = payload.event;
    const data = payload.data;

    if (event === 'payment_intent.succeeded' && data?.intent_id) {
      const intentId = data.intent_id;
      const pendingTopUp = await this.walletService.getPendingTopUpByIntentId(intentId);

      if (pendingTopUp && pendingTopUp.status !== 'succeeded') {
        await this.walletService.confirmTopUp(intentId, pendingTopUp.userId);
      }
    }

    return { received: true };
  }

  /**
   * Pay for a job using credits
   */
  @Post('pay')
  @UseGuards(JwtAuthGuard)
  @UsePipes(new ValidationPipe({ transform: true }))
  async payForJob(
    @Req() req: Request,
    @Body() dto: PayForJobDto,
  ) {
    const user = req.user as AuthUser;

    const result = await this.walletService.payForJob(user.userId, {
      jobId: dto.jobId,
      amount: dto.amount,
      description: `Payment for 3D print job ${dto.jobId}`,
    });

    return {
      success: true,
      message: `Successfully paid ${dto.amount} TND for job`,
      data: result,
    };
  }

  /**
   * Check if user has enough credits for an amount
   */
  @Post('check-balance')
  @UseGuards(JwtAuthGuard)
  @UsePipes(new ValidationPipe({ transform: true }))
  async checkBalance(
    @Req() req: Request,
    @Body('amount') amount: number,
  ) {
    const user = req.user as AuthUser;

    if (!amount || amount <= 0) {
      throw new BadRequestException('Amount must be greater than 0');
    }

    const hasEnough = await this.walletService.hasEnoughCredits(user.userId, amount);
    const wallet = await this.walletService.getWallet(user.userId);

    return {
      hasEnough,
      requiredAmount: amount,
      availableBalance: wallet.balance,
      shortfall: hasEnough ? 0 : amount - wallet.balance,
    };
  }

  /**
   * Owner payout/withdrawal
   */
  @Post('payout')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('OWNER')
  @UsePipes(new ValidationPipe({ transform: true }))
  async createPayout(
    @Req() req: Request,
    @Body() dto: PayoutDto,
  ) {
    const user = req.user as AuthUser;

    if (!dto.amount || dto.amount <= 0) {
      throw new BadRequestException('Amount must be greater than 0');
    }

    // Check balance
    const wallet = await this.walletService.getWallet(user.userId);
    if (wallet.balance < dto.amount) {
      throw new BadRequestException(
        `Insufficient balance. Available: ${wallet.balance} TND, Requested: ${dto.amount} TND`,
      );
    }

    // Create NexaPay payout
    const amountInMillimes = Math.round(dto.amount * 1000);
    const payout = await this.nexaPayService.createPayout(
      amountInMillimes,
      dto.destination,
    );

    // Deduct from wallet
    await this.walletService.deductForPayout(user.userId, dto.amount, payout.payout_id);

    return {
      success: true,
      message: `Withdrawal of ${dto.amount} TND initiated`,
      data: {
        payoutId: payout.payout_id,
        status: payout.status,
        amount: dto.amount,
        destination: dto.destination,
      },
    };
  }
}
