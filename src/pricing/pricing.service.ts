import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { eq, and, gte, sql } from 'drizzle-orm';
import * as fs from 'fs';
import * as path from 'path';

import { DatabaseService } from '../database/database.service';
import {
  jobFiles,
  printerConfigs,
  printerFilaments,
  filamentStandards,
  jobQuotes,
  platformPricing,
  agents,
} from '../database/schema';
import { FILAMENT_STANDARDS_SEED } from './seeds/filament-standards.seed';

// STL parsing types
interface STLVertex {
  x: number;
  y: number;
  z: number;
}

interface STLTriangle {
  normal: STLVertex;
  v1: STLVertex;
  v2: STLVertex;
  v3: STLVertex;
}

// Pricing calculation inputs
export interface PricingCalculationInput {
  fileId: string;
  printerConfigId?: string;
  filamentId?: string;
  scale?: number;
  quantity?: number; // For batch printing
  printSettings?: {
    infillPercent?: number;
    layerHeight?: string;
    wallCount?: number;
    supportEnabled?: boolean;
  };
}

// Detailed pricing breakdown
export interface PricingBreakdown {
  // Model metrics
  modelVolumeCm3: number;
  boundingBoxVolumeCm3: number;
  boundingBox: {
    width: number;
    height: number;
    depth: number;
  };
  filamentVolumeCm3: number;
  filamentWeightGrams: number;
  estimatedPrintTimeMinutes: number;

  // Cost breakdown
  filamentCost: number;
  machineTimeCost: number;
  supportMaterialCost: number;
  platformFee: number;
  totalPrice: number;

  // Details
  filamentType: string;
  filamentColor: string;
  currency: string;

  // Validation
  fitsOnBed: boolean;
  scaleToFit?: number; // Suggested scale if model doesn't fit
}

// Batch printing result
export interface BatchCalculationResult {
  quantity: number;
  fitsOnBed: boolean;
  arrangements: {
    x: number;
    y: number;
    rotation: number;
  }[];
  totalFilamentWeightGrams: number;
  totalPrintTimeMinutes: number;
  totalPrice: number;
  pricePerItem: number;
  recommendedScale: number;
}

@Injectable()
export class PricingService {
  private readonly logger = new Logger(PricingService.name);

  // Filament densities in g/cm³
  private readonly FILAMENT_DENSITIES: Record<string, number> = {
    PLA: 1.24,
    PETG: 1.27,
    ABS: 1.04,
    TPU: 1.21,
    ASA: 1.07,
    PC: 1.20,
    NYLON: 1.14,
    HIPS: 1.05,
    WOOD: 1.30, // Varies by wood content
    METAL_FILLED: 2.50, // Varies significantly
    CARBON_FIBER: 1.35,
    OTHER: 1.25, // Default
  };

  // Print speed factors by filament type
  private readonly PRINT_SPEED_FACTORS: Record<string, number> = {
    PLA: 1.0,
    PETG: 0.85,
    ABS: 0.8,
    TPU: 0.5,
    ASA: 0.85,
    PC: 0.7,
    NYLON: 0.75,
    HIPS: 0.9,
    WOOD: 0.7,
    METAL_FILLED: 0.6,
    CARBON_FIBER: 0.65,
    OTHER: 0.9,
  };

  constructor(private readonly db: DatabaseService) {}

