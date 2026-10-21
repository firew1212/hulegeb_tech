import { Module } from '@nestjs/common';
import { AuthorizationService } from './authorization.service.js';
import { RolesGuard } from './roles.guard.js';

@Module({
  providers: [AuthorizationService, RolesGuard],
  exports: [AuthorizationService, RolesGuard],
})
export class AuthorizationModule {}
