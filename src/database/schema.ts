import { pgTable,pgEnum, uuid, text, timestamp, boolean,index,uniqueIndex,varchar,inet } from 'drizzle-orm/pg-core';
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
  
export const pairingStatusEnum = pgEnum('pairing_status', ['pending', 'approved', 'expired', 'consumed']);

export const agentPairings = pgTable('agent_pairings', {
  id: uuid('id').defaultRandom().primaryKey(),
  code: varchar('code', { length: 10 }).notNull(),
  status: pairingStatusEnum('status').default('pending').notNull(),
  ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'cascade' }), // NULLABLE - set on approve
  sessionId: uuid('session_id').references(() => userSessions.id, { onDelete: 'cascade' }), // NEW - set on consume
  agentName: varchar('agent_name', { length: 255 }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('agent_pairings_code_idx').on(table.code),
  index('agent_pairings_status_idx').on(table.status),
  index('agent_pairings_expires_at_idx').on(table.expiresAt),
  index('agent_pairings_owner_id_idx').on(table.ownerId), // NEW
]);

export const agentPairingAudit = pgTable('agent_pairing_audit', {
  id: uuid('id').defaultRandom().primaryKey(),
  pairingId: uuid('pairing_id').notNull().references(() => agentPairings.id, { onDelete: 'cascade' }),
  action: varchar('action', { length: 50 }).notNull(), // 'created', 'approved', 'consumed', etc
  actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }), // NULLABLE
  actorType: varchar('actor_type', { length: 20 }).notNull(), // 'agent', 'owner', 'system'
  ipAddress: inet('ip_address'),
  userAgent: text('user_agent'),
  metadata: text('metadata'), // JSON as text
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('audit_pairing_id_idx').on(table.pairingId),
  index('audit_action_idx').on(table.action),
  index('audit_created_at_idx').on(table.createdAt),
]);