  /**
   * Calculate price for a single print job
   */
  async calculatePrice(
    input: PricingCalculationInput,
  ): Promise<PricingBreakdown> {
    try {
    const {
      fileId,
      printerConfigId,
      filamentId,
      scale = 1,
      printSettings = {},
    } = input;

    this.logger.log(`[calculatePrice] Starting calculation for fileId: ${fileId}, printerConfigId: ${printerConfigId}, filamentId: ${filamentId}`);

    // Get file information
    const fileRecord = await this.db.db
      .select()
      .from(jobFiles)
      .where(eq(jobFiles.id, fileId))
      .limit(1);

    if (!fileRecord[0]) {
      throw new NotFoundException('File not found');
    }

    this.logger.log(`[calculatePrice] File found at: ${fileRecord[0].storagePath}`);

    // Parse STL to get actual mesh volume and dimensions
    const stlMetrics = await this.parseSTLFile(fileRecord[0].storagePath, scale);
    this.logger.log(`[calculatePrice] STL parsed: ${JSON.stringify(stlMetrics)}`);

    // Get printer configuration
    let printerConfig: typeof printerConfigs.$inferSelect | null = null;
    if (printerConfigId) {
      const config = await this.db.db
        .select()
        .from(printerConfigs)
        .where(eq(printerConfigs.id, printerConfigId))
        .limit(1);
      printerConfig = config[0] ?? null;
    }

    // Get filament information
    let filament: typeof printerFilaments.$inferSelect | null = null;
    let filamentType = 'PLA';
    let filamentDensity = this.FILAMENT_DENSITIES['PLA'];

    if (filamentId) {
      const filamentRecord = await this.db.db
        .select()
        .from(printerFilaments)
        .where(
          and(
            eq(printerFilaments.id, filamentId),
            eq(printerFilaments.isAvailable, true),
          ),
        )
        .limit(1);
      filament = filamentRecord[0] ?? null;
      if (filament) {
        filamentType = filament.type;
        filamentDensity = this.FILAMENT_DENSITIES[filamentType] || 1.25;
      }
    }

    // Get platform pricing settings
    const platformSettings = await this.getPlatformPricing();

    // Merge print settings with defaults
    const settings = {
      infillPercent:
        printSettings.infillPercent ??
        printerConfig?.defaultInfillPercent ??
        20,
      layerHeight:
        printSettings.layerHeight ??
        printerConfig?.defaultLayerHeight ??
        '0.2',
      wallCount:
        printSettings.wallCount ?? printerConfig?.defaultWallCount ?? 3,
      supportEnabled: printSettings.supportEnabled ?? false,
    };

    // Calculate if model fits on bed
    const bedWidth = printerConfig?.bedWidth ?? 220;
    const bedDepth = printerConfig?.bedDepth ?? 220;
    const bedHeight = printerConfig?.bedHeight ?? 250;

    const fitsOnBed =
      stlMetrics.boundingBox.width <= bedWidth &&
      stlMetrics.boundingBox.depth <= bedDepth &&
      stlMetrics.boundingBox.height <= bedHeight;

    let scaleToFit: number | undefined;
    if (!fitsOnBed) {
      // Calculate scale factor to fit
      const scaleX = bedWidth / stlMetrics.boundingBox.width;
      const scaleY = bedDepth / stlMetrics.boundingBox.depth;
      const scaleZ = bedHeight / stlMetrics.boundingBox.height;
      scaleToFit = Math.min(scaleX, scaleY, scaleZ, 1.0) * 0.95; // 5% margin
    }

    // Calculate actual filament volume needed
    // Formula accounts for:
    // 1. Shell/walls (100% density perimeter)
    // 2. Infill (configurable density for interior)
    // 3. Support material (if enabled)
    const shellThicknessMm =
      parseFloat(printerConfig?.nozzleDiameter ?? '0.4') * settings.wallCount;
    const shellVolumeCm3 = this.calculateShellVolume(
      stlMetrics.modelVolumeCm3,
      stlMetrics.boundingBoxVolumeCm3,
      stlMetrics.surfaceAreaCm2,
      shellThicknessMm,
    );

    const infillVolumeCm3 =
      (stlMetrics.modelVolumeCm3 - shellVolumeCm3) *
      (settings.infillPercent / 100);
    const totalFilamentVolumeCm3 = shellVolumeCm3 + infillVolumeCm3;

    // Calculate support material if enabled (estimate as 20-30% of model volume)
    const supportVolumeCm3 = settings.supportEnabled
      ? stlMetrics.modelVolumeCm3 * 0.25
      : 0;

    // Convert to weight
    const filamentWeightGrams =
      (totalFilamentVolumeCm3 + supportVolumeCm3) * filamentDensity;

    // Calculate print time
    const estimatedPrintTimeMinutes = this.estimatePrintTime(
      stlMetrics.modelVolumeCm3,
      stlMetrics.boundingBoxVolumeCm3,
      parseFloat(String(settings.layerHeight)),
      filamentType,
      settings.supportEnabled,
    );

    // Calculate costs
    // 1. Filament cost
    const filamentPricePerGram = filament
      ? parseFloat(filament.pricePerGram)
      : this.getDefaultFilamentPrice(filamentType);
    const filamentCost = filamentWeightGrams * filamentPricePerGram;

    // 2. Support material cost (same price as main filament)
    const supportMaterialCost = settings.supportEnabled
      ? supportVolumeCm3 * filamentDensity * filamentPricePerGram
      : 0;

    // 3. Machine time cost
    const hourlyRate = printerConfig
      ? parseFloat(printerConfig.hourlyRate)
      : 6.0; // Default 6 TND/hour (~2 USD equivalent for Tunisian market)
    const machineTimeCost = (estimatedPrintTimeMinutes / 60) * hourlyRate;

    // 4. Platform fee (percentage of filament + machine time)
    const subtotal = filamentCost + supportMaterialCost + machineTimeCost;
    let platformFee =
      subtotal * (platformSettings.platformFeePercent / 100);
    platformFee = Math.max(
      platformFee,
      parseFloat(platformSettings.minPlatformFee),
    );

    const totalPrice = subtotal + platformFee;

    return {
      modelVolumeCm3: stlMetrics.modelVolumeCm3,
      boundingBoxVolumeCm3: stlMetrics.boundingBoxVolumeCm3,
      boundingBox: stlMetrics.boundingBox,
      filamentVolumeCm3: totalFilamentVolumeCm3,
      filamentWeightGrams: Math.ceil(filamentWeightGrams * 100) / 100,
      estimatedPrintTimeMinutes: Math.ceil(estimatedPrintTimeMinutes),
      filamentCost: Math.round(filamentCost * 100) / 100,
      machineTimeCost: Math.round(machineTimeCost * 100) / 100,
      supportMaterialCost: Math.round(supportMaterialCost * 100) / 100,
      platformFee: Math.round(platformFee * 100) / 100,
      totalPrice: Math.round(totalPrice * 100) / 100,
      filamentType: filament?.type ?? 'PLA',
      filamentColor: filament?.color ?? 'Generic',
      currency: this.DEFAULT_CURRENCY,
      fitsOnBed,
      scaleToFit,
    };
    } catch (error) {
      this.logger.error(`[calculatePrice] Error: ${error instanceof Error ? error.message : 'Unknown error'}`, error instanceof Error ? error.stack : '');
      throw error;
    }
  }

