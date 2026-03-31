import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';

import { AgentAuthService, AgentTokens } from './agent-auth.service';
import { AgentRefreshDto } from './dto/agent-refresh.dto';

@Controller('agent/auth')
export class AgentAuthController {
  constructor(private readonly agentAuth: AgentAuthService) {}

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() dto: AgentRefreshDto): Promise<AgentTokens> {
    return this.agentAuth.refresh(dto.refreshToken);
  }
}
