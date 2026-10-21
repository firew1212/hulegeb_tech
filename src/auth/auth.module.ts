import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AuthController } from './auth.controller.js';
import { AuthDeliveryService } from './auth-delivery.service.js';
import { AuthService } from './auth.service.js';
import { AuthenticationGuard } from './authentication.guard.js';

@Module({
  imports: [
    PrismaModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.getOrThrow<string>('JWT_ACCESS_SECRET');
        if (secret.length < 32) {
          throw new Error('JWT_ACCESS_SECRET must be at least 32 characters.');
        }
        return { secret, signOptions: { expiresIn: '15m' } };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, AuthDeliveryService, AuthenticationGuard],
  exports: [AuthService, AuthenticationGuard, JwtModule],
})
export class AuthModule {}