  /**
   * Calculate batch printing for multiple copies
   */
  async calculateBatchPrice(
    input: PricingCalculationInput,
  ): Promise<BatchCalculationResult> {
    const singlePrint = await this.calculatePrice(input);

    const quantity = input.quantity ?? 1;
    if (quantity <= 1) {
      return {
        quantity: 1,
        fitsOnBed: true,
        arrangements: [{ x: 0, y: 0, rotation: 0 }],
        totalFilamentWeightGrams: singlePrint.filamentWeightGrams,
        totalPrintTimeMinutes: singlePrint.estimatedPrintTimeMinutes,
        totalPrice: singlePrint.totalPrice,
        pricePerItem: singlePrint.totalPrice,
        recommendedScale: 1.0,
      };
    }

    // Get printer bed dimensions
    let bedWidth = 220;
    let bedDepth = 220;

    if (input.printerConfigId) {
      const config = await this.db.db
        .select()
        .from(printerConfigs)
        .where(eq(printerConfigs.id, input.printerConfigId))
        .limit(1);
      if (config[0]) {
        bedWidth = config[0].bedWidth;
        bedDepth = config[0].bedDepth;
      }
    }

    // Calculate how many fit on bed using simple grid packing
    const modelWidth = singlePrint.boundingBox.width;
    const modelDepth = singlePrint.boundingBox.depth;

    // Add margin for spacing between models
    const margin = 10; // 10mm margin between models
    const effectiveWidth = modelWidth + margin;
    const effectiveDepth = modelDepth + margin;

    const cols = Math.floor(bedWidth / effectiveWidth);
    const rows = Math.floor(bedDepth / effectiveDepth);
    const perBed = cols * rows;

    // If models don't fit, suggest scaling down
    let recommendedScale = 1.0;
    let fitsOnBed = perBed >= quantity;

    if (!fitsOnBed && perBed > 0) {
      // Calculate max scale that would fit all
      const maxWidthPerItem = (bedWidth - margin) / cols - margin;
      const maxDepthPerItem = (bedDepth - margin) / rows - margin;
      recommendedScale = Math.min(
        maxWidthPerItem / modelWidth,
        maxDepthPerItem / modelDepth,
        1.0,
      );
    }

    // Generate arrangements for the quantity that fit
    const arrangements: { x: number; y: number; rotation: number }[] = [];
    const itemsToArrange = Math.min(quantity, perBed);

    for (let i = 0; i < itemsToArrange; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      arrangements.push({
        x: col * effectiveWidth + margin / 2,
        y: row * effectiveDepth + margin / 2,
        rotation: 0,
      });
    }

    // Calculate total filament and time
    // Batch printing has some efficiency gains (less startup overhead)
    const batchEfficiencyFactor = 0.95; // 5% more efficient per item in batch
    const totalFilamentWeightGrams =
      singlePrint.filamentWeightGrams * quantity;
    const totalPrintTimeMinutes =
      singlePrint.estimatedPrintTimeMinutes *
      (quantity > perBed ? quantity : 1) *
      (quantity <= perBed ? batchEfficiencyFactor : 1);

    // Calculate total price with bulk discount
    const platformSettings = await this.getPlatformPricing();
    let discountPercent = 0;
    if (
      platformSettings.bulkDiscountThreshold &&
      platformSettings.bulkDiscountPercent &&
      quantity >= platformSettings.bulkDiscountThreshold
    ) {
      discountPercent = platformSettings.bulkDiscountPercent;
    }

    const basePrice = singlePrint.totalPrice * quantity;
    const discountAmount = basePrice * (discountPercent / 100);
    const totalPrice = basePrice - discountAmount;

    return {
      quantity,
      fitsOnBed,
      arrangements,
      totalFilamentWeightGrams: Math.ceil(totalFilamentWeightGrams * 100) / 100,
      totalPrintTimeMinutes: Math.ceil(totalPrintTimeMinutes),
      totalPrice: Math.round(totalPrice * 100) / 100,
      pricePerItem: Math.round((totalPrice / quantity) * 100) / 100,
      recommendedScale,
    };
  }

