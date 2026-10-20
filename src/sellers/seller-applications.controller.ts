import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../authorization/current-user.decorator.js';
import { RequireRoles } from '../authorization/roles.decorator.js';
import {
  RoleCode,
  type RequestUser,
} from '../authorization/authorization.constants.js';
import { SellerApplicationDto } from './seller-application.dto.js';
import { SellerApplicationsService } from './seller-applications.service.js';

@Controller('sellers/applications')
export class SellerApplicationsController {
  constructor(
    private readonly sellerApplications: SellerApplicationsService,
  ) {}

  @RequireRoles(RoleCode.BUYER)
  @Post()
  apply(
    @CurrentUser() user: RequestUser,
    @Body() input: SellerApplicationDto,
  ) {
    return this.sellerApplications.apply(user, input);
  }

  @RequireRoles(RoleCode.ADMIN)
  @Get('pending')
  listPending() {
    return this.sellerApplications.listPending();
  }

  @RequireRoles(RoleCode.ADMIN)
  @Post(':id/approve')
  approve(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.sellerApplications.approve(id);
  }

  @RequireRoles(RoleCode.ADMIN)
  @Post(':id/reject')
  reject(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.sellerApplications.reject(id);
  }
}
