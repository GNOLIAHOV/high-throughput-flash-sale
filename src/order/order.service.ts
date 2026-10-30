import { Injectable, BadRequestException, InternalServerErrorException, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { CreateOrderDto } from './dto/create-order.dto';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    @InjectQueue('order-queue') private readonly orderQueue: Queue,
  ) {}

  // Lua script trừ kho nguyên tử (Atomic Stock Deduction):
  // Trả về:
  //   -1: Key sản phẩm không tồn tại
  //   -2: Số lượng trong kho không đủ (Out of stock)
  //  >=0: Trừ kho thành công, giá trị trả về là số lượng tồn còn lại trong kho
  private readonly deductStockLuaScript = `
    local stockKey = KEYS[1]
    local quantity = tonumber(ARGV[1])

    local currentStock = redis.call('get', stockKey)
    if not currentStock then
      return -1
    end

    currentStock = tonumber(currentStock)
    if currentStock < quantity then
      return -2
    end

    redis.call('decrby', stockKey, quantity)
    return currentStock - quantity
  `;

  async placeOrder(createOrderDto: CreateOrderDto) {
    const { userId, productId, quantity, idempotencyKey } = createOrderDto;
    const redis = this.redisService.getClient();
    const stockKey = `product:stock:${productId}`;

    // 0. Kiểm tra Idempotency nếu client cung cấp idempotencyKey
    if (idempotencyKey) {
      const existingOrder = await this.prisma.order.findUnique({
        where: { idempotencyKey },
      });
      if (existingOrder) {
        return {
          message: 'Đơn hàng đã tồn tại (Idempotent response).',
          orderId: existingOrder.id,
          status: existingOrder.status,
        };
      }
    }

    // 1. Chạy Lua Script trừ kho trên Redis
    const result = await redis.eval(
      this.deductStockLuaScript,
      1,
      stockKey,
      quantity,
    );

    if (result === -1) {
      throw new BadRequestException('Sản phẩm không tồn tại hoặc chưa mở bán Flash Sale');
    }

    if (result === -2) {
      throw new BadRequestException('Hàng trong kho đã hết (Out of stock)!');
    }

    // result >= 0: Trừ kho Redis thành công (kể cả khi result === 0 tức là đã mua món hàng cuối cùng)
    try {
      // 2. Lấy giá sản phẩm
      const product = await this.prisma.product.findUnique({
        where: { id: productId },
      });

      if (!product) {
        throw new BadRequestException('Sản phẩm không hợp lệ trong hệ thống');
      }

      const totalAmount = Number(product.price) * quantity;

      // 3. Tạo đơn hàng với trạng thái PENDING
      const order = await this.prisma.order.create({
        data: {
          userId,
          idempotencyKey: idempotencyKey || null,
          totalAmount,
          status: 'PENDING',
          items: {
            create: {
              productId,
              quantity,
              price: product.price,
            },
          },
        },
      });

      // 4. Đẩy đơn hàng vào hàng đợi BullMQ để worker đồng bộ kho và trạng thái trong PostgreSQL
      await this.orderQueue.add('process-order', {
        orderId: order.id,
        productId,
        quantity,
      });

      return {
        message: 'Đặt hàng thành công! Đơn hàng đã đưa vào hàng đợi xử lý.',
        orderId: order.id,
        remainingStockInRedis: result,
      };
    } catch (error) {
      // Rollback số lượng tồn kho trên Redis nếu có bất kỳ lỗi nào xảy ra khi tạo đơn hoặc đẩy queue
      this.logger.error(`⚠️ Lỗi khi xử lý đơn hàng, đang rollback kho Redis cho sản phẩm ${productId}:`, error);
      await redis.incrby(stockKey, quantity);

      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException('Không thể hoàn tất đặt hàng. Vui lòng thử lại sau.');
    }
  }
}