  /**
   * Create and save a price quote
   */
  async createQuote(
    input: PricingCalculationInput,
    expiresInMinutes = 60,
  ): Promise<string> {
    const breakdown = await this.calculatePrice(input);

    const quote = await this.db.db
      .insert(jobQuotes)
      .values({
        fileId: input.fileId,
        printerConfigId: input.printerConfigId ?? null,
        filamentId: input.filamentId ?? null,
        scale: String(input.scale ?? 1.0),
        infillPercent: input.printSettings?.infillPercent ?? 20,
        layerHeight: input.printSettings?.layerHeight ?? '0.2',
        wallCount: input.printSettings?.wallCount ?? 3,
        supportEnabled: input.printSettings?.supportEnabled ?? false,
        modelVolumeCm3: String(breakdown.modelVolumeCm3),
        boundingBoxVolumeCm3: String(breakdown.boundingBoxVolumeCm3),
        filamentVolumeCm3: String(breakdown.filamentVolumeCm3),
        filamentWeightGrams: String(breakdown.filamentWeightGrams),
        estimatedPrintTimeMinutes: breakdown.estimatedPrintTimeMinutes,
        filamentCost: String(breakdown.filamentCost),
        machineTimeCost: String(breakdown.machineTimeCost),
        supportMaterialCost: String(breakdown.supportMaterialCost),
        platformFee: String(breakdown.platformFee),
        totalPrice: String(breakdown.totalPrice),
        currency: breakdown.currency,
        expiresAt: new Date(Date.now() + expiresInMinutes * 60 * 1000),
      } as any)
      .returning({ id: jobQuotes.id });

    return quote[0].id;
  }

  /**
   * Get available filaments for a printer
   */
  async getAvailableFilaments(printerConfigId: string) {
    const filaments = await this.db.db
      .select({
        id: printerFilaments.id,
        type: printerFilaments.type,
        brand: printerFilaments.brand,
        color: printerFilaments.color,
        colorHex: printerFilaments.colorHex,
        pricePerGram: printerFilaments.pricePerGram,
        stockGrams: printerFilaments.stockGrams,
        nozzleTemp: printerFilaments.nozzleTemp,
        bedTemp: printerFilaments.bedTemp,
        printSpeed: printerFilaments.printSpeed,
        density: filamentStandards.density,
      })
      .from(printerFilaments)
      .leftJoin(
        filamentStandards,
        eq(printerFilaments.type, filamentStandards.type),
      )
      .where(
        and(
          eq(printerFilaments.printerConfigId, printerConfigId),
          eq(printerFilaments.isAvailable, true),
        ),
      )
      .orderBy(printerFilaments.type, printerFilaments.color);

    return filaments.map((f) => ({
      ...f,
      density: f.density
        ? parseFloat(f.density)
        : this.FILAMENT_DENSITIES[f.type] || 1.25,
    }));
  }

