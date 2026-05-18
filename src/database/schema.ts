import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  boolean,
  index,
  uniqueIndex,
  varchar,
  inet,
  jsonb,
  integer,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const healthCheck = pgTable('health_check', {
  id: uuid('id').defaultRandom().primaryKey(),
  checkedAt: timestamp('checked_at').defaultNow().notNull(),
  status: text('status').notNull(),
});

export const userRoleEnum = pgEnum('user_role', ['OWNER', 'CUSTOMER', 'ADMIN']);

export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    email: varchar('email', { length: 255 }).notNull(),
    passwordHash: text('password_hash').notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    role: userRoleEnum('role').notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    credits: integer('credits').default(0).notNull(), // Credit balance in TND (1 credit = 1 TND)
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('users_email_idx').on(table.email),
    index('users_role_idx').on(table.role),
  ],
);

export const userSessions = pgTable(
  'user_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    hashedRefreshToken: text('hashed_refresh_token').notNull(),
    userAgent: text('user_agent'),
    ipAdress: inet('ip_address'),

    expiredAt: timestamp('expried_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [
    index('sessions_user_id_idx').on(table.userId),
    index('sessions_expired_at_idx').on(table.expiredAt),
  ],
);

export const pairingStatusEnum = pgEnum('pairing_status', [
  'pending',
  'approved',
  'expired',
  'consumed',
]);
export const agentStatusEnum = pgEnum('agent_status', ['active', 'revoked']);

export const agentPairings = pgTable(
  'agent_pairings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    code: varchar('code', { length: 10 }).notNull(),
    status: pairingStatusEnum('status').default('pending').notNull(),
    ownerId: uuid('owner_id').references(() => users.id, {
      onDelete: 'cascade',
    }), // NULLABLE - set on approve
    sessionId: uuid('session_id').references(() => userSessions.id, {
      onDelete: 'cascade',
    }), // NEW - set on consume
    agentId: uuid('agent_id'),
    nodeId: varchar('node_id', { length: 255 }),
    appVersion: varchar('app_version', { length: 60 }),
    agentName: varchar('agent_name', { length: 255 }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('agent_pairings_code_idx').on(table.code),
    index('agent_pairings_status_idx').on(table.status),
    index('agent_pairings_expires_at_idx').on(table.expiresAt),
    index('agent_pairings_owner_id_idx').on(table.ownerId),
    index('agent_pairings_agent_id_idx').on(table.agentId),
  ],
);

export const agents = pgTable(
  'agents',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    nodeId: varchar('node_id', { length: 255 }).notNull(),
    displayName: varchar('display_name', { length: 255 }).notNull(),
    status: agentStatusEnum('status').default('active').notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('agents_owner_node_unique_idx').on(table.ownerId, table.nodeId),
    index('agents_owner_id_idx').on(table.ownerId),
    index('agents_status_idx').on(table.status),
    index('agents_last_seen_at_idx').on(table.lastSeenAt),
  ],
);

export const agentSessions = pgTable(
  'agent_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    hashedRefreshToken: text('hashed_refresh_token').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    metadata: jsonb('metadata')
      .$type<Record<string, unknown> | null>()
      .default(null),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [
    index('agent_sessions_agent_id_idx').on(table.agentId),
    index('agent_sessions_expires_at_idx').on(table.expiresAt),
    index('agent_sessions_revoked_at_idx').on(table.revokedAt),
  ],
);

export const agentPairingAudit = pgTable(
  'agent_pairing_audit',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    pairingId: uuid('pairing_id')
      .notNull()
      .references(() => agentPairings.id, { onDelete: 'cascade' }),
    action: varchar('action', { length: 50 }).notNull(), // 'created', 'approved', 'consumed', etc
    actorUserId: uuid('actor_user_id').references(() => users.id, {
      onDelete: 'set null',
    }), // NULLABLE
    actorType: varchar('actor_type', { length: 20 }).notNull(), // 'agent', 'owner', 'system'
    ipAddress: inet('ip_address'),
    userAgent: text('user_agent'),
    metadata: text('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('audit_pairing_id_idx').on(table.pairingId),
    index('audit_action_idx').on(table.action),
    index('audit_created_at_idx').on(table.createdAt),
  ],
);

