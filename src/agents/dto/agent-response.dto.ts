export class AgentResponseDto {
  id: string;
  nodeId: string;
  displayName?: string;
  model?: string;
  status: 'online' | 'offline' | 'paired' | 'revoked';
  lastSeenAt?: string;
  createdAt: string;
  updatedAt: string;
}