  /**
   * Get filament standards (platform defaults)
   * Auto-seeds if table is empty
   */
  async getFilamentStandards() {
    let standards = await this.db.db.select().from(filamentStandards).orderBy(filamentStandards.type);

    // Auto-seed if empty
    if (standards.length === 0) {
      await this.db.db.insert(filamentStandards).values(FILAMENT_STANDARDS_SEED);
      standards = await this.db.db.select().from(filamentStandards).orderBy(filamentStandards.type);
    }

    return standards;
  }

  // ===== OWNER MANAGEMENT METHODS =====

  /**
   * Get or create printer config for an agent
   */
  async getOrCreatePrinterConfig(agentId: string, ownerId: string) {
    // Check if agent exists and belongs to owner
    const agent = await this.db.db
      .select()
      .from(agents)
      .where(eq(agents.id, agentId))
      .limit(1);

    if (!agent[0] || agent[0].ownerId !== ownerId) {
      throw new NotFoundException('Agent not found or access denied');
    }

    // Check if config exists
    let config = await this.db.db
      .select()
      .from(printerConfigs)
      .where(eq(printerConfigs.agentId, agentId))
      .limit(1);

    if (config[0]) {
      return config[0];
    }

    // Create default config
    const newConfig = await this.db.db
      .insert(printerConfigs)
      .values({
        agentId,
        bedWidth: 220,
        bedDepth: 220,
        bedHeight: 250,
        nozzleDiameter: '0.4',
        hourlyRate: '6.00',
        defaultLayerHeight: '0.2',
        defaultInfillPercent: 20,
        defaultWallCount: 3,
        supportsMultiMaterial: false,
        hasHeatedBed: true,
        maxNozzleTemp: 300,
        maxBedTemp: 110,
        isActive: true,
      })
      .returning();

    return newConfig[0];
  }

  /**
   * Save printer configuration
   */
  async savePrinterConfig(
    agentId: string,
    ownerId: string,
    dto: {
      bedWidth?: number;
      bedDepth?: number;
      bedHeight?: number;
      nozzleDiameter?: string;
      hourlyRate?: string;
      defaultLayerHeight?: string;
      defaultInfillPercent?: number;
      defaultWallCount?: number;
      supportsMultiMaterial?: boolean;
      hasHeatedBed?: boolean;
      maxNozzleTemp?: number;
      maxBedTemp?: number;
    },
  ) {
    // Verify ownership
    const agent = await this.db.db
      .select()
      .from(agents)
      .where(eq(agents.id, agentId))
      .limit(1);

    if (!agent[0] || agent[0].ownerId !== ownerId) {
      throw new NotFoundException('Agent not found or access denied');
    }

    // Get existing config or create new
    const existing = await this.db.db
      .select({ id: printerConfigs.id })
      .from(printerConfigs)
      .where(eq(printerConfigs.agentId, agentId))
      .limit(1);

    if (existing[0]) {
      // Update existing
      const updated = await this.db.db
        .update(printerConfigs)
        .set({
          ...dto,
          updatedAt: new Date(),
        })
        .where(eq(printerConfigs.id, existing[0].id))
        .returning();
      return updated[0];
    } else {
      // Create new
      const created = await this.db.db
        .insert(printerConfigs)
        .values({
          agentId,
          bedWidth: dto.bedWidth ?? 220,
          bedDepth: dto.bedDepth ?? 220,
          bedHeight: dto.bedHeight ?? 250,
          nozzleDiameter: dto.nozzleDiameter ?? '0.4',
          hourlyRate: dto.hourlyRate ?? '6.00',
          defaultLayerHeight: dto.defaultLayerHeight ?? '0.2',
          defaultInfillPercent: dto.defaultInfillPercent ?? 20,
          defaultWallCount: dto.defaultWallCount ?? 3,
          supportsMultiMaterial: dto.supportsMultiMaterial ?? false,
          hasHeatedBed: dto.hasHeatedBed ?? true,
          maxNozzleTemp: dto.maxNozzleTemp ?? 300,
          maxBedTemp: dto.maxBedTemp ?? 110,
          isActive: true,
        })
        .returning();
      return created[0];
    }
  }

