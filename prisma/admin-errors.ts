export class AdminProvisioningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdminProvisioningError';
  }
}