export const jobStatusEnum = pgEnum('job_status', [
  'pending_owner_approval',
  'pending',
  'queued',
  'printing',
  'completed',
  'failed',
  'cancelled',
]);

export const jobFiles = pgTable(
  'job_files',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    filename: varchar('filename', { length: 255 }).notNull(),
    originalName: varchar('original_name', { length: 255 }).notNull(),
    mimeType: varchar('mime_type', { length: 50 }).notNull(),
    size: text('size').notNull(), // Store as text to handle large numbers
    storagePath: varchar('storage_path', { length: 512 }).notNull(),
    checksum: varchar('checksum', { length: 64 }), // SHA256 hash
    uploadedAt: timestamp('uploaded_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('job_files_uploaded_at_idx').on(table.uploadedAt),
    index('job_files_checksum_idx').on(table.checksum),
  ],
);

export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    fileId: uuid('file_id')
      .notNull()
      .references(() => jobFiles.id, { onDelete: 'cascade' }),
    printerId: uuid('printer_id').references(() => agents.id, {
      onDelete: 'set null',
    }), // NULLABLE - assigned later
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    status: jobStatusEnum('status').default('pending').notNull(),
    metadata: jsonb('metadata')
      .$type<Record<string, unknown> | null>()
      .default(null), // Print settings, etc
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('jobs_customer_id_idx').on(table.customerId),
    index('jobs_printer_id_idx').on(table.printerId),
    index('jobs_status_idx').on(table.status),
    index('jobs_created_at_idx').on(table.createdAt),
  ],
);

export const commandStateEnum = pgEnum('command_state', [
  'sent',
  'acked',
  'failed',
  'timeout',
]);

export const commandTypeEnum = pgEnum('command_type', [
  'start',
  'pause',
  'cancel',
]);

export const jobEventTypeEnum = pgEnum('job_event_type', [
  'progress',
  'completed',
  'failed',
]);

export const agentCommands = pgTable(
  'agent_commands',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    correlationId: varchar('correlation_id', { length: 36 }).notNull(), // UUID format
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    commandType: commandTypeEnum('command_type').notNull(),
    state: commandStateEnum('state').default('sent').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    errorMessage: text('error_message'),
    ackedAt: timestamp('acked_at', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('agent_commands_correlation_id_idx').on(table.correlationId),
    index('agent_commands_agent_id_idx').on(table.agentId),
    index('agent_commands_job_id_idx').on(table.jobId),
    index('agent_commands_state_idx').on(table.state),
    index('agent_commands_sent_at_idx').on(table.sentAt),
  ],
);

export const jobEvents = pgTable(
  'job_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    type: jobEventTypeEnum('type').notNull(),
    data: jsonb('data')
      .$type<Record<string, unknown>>()
      .notNull(), // Contains progress, layers, eta, error message, etc.
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('job_events_job_id_idx').on(table.jobId),
    index('job_events_created_at_idx').on(table.createdAt),
    index('job_events_type_idx').on(table.type),
  ],
);

// ===== PRICING & FILAMENT TABLES =====

export const filamentTypeEnum = pgEnum('filament_type', [
  'PLA',
  'PETG',
  'ABS',
  'TPU',
  'ASA',
  'PC',
  'NYLON',
  'HIPS',
  'WOOD',
  'METAL_FILLED',
  'CARBON_FIBER',
  'OTHER',
]);