  /**
   * Add filament to printer inventory
   */
  async addFilament(
    printerConfigId: string,
    dto: {
      type: string;
      brand?: string;
      color: string;
      colorHex?: string;
      pricePerGram: string;
      stockGrams?: number;
      nozzleTemp?: number;
      bedTemp?: number;
      printSpeed?: number;
      notes?: string;
    },
  ) {
    const filament = await this.db.db
      .insert(printerFilaments)
      .values({
        printerConfigId,
        type: dto.type as any,
        brand: dto.brand ?? null,
        color: dto.color,
        colorHex: dto.colorHex ?? null,
        pricePerGram: dto.pricePerGram,
        stockGrams: dto.stockGrams ?? null,
        nozzleTemp: dto.nozzleTemp ?? null,
        bedTemp: dto.bedTemp ?? null,
        printSpeed: dto.printSpeed ?? null,
        notes: dto.notes ?? null,
        isAvailable: true,
      })
      .returning();

    return filament[0];
  }

  /**
   * Update filament
   */
  async updateFilament(
    filamentId: string,
    dto: {
      brand?: string;
      color?: string;
      colorHex?: string;
      pricePerGram?: string;
      stockGrams?: number;
      isAvailable?: boolean;
      nozzleTemp?: number;
      bedTemp?: number;
      printSpeed?: number;
      notes?: string;
    },
  ) {
    const updated = await this.db.db
      .update(printerFilaments)
      .set({
        ...dto,
        updatedAt: new Date(),
      })
      .where(eq(printerFilaments.id, filamentId))
      .returning();

    if (!updated[0]) {
      throw new NotFoundException('Filament not found');
    }

    return updated[0];
  }

  /**
   * Delete filament
   */
  async deleteFilament(filamentId: string) {
    const result = await this.db.db
      .delete(printerFilaments)
      .where(eq(printerFilaments.id, filamentId))
      .returning({ id: printerFilaments.id });

    if (!result[0]) {
      throw new NotFoundException('Filament not found');
    }
  }

  /**
   * Update printer configuration by ID
   */
  async updatePrinterConfig(
    printerConfigId: string,
    dto: {
      bedWidth?: number;
      bedDepth?: number;
      bedHeight?: number;
      nozzleDiameter?: string;
      hourlyRate?: string;
      defaultLayerHeight?: string;
      defaultInfillPercent?: number;
      defaultWallCount?: number;
      supportsMultiMaterial?: boolean;
      hasHeatedBed?: boolean;
      maxNozzleTemp?: number;
      maxBedTemp?: number;
      capabilities?: Record<string, unknown>;
      isActive?: boolean;
    },
  ) {
    const updated = await this.db.db
      .update(printerConfigs)
      .set({
        ...dto,
        updatedAt: new Date(),
      })
      .where(eq(printerConfigs.id, printerConfigId))
      .returning();

    if (!updated[0]) {
      throw new NotFoundException('Printer configuration not found');
    }

    return updated[0];
  }

  // ===== PRIVATE HELPER METHODS =====

  private async getPlatformPricing() {
    const settings = await this.db.db
      .select()
      .from(platformPricing)
      .limit(1);

    if (settings[0]) {
      return settings[0];
    }

    // Create default settings if none exist (TND pricing)
    const defaultSettings = await this.db.db
      .insert(platformPricing)
      .values({
        platformFeePercent: 15,
        minPlatformFee: '3.00', // 3 TND minimum
      })
      .returning();

    return defaultSettings[0];
  }

  private readonly DEFAULT_CURRENCY = 'TND';

  private getDefaultFilamentPrice(type: string): number {
    // Default prices per gram in TND (Tunisian Dinar) for local market
    const defaultPrices: Record<string, number> = {
      PLA: 0.08,       // ~80 TND/kg
      PETG: 0.10,      // ~100 TND/kg
      ABS: 0.09,       // ~90 TND/kg
      TPU: 0.18,       // ~180 TND/kg (specialty)
      ASA: 0.12,       // ~120 TND/kg
      PC: 0.20,        // ~200 TND/kg
      NYLON: 0.25,     // ~250 TND/kg
      HIPS: 0.08,      // ~80 TND/kg
      WOOD: 0.15,      // ~150 TND/kg
      METAL_FILLED: 0.50,    // ~500 TND/kg (premium)
      CARBON_FIBER: 0.35,    // ~350 TND/kg (premium)
      OTHER: 0.10,     // ~100 TND/kg
    };
    return defaultPrices[type] || 0.10; // Default 0.10 TND/g (~100 TND/kg)
  }

