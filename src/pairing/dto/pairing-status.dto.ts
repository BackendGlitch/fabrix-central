export class PairingStatusDto {
  code: string;
  status: 'pending' | 'approved' | 'expired' | 'consumed';
  expiresAt: Date;
  approvedAt?: Date;
  consumedAt?: Date;
}
