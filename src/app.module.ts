import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { WsModule } from './ws/ws.module';
import { AuthModule } from './auth/auth.module';
import { PairingModule } from './pairing/pairing.module';
import { AgentAuthModule } from './agent-auth/agent-auth.module';
import { AgentModule } from './agent/agent.module';
import { CustomerModule } from './customer/customer.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    AuthModule,
    AgentAuthModule,
    AgentModule,
    PairingModule,
    CustomerModule,
    HealthModule,
    WsModule,
  ],
})
export class AppModule {}
