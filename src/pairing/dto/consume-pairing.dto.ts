export class ConsumePairingDto {
  status?: 'already_consumed';
  accessToken?: string;
  refreshToken?: string;
  agent?: {
    id: string;
    ownerId: string;
    nodeId: string;
    displayName: string;
  };
}