// Standard filament properties (platform defaults)
export const filamentStandards = pgTable(
  'filament_standards',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    type: filamentTypeEnum('type').notNull().unique(),
    name: varchar('name', { length: 100 }).notNull(),
    density: text('density').notNull(), // g/cm³ (e.g., "1.24")
    defaultNozzleTemp: integer('default_nozzle_temp').notNull(), // °C
    defaultBedTemp: integer('default_bed_temp').notNull(), // °C
    defaultPrintSpeed: integer('default_print_speed').notNull(), // mm/s
    color: varchar('color', { length: 50 }), // Default color representation
    description: text('description'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('filament_standards_type_idx').on(table.type),
  ],
);

// Printer configurations (per-agent settings set by owner)
export const printerConfigs = pgTable(
  'printer_configs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' })
      .unique(),
    // Bed dimensions in mm
    bedWidth: integer('bed_width').notNull().default(220),
    bedDepth: integer('bed_depth').notNull().default(220),
    bedHeight: integer('bed_height').notNull().default(250),
    // Printer specs
    nozzleDiameter: text('nozzle_diameter').notNull().default('0.4'), // mm
    // Pricing settings
    hourlyRate: text('hourly_rate').notNull().default('6.00'), // TND/hour for machine time
    // Default print settings
    defaultLayerHeight: text('default_layer_height').notNull().default('0.2'), // mm
    defaultInfillPercent: integer('default_infill_percent').notNull().default(20),
    defaultWallCount: integer('default_wall_count').notNull().default(3),
    // Capabilities
    supportsMultiMaterial: boolean('supports_multi_material').default(false),
    hasHeatedBed: boolean('has_heated_bed').default(true),
    maxNozzleTemp: integer('max_nozzle_temp').default(300),
    maxBedTemp: integer('max_bed_temp').default(110),
    // Settings JSON for additional capabilities
    capabilities: jsonb('capabilities')
      .$type<Record<string, unknown>>()
      .default(sql`null`),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('printer_configs_agent_id_idx').on(table.agentId),
    index('printer_configs_active_idx').on(table.isActive),
  ],
);

// Printer owner's filament inventory
export const printerFilaments = pgTable(
  'printer_filaments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    printerConfigId: uuid('printer_config_id')
      .notNull()
      .references(() => printerConfigs.id, { onDelete: 'cascade' }),
    type: filamentTypeEnum('type').notNull(),
    brand: varchar('brand', { length: 100 }), // e.g., "Prusament", "eSun"
    color: varchar('color', { length: 50 }).notNull(), // e.g., "Red", "Blue", "Black"
    colorHex: varchar('color_hex', { length: 7 }), // e.g., "#FF0000"
    // Pricing (TND)
    pricePerGram: text('price_per_gram').notNull(), // e.g., "0.08" for 0.08 TND/g (~80 TND/kg)
    // Inventory
    stockGrams: integer('stock_grams'), // null = unlimited/untracked
    isAvailable: boolean('is_available').default(true).notNull(),
    // Custom settings (override defaults)
    nozzleTemp: integer('nozzle_temp'), // °C, null = use standard
    bedTemp: integer('bed_temp'), // °C, null = use standard
    printSpeed: integer('print_speed'), // mm/s, null = use standard
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('printer_filaments_config_idx').on(table.printerConfigId),
    index('printer_filaments_type_idx').on(table.type),
    index('printer_filaments_available_idx').on(table.isAvailable),
    uniqueIndex('printer_filaments_unique_variant').on(
      table.printerConfigId,
      table.type,
      table.brand,
      table.color,
    ),
  ],
);

