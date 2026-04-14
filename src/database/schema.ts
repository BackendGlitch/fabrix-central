import { pgTable,pgEnum, uuid, text, timestamp, boolean,index,uniqueIndex,varchar,inet } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { ref } from 'process';
import { createDeflate } from 'zlib';

export const healthCheck = pgTable('health_check', {
  id: uuid('id').defaultRandom().primaryKey(),
  checkedAt: timestamp('checked_at').defaultNow().notNull(),
  status: text('status').notNull(),
});


export const userRoleEnum = pgEnum('user_role',['OWNER','CUSTOMER','ADMIN']);

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: varchar('email', { length: 255 }).notNull(),
  passwordHash: text('password_hash').notNull(),
  name: varchar('name', { length: 120 }).notNull(),
  role: userRoleEnum('role').notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at',{withTimezone : true}).defaultNow().notNull(),
  updatedAt: timestamp('updated_at',{withTimezone : true}).defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex('users_email_idx').on(table.email),
  index('users_role_idx').on(table.role),
]);

export const userSessions = pgTable('user_sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId : uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  hashedRefreshToken: text('hashed_refresh_token').notNull(),
  userAgent: text('user_agent'),
  ipAdress: inet('ip_address'),

  expiredAt : timestamp('expried_at',{withTimezone : true}).notNull(),
  createdAt : timestamp('created_at',{withTimezone : true}).defaultNow().notNull(),
  revokedAt : timestamp('revoked_at',{withTimezone : true}),
}, (table) => [
  index('sessions_user_id_idx').on(table.userId),
  index('sessions_expired_at_idx').on(table.expiredAt),
]);

export const agentStatusEnum = pgEnum('agent_status', ['online', 'offline', 'paired', 'revoked']);

export const agents = pgTable('agents', {
  id: uuid('id').defaultRandom().primaryKey(),
  ownerId: uuid('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  nodeId: varchar('node_id', { length: 255 }).notNull(),
  displayName: varchar('display_name', { length: 255 }),
  model: varchar('model', { length: 255 }),
  status: agentStatusEnum('status').default('paired').notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => [
  index('agents_owner_id_idx').on(table.ownerId),
  index('agents_node_id_idx').on(table.nodeId),
  index('agents_status_idx').on(table.status),
  uniqueIndex('agents_owner_node_unique_idx').on(table.ownerId, table.nodeId),
]);

export const agentsRelations = relations(agents, ({ one }) => ({
  owner: one(users, {
    fields: [agents.ownerId],
    references: [users.id],
  }),
}));

export const usersRelations = relations(users, ({ many }) => ({
  agents: many(agents),
}));

// Existing tables that were already in the database - preserved as-is
// These will be synced but not modified
export const agentPairings = pgTable('agent_pairings', {
  id: uuid('id').defaultRandom().primaryKey(),
  ownerId: uuid('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const agentPairingAudit = pgTable('agent_pairing_audit', {
  id: uuid('id').defaultRandom().primaryKey(),
  pairingId: uuid('pairing_id').references(() => agentPairings.id, { onDelete: 'cascade' }),
  action: text('action'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const agentSessions = pgTable('agent_sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  agentId: uuid('agent_id'),
  status: text('status'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// Pairing codes table for agent-owner pairing flow
export const pairingCodes = pgTable('pairing_codes', {
  id: uuid('id').defaultRandom().primaryKey(),
  code: varchar('code', { length: 6 }).notNull().unique(),
  nodeId: varchar('node_id', { length: 255 }).notNull(),
  agentName: varchar('agent_name', { length: 255 }).notNull(),
  appVersion: varchar('app_version', { length: 50 }),
  status: text('status').notNull().default('pending'), // pending, approved, consumed, expired
  ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
}, (table) => [
  index('pairing_codes_code_idx').on(table.code),
  index('pairing_codes_node_id_idx').on(table.nodeId),
  index('pairing_codes_owner_id_idx').on(table.ownerId),
  index('pairing_codes_status_idx').on(table.status),
  index('pairing_codes_expires_at_idx').on(table.expiresAt),
]);
  
