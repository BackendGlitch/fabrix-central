import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { agents } from '../database/schema';
import { eq, and } from 'drizzle-orm';
import { AgentResponseDto, UpdateAgentNameDto } from './dto';

@Injectable()
export class AgentsService {
  constructor(private readonly db: DatabaseService) {}

  async listOwnerAgents(ownerId: string): Promise<AgentResponseDto[]> {
    const ownerAgents = await this.db.db
      .select()
      .from(agents)
      .where(eq(agents.ownerId, ownerId));

    return ownerAgents.map((agent) => this.mapToDto(agent));
  }

  async getAgentById(agentId: string, ownerId: string): Promise<AgentResponseDto> {
    const agent = await this.db.db
      .select()
      .from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.ownerId, ownerId)))
      .limit(1);

    if (!agent || agent.length === 0) {
      throw new NotFoundException(`Agent ${agentId} not found`);
    }

    return this.mapToDto(agent[0]);
  }

  async createAgent(
    ownerId: string,
    nodeId: string,
    model?: string,
    displayName?: string,
  ): Promise<AgentResponseDto> {
    const existingAgent = await this.db.db
      .select()
      .from(agents)
      .where(and(eq(agents.ownerId, ownerId), eq(agents.nodeId, nodeId)))
      .limit(1);

    if (existingAgent && existingAgent.length > 0) {
      const agent = existingAgent[0];
      // If it's already active/paired/online, throw error
      if (agent.status !== 'revoked') {
        throw new BadRequestException(
          `Agent with node ID ${nodeId} already exists for this owner`,
        );
      }
      // Otherwise, update the revoked agent to active again
      const [updated] = await this.db.db
        .update(agents)
        .set({
          status: 'paired',
          displayName: displayName || nodeId,
          model,
        })
        .where(eq(agents.id, agent.id))
        .returning();
      return this.mapToDto(updated);
    }

    const [newAgent] = await this.db.db
      .insert(agents)
      .values({
        ownerId,
        nodeId,
        model,
        displayName: displayName || nodeId,
        status: 'paired',
      })
      .returning();

    return this.mapToDto(newAgent);
  }

  async updateAgentName(
    agentId: string,
    ownerId: string,
    updateDto: UpdateAgentNameDto,
  ): Promise<AgentResponseDto> {
    const agent = await this.db.db
      .select()
      .from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.ownerId, ownerId)))
      .limit(1);

    if (!agent || agent.length === 0) {
      throw new NotFoundException(`Agent ${agentId} not found`);
    }

    const [updated] = await this.db.db
      .update(agents)
      .set({ displayName: updateDto.displayName })
      .where(eq(agents.id, agentId))
      .returning();

    return this.mapToDto(updated);
  }

  async updateAgentStatus(
    agentId: string,
    status: 'online' | 'offline' | 'paired' | 'revoked',
    lastSeenAt?: Date,
  ): Promise<AgentResponseDto> {
    const updateData: any = { status };
    if (lastSeenAt) {
      updateData.lastSeenAt = lastSeenAt;
    }

    // First check if agent exists
    const existingAgent = await this.db.db
      .select()
      .from(agents)
      .where(eq(agents.id, agentId))
      .limit(1);

    if (!existingAgent || existingAgent.length === 0) {
      throw new NotFoundException(`Agent ${agentId} not found for update`);
    }

    try {
      const [updated] = await this.db.db
        .update(agents)
        .set(updateData)
        .where(eq(agents.id, agentId))
        .returning();

      if (!updated) {
        throw new NotFoundException(`Agent ${agentId} not found after update`);
      }

      return this.mapToDto(updated);
    } catch (error: any) {
      console.error(`[AgentsService] Update error for agent ${agentId}:`, error);
      throw error;
    }
  }

  async updateAgentLastSeen(agentId: string, lastSeenAt: Date): Promise<void> {
    await this.db.db
      .update(agents)
      .set({ lastSeenAt, status: 'online' })
      .where(eq(agents.id, agentId));
  }

  async revokeAgent(agentId: string, ownerId: string): Promise<void> {
    const agent = await this.db.db
      .select()
      .from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.ownerId, ownerId)))
      .limit(1);

    if (!agent || agent.length === 0) {
      throw new NotFoundException(`Agent ${agentId} not found`);
    }

    await this.db.db
      .update(agents)
      .set({ status: 'revoked' })
      .where(eq(agents.id, agentId));
  }

  async getAgentByNodeId(nodeId: string): Promise<any> {
    const agent = await this.db.db
      .select()
      .from(agents)
      .where(eq(agents.nodeId, nodeId))
      .limit(1);

    return agent && agent.length > 0 ? agent[0] : null;
  }

  private mapToDto(agent: any): AgentResponseDto {
    return {
      id: agent.id,
      nodeId: agent.nodeId,
      displayName: agent.displayName,
      model: agent.model,
      status: agent.status,
      lastSeenAt: agent.lastSeenAt?.toISOString(),
      createdAt: agent.createdAt?.toISOString(),
      updatedAt: agent.updatedAt?.toISOString(),
    };
  }
}