  private async parseSTLFile(
    filePath: string,
    scale: number,
  ): Promise<{
    modelVolumeCm3: number;
    boundingBoxVolumeCm3: number;
    boundingBox: { width: number; height: number; depth: number };
    surfaceAreaCm2: number;
  }> {
    try {
      // Check if file exists
      if (!fs.existsSync(filePath)) {
        throw new Error(`STL file not found at path: ${filePath}`);
      }
      const buffer = fs.readFileSync(filePath);
      const triangles = this.parseSTLBuffer(buffer);

      // Calculate bounding box
      let minX = Infinity,
        maxX = -Infinity;
      let minY = Infinity,
        maxY = -Infinity;
      let minZ = Infinity,
        maxZ = -Infinity;

      for (const tri of triangles) {
        for (const v of [tri.v1, tri.v2, tri.v3]) {
          minX = Math.min(minX, v.x);
          maxX = Math.max(maxX, v.x);
          minY = Math.min(minY, v.y);
          maxY = Math.max(maxY, v.y);
          minZ = Math.min(minZ, v.z);
          maxZ = Math.max(maxZ, v.z);
        }
      }

      // Apply scale
      const width = (maxX - minX) * scale;
      const height = (maxY - minY) * scale;
      const depth = (maxZ - minZ) * scale;

      const boundingBoxVolumeCm3 = (width * height * depth) / 1000; // Convert mm³ to cm³

      // Calculate actual mesh volume using tetrahedron method
      let modelVolumeMm3 = 0;
      let surfaceAreaMm2 = 0;

      for (const tri of triangles) {
        // Volume contribution (tetrahedron from triangle to origin)
        const v1 = { x: tri.v1.x * scale, y: tri.v1.y * scale, z: tri.v1.z * scale };
        const v2 = { x: tri.v2.x * scale, y: tri.v2.y * scale, z: tri.v2.z * scale };
        const v3 = { x: tri.v3.x * scale, y: tri.v3.y * scale, z: tri.v3.z * scale };

        const vol =
          Math.abs(
            v1.x * (v2.y * v3.z - v2.z * v3.y) -
              v1.y * (v2.x * v3.z - v2.z * v3.x) +
              v1.z * (v2.x * v3.y - v2.y * v3.x),
          ) / 6;
        modelVolumeMm3 += vol;

        // Surface area
        const a = Math.sqrt(
          Math.pow(v2.x - v1.x, 2) +
            Math.pow(v2.y - v1.y, 2) +
            Math.pow(v2.z - v1.z, 2),
        );
        const b = Math.sqrt(
          Math.pow(v3.x - v2.x, 2) +
            Math.pow(v3.y - v2.y, 2) +
            Math.pow(v3.z - v2.z, 2),
        );
        const c = Math.sqrt(
          Math.pow(v1.x - v3.x, 2) +
            Math.pow(v1.y - v3.y, 2) +
            Math.pow(v1.z - v3.z, 2),
        );
        const s = (a + b + c) / 2;
        surfaceAreaMm2 += Math.sqrt(s * (s - a) * (s - b) * (s - c));
      }

      const modelVolumeCm3 = modelVolumeMm3 / 1000;
      const surfaceAreaCm2 = surfaceAreaMm2 / 100;

      return {
        modelVolumeCm3: Math.abs(modelVolumeCm3),
        boundingBoxVolumeCm3,
        boundingBox: {
          width: Math.abs(width),
          height: Math.abs(height),
          depth: Math.abs(depth),
        },
        surfaceAreaCm2,
      };
    } catch (error) {
      this.logger.error('Failed to parse STL file:', error);
      // Return conservative estimate based on dimensions if parsing fails
      return {
        modelVolumeCm3: 0,
        boundingBoxVolumeCm3: 0,
        boundingBox: { width: 0, height: 0, depth: 0 },
        surfaceAreaCm2: 0,
      };
    }
  }

