import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { Logger } from '@nestjs/common';

@Processor('order-queue')
export class OrderProcessor extends WorkerHost {
  private readonly logger = new Logger(OrderProcessor.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job<{ orderId: string; productId: string; quantity: number }>): Promise<any> {
    const { orderId, productId, quantity } = job.data;
    this.logger.log(`⏳ Đang xử lý đơn hàng ngầm: ${orderId}`);

    try {
      await this.prisma.$transaction(async (tx) => {
        // 1. Trừ kho trong PostgreSQL
        await tx.inventory.update({
          where: { productId },
          data: {
            availableStock: {
              decrement: quantity,
            },
          },
        });

        // 2. Cập nhật trạng thái đơn sang SUCCESS
        await tx.order.update({
          where: { id: orderId },
          data: { status: 'SUCCESS' },
        });
      });

      this.logger.log(`✅ Xử lý thành công đơn hàng: ${orderId}`);
    } catch (error) {
      this.logger.error(`❌ Lỗi khi xử lý đơn hàng ${orderId}:`, error);

      await this.prisma.order.update({
        where: { id: orderId },
        data: { status: 'FAILED' },
      });
    }
  }
}