import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { Logger } from '@nestjs/common';

@Processor('order-queue')
export class OrderProcessor extends WorkerHost {
  private readonly logger = new Logger(OrderProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {
    super();
  }

  async process(job: Job<{ orderId: string; productId: string; quantity: number }>): Promise<any> {
    const { orderId, productId, quantity } = job.data;
    this.logger.log(`⏳ Đang xử lý đơn hàng ngầm: ${orderId}`);

    try {
      await this.prisma.$transaction(async (tx) => {
        // 1. Kiểm tra tồn kho DB hiện tại để tránh âm kho
        const inventory = await tx.inventory.findUnique({
          where: { productId },
        });

        if (!inventory || inventory.availableStock < quantity) {
          throw new Error(`Kho DB không đủ số lượng (Hiện có: ${inventory?.availableStock ?? 0}, Yêu cầu: ${quantity})`);
        }

        // 2. Trừ kho trong PostgreSQL & tăng version (Optimistic locking pattern)
        await tx.inventory.update({
          where: { productId },
          data: {
            availableStock: {
              decrement: quantity,
            },
            version: {
              increment: 1,
            },
          },
        });

        // 3. Cập nhật trạng thái đơn sang SUCCESS
        await tx.order.update({
          where: { id: orderId },
          data: { status: 'SUCCESS' },
        });
      });

      this.logger.log(`✅ Xử lý thành công đơn hàng: ${orderId}`);
    } catch (error) {
      this.logger.error(`❌ Lỗi khi xử lý đơn hàng ${orderId}:`, error);

      // 1. Cập nhật trạng thái đơn sang FAILED
      await this.prisma.order.update({
        where: { id: orderId },
        data: { status: 'FAILED' },
      }).catch((updateErr) => {
        this.logger.error(`Không thể cập nhật trạng thái FAILED cho đơn ${orderId}:`, updateErr);
      });

      // 2. Hoàn lại số lượng tồn kho trên Redis để không bị thất thoát
      try {
        const redis = this.redisService.getClient();
        await redis.incrby(`product:stock:${productId}`, quantity);
        this.logger.log(`🔄 Đã hoàn lại ${quantity} sản phẩm vào Redis cho mã ${productId}`);
      } catch (rollbackErr) {
        this.logger.error(`❌ Không thể hoàn kho Redis cho sản phẩm ${productId}:`, rollbackErr);
      }
    }
  }
}
