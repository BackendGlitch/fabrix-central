export class PairConsumeResponseDto {
  status: string;
  accessToken?: string;
  refreshToken?: string;
  agent?: {
    id: string;
    nodeId: string;
    displayName: string;
    ownerId: string;
    ownerEmail?: string;
  };
}
