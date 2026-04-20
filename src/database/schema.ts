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
} from 'drizzle-orm/pg-core';

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
