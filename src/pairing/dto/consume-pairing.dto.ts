export class ConsumePairingDto {
  status?: 'already_consumed';
  accessToken?: string;
  refreshToken?: string;
  user?: {
    id: string;
    email: string;
    name: string;
    role: string;
  };
}
