import { Injectable, Logger } from '@nestjs/common';
import { eq, isNull, and } from 'drizzle-orm';

import { DatabaseService } from '../database/database.service';
import { AgentGateway } from '../ws/agent.gateway';
import { agents, agentSessions, printerConfigs } from '../database/schema';
import { ListCustomerPrintersResponseDto, PrinterDto } from './dto/index';

@Injectable()
export class CustomerService {
  private readonly logger = new Logger(CustomerService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly agentGateway: AgentGateway,
  ) {}

  /**
   * Get all online/eligible printers available for customers
   * Returns only ACTIVE agents that are currently ONLINE
   */
  async listAvailablePrinters(): Promise<ListCustomerPrintersResponseDto> {
    // Fetch all active agents from all owners with their printer config
    const rows = await this.db.db
      .select({
        id: agents.id,
        nodeId: agents.nodeId,
        displayName: agents.displayName,
        status: agents.status,
        lastSeenAt: agents.lastSeenAt,
        printerConfigId: printerConfigs.id,
      })
      .from(agents)
      .leftJoin(printerConfigs, eq(printerConfigs.agentId, agents.id))
      .where(eq(agents.status, 'active'));

    // Get session metadata for each agent
    const printers: PrinterDto[] = [];

    for (const agent of rows) {
      // Get runtime state (connectivity status)
      const runtime = this.agentGateway.getAgentRuntimeState(agent.id);

      // Only include agents that are currently online
      if (!runtime.connected) {
        continue;
      }

      // Fetch options metadata from the most recent active (non-revoked) session
      let options: Record<string, unknown> | undefined;
      const session = await this.db.db
        .select({
          metadata: agentSessions.metadata,
        })
        .from(agentSessions)
        .where(
          and(
            eq(agentSessions.agentId, agent.id),
            isNull(agentSessions.revokedAt),
          ),
        )
        .orderBy(agentSessions.createdAt)
        .limit(1);

      if (session[0]?.metadata) {
        options = session[0].metadata as Record<string, unknown>;
      }

      printers.push({
        id: agent.id,
        nodeId: agent.nodeId,
        displayName: agent.displayName,
        status: 'online',
        activityState: runtime.activityState,
        lastHeartbeatAt: runtime.lastHeartbeatAt,
        options,
        printerConfigId: agent.printerConfigId ?? undefined,
      });
    }

    return {
      printers,
      count: printers.length,
    };
  }
}