// Job pricing quotes (calculated before job creation)
export const jobQuotes = pgTable(
  'job_quotes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    fileId: uuid('file_id')
      .notNull()
      .references(() => jobFiles.id, { onDelete: 'cascade' }),
    // Selected options
    printerConfigId: uuid('printer_config_id')
      .references(() => printerConfigs.id, { onDelete: 'set null' }),
    filamentId: uuid('filament_id')
      .references(() => printerFilaments.id, { onDelete: 'set null' }),
    // Model settings
    scale: text('scale').notNull().default('1.0'),
    infillPercent: integer('infill_percent').notNull().default(20),
    layerHeight: text('layer_height').notNull().default('0.2'),
    wallCount: integer('wall_count').notNull().default(3),
    supportEnabled: boolean('support_enabled').default(false),
    // Calculated values
    modelVolumeCm3: text('model_volume_cm3').notNull(), // Actual mesh volume
    boundingBoxVolumeCm3: text('bounding_box_volume_cm3').notNull(), // Width×Height×Depth
    filamentVolumeCm3: text('filament_volume_cm3').notNull(), // Volume accounting for infill
    filamentWeightGrams: text('filament_weight_grams').notNull(),
    estimatedPrintTimeMinutes: integer('estimated_print_time_minutes').notNull(),
    // Pricing breakdown (TND - Tunisian Dinar)
    filamentCost: text('filament_cost').notNull(), // TND amount
    machineTimeCost: text('machine_time_cost').notNull(), // TND amount
    supportMaterialCost: text('support_material_cost').default('0'), // TND amount
    platformFee: text('platform_fee').notNull(), // TND amount (our commission)
    totalPrice: text('total_price').notNull(), // TND amount
    // Currency (TND - Tunisian Dinar)
    currency: varchar('currency', { length: 3 }).notNull().default('TND'),
    // Expiration
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('job_quotes_file_id_idx').on(table.fileId),
    index('job_quotes_printer_config_idx').on(table.printerConfigId),
    index('job_quotes_expires_at_idx').on(table.expiresAt),
  ],
);

// Platform pricing settings
export const platformPricing = pgTable(
  'platform_pricing',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    platformFeePercent: integer('platform_fee_percent').notNull().default(15), // 15%
    minPlatformFee: text('min_platform_fee').notNull().default('3.00'), // Minimum 3 TND
    maxPlatformFee: text('max_platform_fee'), // Optional cap
    // Dynamic pricing multipliers
    peakHourMultiplier: text('peak_hour_multiplier').default('1.0'),
    rushJobMultiplier: text('rush_job_multiplier').default('1.5'),
    bulkDiscountThreshold: integer('bulk_discount_threshold'), // Number of items
    bulkDiscountPercent: integer('bulk_discount_percent'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
);

// ===== CREDIT SYSTEM TABLES =====

// Transaction types for credit movements
export const transactionTypeEnum = pgEnum('transaction_type', [
  'topup',           // Customer adding credits to their account
  'payment',         // Customer paying for a job
  'refund',          // Refund for cancelled job
  'payout',          // Owner receiving payment for completed job
  'platform_fee',      // Platform fee deduction
]);

// Credit transactions history
export const creditTransactions = pgTable(
  'credit_transactions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: transactionTypeEnum('type').notNull(),
    amount: integer('amount').notNull(), // Positive for credit, negative for debit
    balanceAfter: integer('balance_after').notNull(), // Balance after this transaction
    description: text('description'), // e.g., "Payment for job #123", "Top-up 50 TND"
    jobId: uuid('job_id').references(() => jobs.id, { onDelete: 'set null' }), // Optional reference to job
    metadata: jsonb('metadata'), // Additional data like payment method, receipt info
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('transactions_user_idx').on(table.userId),
    index('transactions_type_idx').on(table.type),
    index('transactions_job_idx').on(table.jobId),
    index('transactions_created_idx').on(table.createdAt),
  ],
);

// Pending top-ups table (for tracking NexaPay payment intents)
export const topupStatusEnum = pgEnum('topup_status', [
  'pending',
  'succeeded',
  'failed',
  'cancelled',
]);

export const pendingTopUps = pgTable(
  'pending_topups',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    intentId: text('intent_id').notNull().unique(), // NexaPay payment intent ID
    amount: integer('amount').notNull(), // Amount in TND (credits)
    status: topupStatusEnum('status').notNull().default('pending'),
    payUrl: text('pay_url'), // NexaPay checkout URL
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('topups_user_idx').on(table.userId),
    index('topups_intent_idx').on(table.intentId),
    index('topups_status_idx').on(table.status),
  ],
);
