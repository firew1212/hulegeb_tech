import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationsPaginationDto } from './notifications.dto.js';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  listNotifications(userId: string, pagination: NotificationsPaginationDto) {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (pagination.page - 1) * pagination.limit,
      take: pagination.limit,
    });
  }

  async markNotificationAsRead(userId: string, notificationId: string) {
    await this.prisma.notification.updateMany({
      where: { id: notificationId, userId, readAt: null },
      data: { readAt: new Date() },
    });

    const notification = await this.prisma.notification.findFirst({
      where: { id: notificationId, userId },
    });
    if (!notification) {
      throw new NotFoundException('Notification was not found.');
    }
    return notification;
  }
}
