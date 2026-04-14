import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AgentGateway } from './agent.gateway';
import { AgentsModule } from '../agents/agents.module';
import { ConfigService } from '@nestjs/config';

@Module({
  imports: [
    AgentsModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: '24h' },
      }),
    }),
  ],
  providers: [AgentGateway],
})
export class WsModule {}