  private parseSTLBuffer(buffer: Buffer): STLTriangle[] {
    const triangles: STLTriangle[] = [];

    // Check if binary or ASCII
    const isBinary = this.isBinarySTL(buffer);

    if (isBinary) {
      // Binary format
      const triangleCount = buffer.readUInt32LE(80);
      let offset = 84;

      for (let i = 0; i < triangleCount; i++) {
        if (offset + 50 > buffer.length) break;

        const normal = {
          x: buffer.readFloatLE(offset),
          y: buffer.readFloatLE(offset + 4),
          z: buffer.readFloatLE(offset + 8),
        };
        offset += 12;

        const v1 = {
          x: buffer.readFloatLE(offset),
          y: buffer.readFloatLE(offset + 4),
          z: buffer.readFloatLE(offset + 8),
        };
        offset += 12;

        const v2 = {
          x: buffer.readFloatLE(offset),
          y: buffer.readFloatLE(offset + 4),
          z: buffer.readFloatLE(offset + 8),
        };
        offset += 12;

        const v3 = {
          x: buffer.readFloatLE(offset),
          y: buffer.readFloatLE(offset + 4),
          z: buffer.readFloatLE(offset + 8),
        };
        offset += 12;

        offset += 2; // Attribute byte count

        triangles.push({ normal, v1, v2, v3 });
      }
    } else {
      // ASCII format
      const text = buffer.toString('utf-8');
      const lines = text.split('\n');
      let currentNormal = { x: 0, y: 0, z: 0 };
      let currentVertices: STLVertex[] = [];

      for (const line of lines) {
        const trimmed = line.trim().toLowerCase();

        if (trimmed.startsWith('facet normal')) {
          const parts = trimmed.split(/\s+/);
          if (parts.length >= 5) {
            currentNormal = {
              x: parseFloat(parts[2]) || 0,
              y: parseFloat(parts[3]) || 0,
              z: parseFloat(parts[4]) || 0,
            };
          }
        } else if (trimmed.startsWith('vertex')) {
          const parts = trimmed.split(/\s+/);
          if (parts.length >= 4) {
            currentVertices.push({
              x: parseFloat(parts[1]) || 0,
              y: parseFloat(parts[2]) || 0,
              z: parseFloat(parts[3]) || 0,
            });

            if (currentVertices.length === 3) {
              triangles.push({
                normal: currentNormal,
                v1: currentVertices[0],
                v2: currentVertices[1],
                v3: currentVertices[2],
              });
              currentVertices = [];
            }
          }
        }
      }
    }

    return triangles;
  }

  private isBinarySTL(buffer: Buffer): boolean {
    if (buffer.length < 84) return false;

    const triangleCount = buffer.readUInt32LE(80);
    const expectedSize = 84 + triangleCount * 50;

    // Check if file size roughly matches binary structure
    if (Math.abs(buffer.length - expectedSize) < 100) {
      return true;
    }

    // Check for ASCII indicators
    const header = buffer.toString('ascii', 0, Math.min(200, buffer.length));
    if (header.toLowerCase().includes('solid ') && header.toLowerCase().includes('facet')) {
      return false;
    }

    return true;
  }

  private calculateShellVolume(
    modelVolumeCm3: number,
    boundingBoxVolumeCm3: number,
    surfaceAreaCm2: number,
    shellThicknessMm: number,
  ): number {
    // Shell volume = surface area × shell thickness
    // This is a simplified calculation - in reality, shells also include
    // internal structures for overhangs and bridges
    const shellThicknessCm = shellThicknessMm / 10;
    const shellVolumeCm3 = surfaceAreaCm2 * shellThicknessCm * 2; // ×2 for inner and outer shells

    // Cap shell volume at 80% of model volume (conservative)
    return Math.min(shellVolumeCm3, modelVolumeCm3 * 0.8);
  }

  private estimatePrintTime(
    modelVolumeCm3: number,
    boundingBoxVolumeCm3: number,
    layerHeightMm: number,
    filamentType: string,
    supportEnabled: boolean,
  ): number {
    // Base calculation: volume / (layer_height × nozzle_speed × nozzle_width)
    const nozzleDiameter = 0.4; // mm
    const baseSpeed = 60; // mm/s
    const speedFactor = this.PRINT_SPEED_FACTORS[filamentType] || 0.9;
    const effectiveSpeed = baseSpeed * speedFactor;

    // Calculate layer count
    const avgHeightMm = Math.pow(modelVolumeCm3 * 1000, 1 / 3); // Rough estimate
    const layerCount = Math.ceil(avgHeightMm / layerHeightMm);

    // Time per layer (simplified)
    // Based on bounding box area / (speed × layer_height)
    const boundingBoxAreaMm2 = Math.pow(boundingBoxVolumeCm3 * 1000, 2 / 3);
    const timePerLayerSeconds =
      (boundingBoxAreaMm2 / (effectiveSpeed * nozzleDiameter)) * 1.5; // 1.5x factor for travel moves

    let totalSeconds = layerCount * timePerLayerSeconds;

    // Add support material time (if enabled)
    if (supportEnabled) {
      totalSeconds *= 1.3; // 30% more time for support
    }

    // Add startup and cooldown time
    totalSeconds += 600; // 10 minutes startup/cooldown

    // Minimum print time
    return Math.max(totalSeconds / 60, 15); // At least 15 minutes
  }
}
