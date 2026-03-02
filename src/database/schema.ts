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
  userAgent: text('user_agent').notNull(),
  ipAdress: inet('ip_address').notNull(),

  expiredAt : timestamp('expried_at',{withTimezone : true}).notNull(),
  createdAt : timestamp('created_at',{withTimezone : true}).defaultNow().notNull(),
  revokedAt : timestamp('revoked_at',{withTimezone : true}),
}, (table) => [
  index('sessions_user_id_idx').on(table.userId),
  index('sessions_expired_at_idx').on(table.expiredAt),
]);
  