import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotificationsPaginationDto } from './notifications.dto.js';
import { NotificationsService } from './notifications.service.js';

const notificationId = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
const recipientId = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';
const otherUserId = '6ba7b812-9dad-11d1-80b4-00c04fd430c8';

function createNotificationsService() {
  const findMany = vi.fn().mockResolvedValue([]);
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const findFirst = vi.fn();
  const prisma = {
    notification: { findMany, updateMany, findFirst },
  } as unknown as PrismaService;
  return {
    service: new NotificationsService(prisma),
    findMany,
    updateMany,
    findFirst,
  };
}

describe('NotificationsService', () => {
  it('lists only the recipient notifications in stable newest-first pages', async () => {
    const notifications = [{ id: notificationId }];
    const { service, findMany } = createNotificationsService();
    findMany.mockResolvedValue(notifications);

    await expect(
      service.listNotifications(recipientId, { page: 3, limit: 10 }),
    ).resolves.toBe(notifications);
    expect(findMany).toHaveBeenCalledWith({
      where: { userId: recipientId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: 20,
      take: 10,
    });
  });

  it('uses the bounded pagination defaults', () => {
    expect(new NotificationsPaginationDto()).toMatchObject({
      page: 1,
      limit: 20,
    });
  });

  it('marks an unread notification and returns it', async () => {
    const readAt = new Date('2026-10-24T12:00:00.000Z');
    const notification = { id: notificationId, userId: recipientId, readAt };
    const { service, updateMany, findFirst } = createNotificationsService();
    findFirst.mockResolvedValue(notification);

    await expect(
      service.markNotificationAsRead(recipientId, notificationId),
    ).resolves.toBe(notification);

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: notificationId, userId: recipientId, readAt: null },
      data: { readAt: expect.any(Date) },
    });
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: notificationId, userId: recipientId },
    });
  });

  it('is idempotent and keeps the original read timestamp', async () => {
    const originalReadAt = new Date('2026-10-23T12:00:00.000Z');
    const notification = {
      id: notificationId,
      userId: recipientId,
      readAt: originalReadAt,
    };
    const { service, updateMany, findFirst } = createNotificationsService();
    updateMany.mockResolvedValue({ count: 0 });
    findFirst.mockResolvedValue(notification);

    await expect(
      service.markNotificationAsRead(recipientId, notificationId),
    ).resolves.toBe(notification);

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: notificationId, userId: recipientId, readAt: null },
      data: { readAt: expect.any(Date) },
    });
    expect(notification.readAt).toBe(originalReadAt);
  });

  it('returns not found when the notification belongs to another user', async () => {
    const { service, updateMany, findFirst } = createNotificationsService();
    updateMany.mockResolvedValue({ count: 0 });
    findFirst.mockResolvedValue(null);

    await expect(
      service.markNotificationAsRead(otherUserId, notificationId),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: notificationId, userId: otherUserId, readAt: null },
      data: { readAt: expect.any(Date) },
    });
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: notificationId, userId: otherUserId },
    });
  });
});
