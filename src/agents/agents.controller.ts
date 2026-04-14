import {
  Controller,
  Get,
  Put,
  Delete,
  Post,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { AgentsService } from './agents.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles, CurrentUser } from '../auth/decorators';
import { AgentResponseDto, UpdateAgentNameDto } from './dto';

interface AuthenticatedUser {
  userId: string;
  email: string;
  name: string;
  role: string;
}

@Controller('agent')
@UseGuards(JwtAuthGuard)
export class AgentsController {
  private readonly logger = new Logger(AgentsController.name);

  constructor(private readonly agentsService: AgentsService) {}

  @Get('owner/nodes')
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'ADMIN')
  async listOwnerAgents(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AgentResponseDto[]> {
    this.logger.log(`Fetching agents for user: ${user?.userId}`);
    if (!user?.userId) {
      throw new Error('User ID not found in request');
    }
    return this.agentsService.listOwnerAgents(user.userId);
  }

  @Get('owner/nodes/:nodeId')
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'ADMIN')
  async getAgent(
    @Param('nodeId') nodeId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AgentResponseDto> {
    return this.agentsService.getAgentById(nodeId, user.userId);
  }

  @Put('owner/nodes/:nodeId/name')
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'ADMIN')
  async updateAgentName(
    @Param('nodeId') nodeId: string,
    @Body() updateDto: UpdateAgentNameDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<AgentResponseDto> {
    return this.agentsService.updateAgentName(nodeId, user.userId, updateDto);
  }

  @Post('owner/nodes/:nodeId/refresh')
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  async refreshAgentLastSeen(
    @Param('nodeId') nodeId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    const agent = await this.agentsService.getAgentById(nodeId, user.userId);
    await this.agentsService.updateAgentLastSeen(agent.id, new Date());
  }

  @Delete('owner/nodes/:nodeId')
  @UseGuards(RolesGuard)
  @Roles('OWNER', 'ADMIN')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeAgent(
    @Param('nodeId') nodeId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    const agent = await this.agentsService.getAgentById(nodeId, user.userId);
    await this.agentsService.revokeAgent(agent.id, user.userId);
  }
}
