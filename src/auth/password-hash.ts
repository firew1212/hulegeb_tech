import * as bcrypt from 'bcryptjs';
import { BadRequestException } from '@nestjs/common';

const BCRYPT_ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
  if (Buffer.byteLength(password, 'utf8') > 72) {
    throw new BadRequestException('Password must not exceed 72 UTF-8 bytes.');
  }
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}
