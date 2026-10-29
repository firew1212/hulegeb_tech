import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../authorization/current-user.decorator.js';
import type { RequestUser } from '../authorization/authorization.constants.js';
import { NotificationsPaginationDto } from './notifications.dto.js';
import { NotificationsService } from './notifications.service.js';

@ApiTags('Notifications')
@ApiBearerAuth('bearer')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  listNotifications(
    @CurrentUser() user: RequestUser,
    @Query() pagination: NotificationsPaginationDto,
  ) {
    return this.notifications.listNotifications(user.id, pagination);
  }

  @Patch(':id/read')
  markNotificationAsRead(
    @CurrentUser() user: RequestUser,
    @Param('id', new ParseUUIDPipe()) notificationId: string,
  ) {
    return this.notifications.markNotificationAsRead(user.id, notificationId);
  }
}
