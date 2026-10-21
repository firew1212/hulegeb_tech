import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { SellerApplicationsController } from './seller-applications.controller.js';
import { SellerApplicationsService } from './seller-applications.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [SellerApplicationsController],
  providers: [SellerApplicationsService],
})
export class SellersModule {}
